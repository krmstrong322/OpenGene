// Electron main process.
//
// Lifecycle:
//   1. pick a free localhost port
//   2. spawn the packaged backend (PyInstaller exe) on that port, with
//      OPENGENE_DATA_DIR pointed at the OS per-user data directory
//   3. poll /health until the server is ready
//   4. open a window on the built UI, injecting the backend origin via preload
//   5. terminate the backend when the app quits
//
// It also owns what only the OS shell can do: the application menu, the
// native Open dialog, and files handed to the app (double-clicked in the file
// manager, dropped on the dock icon, passed on the command line, or opened
// while the app is already running). Files are read here and sent to the UI,
// which imports them through the engine like any other import.

const { app, BrowserWindow, Menu, dialog, ipcMain, session, shell } = require("electron");
const { spawn } = require("child_process");
const crypto = require("crypto");
const fs = require("fs");
const http = require("http");
const net = require("net");
const path = require("path");
const { pathToFileURL } = require("url");

let backendProcess = null;
let backendPort = 0;
let backendReady = false; // set once /health answers; gates window creation
// A fresh secret for every launch. The engine is told to refuse any request
// that doesn't carry it, and only our own window is given it — so nothing else
// on this computer, such as a web page open in the user's browser, can read or
// change the plasmid library through the engine's local port.
const apiToken = crypto.randomBytes(32).toString("hex");

let mainWindow = null;
let rendererReady = false; // the UI has subscribed to commands and files
const pendingFiles = []; // paths waiting for a window that can take them
let menuState = { hasRecord: false };

// Sequence files the engine can import (kept in step with the file picker in
// the UI and with fileAssociations in electron-builder.yml).
const IMPORT_EXTENSIONS = [
  "gb", "gbk", "genbank", "fasta", "fa", "fna", "embl", "dna", "ab1", "abi", "scf",
];
const MAX_IMPORT_BYTES = 256 * 1024 * 1024;
const REPO_URL = "https://github.com/krmstrong322/OpenGene";

function resourcePath(...parts) {
  // Packaged: files live under resources/. Dev: alongside the electron/ dir.
  const base = app.isPackaged ? process.resourcesPath : path.join(__dirname, "..");
  return path.join(base, ...parts);
}

function backendExecutable() {
  const dir = resourcePath("backend");
  const name = process.platform === "win32" ? "opengene-backend.exe" : "opengene-backend";
  return path.join(dir, name);
}

function rendererIndex() {
  return resourcePath("renderer", "index.html");
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.unref();
    srv.on("error", reject);
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      srv.close(() => resolve(port));
    });
  });
}

function waitForHealth(port, timeoutMs = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const req = http.get(
        { host: "127.0.0.1", port, path: "/health", timeout: 1500 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) resolve();
          else retry();
        },
      );
      req.on("error", retry);
      req.on("timeout", () => {
        req.destroy();
        retry();
      });
    };
    const retry = () => {
      if (Date.now() - start > timeoutMs) {
        reject(new Error("backend did not become healthy in time"));
      } else {
        setTimeout(attempt, 300);
      }
    };
    attempt();
  });
}

// Starts the backend. The returned promise never resolves; it rejects if the
// backend can't be launched (spawn reports that asynchronously through the
// "error" event, not as a thrown exception) or exits before it is ready, so
// boot() can race it against the health check.
function startBackend(port) {
  const exe = backendExecutable();
  backendProcess = spawn(exe, ["--port", String(port)], {
    env: {
      ...process.env,
      OPENGENE_DATA_DIR: app.getPath("userData"),
      OPENGENE_API_TOKEN: apiToken,
      // The UI is loaded from disk, which gives it the anonymous origin "null".
      OPENGENE_ALLOWED_ORIGINS: "null",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  return new Promise((_, reject) => {
    backendProcess.on("error", (err) => {
      reject(new Error(`Could not start the backend (${exe}): ${err.message}`));
    });
    backendProcess.on("exit", (code, signal) => {
      const how = code !== null ? `code ${code}` : `signal ${signal}`;
      if (!backendReady) {
        reject(new Error(`The backend exited during startup (${how}).`));
      } else if (!app.isQuitting) {
        dialog.showErrorBox(
          "OpenGene",
          `The backend stopped unexpectedly (${how}). Please restart OpenGene.`,
        );
      }
    });
  });
}

function stopBackend() {
  if (backendProcess && !backendProcess.killed) {
    try {
      backendProcess.kill();
    } catch {
      /* ignore */
    }
    backendProcess = null;
  }
}

// Hand a link to the user's browser — but only a web link. Anything else
// (file:, a custom app scheme, a script URL) could make the OS run something.
function openInBrowser(url) {
  try {
    const { protocol } = new URL(url);
    if (protocol === "https:" || protocol === "http:") shell.openExternal(url);
  } catch {
    /* not a URL */
  }
}

// The UI needs the clipboard and nothing else: no camera, microphone,
// location, notifications…
const ALLOWED_PERMISSIONS = new Set(["clipboard-read", "clipboard-sanitized-write"]);
function restrictPermissions() {
  const ses = session.defaultSession;
  ses.setPermissionRequestHandler((_wc, permission, callback) => {
    callback(ALLOWED_PERMISSIONS.has(permission));
  });
  ses.setPermissionCheckHandler((_wc, permission) => ALLOWED_PERMISSIONS.has(permission));
}

// ---------------------------------------------------------------------------
// Files handed to the app
// ---------------------------------------------------------------------------

function isImportable(file) {
  const ext = path.extname(file).slice(1).toLowerCase();
  if (!IMPORT_EXTENSIONS.includes(ext)) return false;
  try {
    return fs.statSync(file).isFile();
  } catch {
    return false;
  }
}

// File paths among command-line arguments (switches, the app path in a dev
// run, and anything that isn't a sequence file are ignored).
function filesFromArgv(argv, cwd) {
  return argv
    .slice(1)
    .filter((a) => !a.startsWith("-"))
    .map((a) => path.resolve(cwd, a))
    .filter(isImportable);
}

function openFiles(paths) {
  pendingFiles.push(...paths);
  flushPendingFiles();
}

// Send queued files to the UI once there is a window listening for them.
async function flushPendingFiles() {
  if (!pendingFiles.length || !backendReady) return;
  if (!mainWindow) {
    createWindow(); // flushes again when its UI reports ready
    return;
  }
  if (!rendererReady) return;
  const paths = pendingFiles.splice(0);
  const files = [];
  const problems = [];
  for (const file of paths) {
    try {
      const { size } = await fs.promises.stat(file);
      if (size > MAX_IMPORT_BYTES) throw new Error("the file is too large to import");
      files.push({ name: path.basename(file), data: await fs.promises.readFile(file) });
    } catch (err) {
      problems.push(`${path.basename(file)}: ${err.message}`);
    }
  }
  if (files.length && mainWindow) {
    mainWindow.webContents.send("open-files", files);
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
  }
  if (problems.length) {
    dialog.showErrorBox("OpenGene couldn't open", problems.join("\n"));
  }
}

async function showOpenDialog() {
  const options = {
    title: "Import sequence files",
    properties: ["openFile", "multiSelections"],
    filters: [
      { name: "Sequence files", extensions: IMPORT_EXTENSIONS },
      { name: "All files", extensions: ["*"] },
    ],
  };
  const result = mainWindow
    ? await dialog.showOpenDialog(mainWindow, options)
    : await dialog.showOpenDialog(options);
  if (!result.canceled) openFiles(result.filePaths);
}

// ---------------------------------------------------------------------------
// Application menu
// ---------------------------------------------------------------------------

// Ask the UI to do something. Menu items that act on the open record are
// carried out there, where the record and its undo history live.
function sendCommand(command) {
  if (!mainWindow) {
    if (backendReady) createWindow();
    return;
  }
  mainWindow.webContents.send("command", command);
}

function buildMenu() {
  const isMac = process.platform === "darwin";
  const cmd = (label, command, extra = {}) => ({
    label,
    click: () => sendCommand(command),
    ...extra,
  });
  const needsRecord = { enabled: menuState.hasRecord };
  const template = [
    ...(isMac
      ? [
          {
            label: app.name,
            submenu: [
              { role: "about" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ]
      : []),
    {
      label: "&File",
      submenu: [
        cmd("New Sequence…", "new", { id: "new", accelerator: "CmdOrCtrl+N" }),
        {
          id: "open",
          label: "Open…",
          accelerator: "CmdOrCtrl+O",
          click: () => void showOpenDialog(),
        },
        { type: "separator" },
        {
          id: "export",
          label: "Export As",
          ...needsRecord,
          submenu: [
            cmd("SnapGene (.dna)", "export:snapgene", { id: "export:snapgene" }),
            cmd("GenBank (.gb)", "export:genbank", { id: "export:genbank" }),
            cmd("FASTA (.fasta)", "export:fasta", { id: "export:fasta" }),
            cmd("EMBL (.embl)", "export:embl", { id: "export:embl" }),
          ],
        },
        { type: "separator" },
        cmd("Show Library", "library", {
          id: "library",
          accelerator: "CmdOrCtrl+Shift+L",
          ...needsRecord,
        }),
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit" },
      ],
    },
    {
      label: "&Edit",
      submenu: [
        // Undo/redo go to the UI: there they step the record's history, or
        // fall back to ordinary text undo while a text field has the focus.
        // The UI handles the shortcuts itself, so on Windows and Linux they
        // are shown here but not registered; macOS always registers them, and
        // the UI drops the duplicate request.
        cmd("Undo", "undo", {
          id: "undo",
          accelerator: "CmdOrCtrl+Z",
          registerAccelerator: false,
        }),
        cmd("Redo", "redo", {
          id: "redo",
          accelerator: isMac ? "Shift+Cmd+Z" : "Ctrl+Y",
          registerAccelerator: false,
        }),
        { type: "separator" },
        // Roles, so they work in text fields; the sequence view answers the
        // same cut/copy/paste events with bases.
        { role: "cut" },
        { role: "copy" },
        { role: "paste" },
        cmd("Select All", "select-all", { id: "select-all", accelerator: "CmdOrCtrl+A" }),
        { type: "separator" },
        cmd("Find…", "find", { id: "find", accelerator: "CmdOrCtrl+F", ...needsRecord }),
      ],
    },
    {
      label: "&View",
      submenu: [
        cmd("Show or Hide Map", "view:map", { id: "view:map", ...needsRecord }),
        cmd("Show or Hide Linear View", "view:linear", { id: "view:linear", ...needsRecord }),
        cmd("Show or Hide Sequence", "view:sequence", { id: "view:sequence", ...needsRecord }),
        { type: "separator" },
        {
          label: "Appearance",
          submenu: [
            cmd("Match System", "theme:system", { id: "theme:system" }),
            cmd("Light", "theme:light", { id: "theme:light" }),
            cmd("Dark", "theme:dark", { id: "theme:dark" }),
          ],
        },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
        ...(app.isPackaged ? [] : [{ type: "separator" }, { role: "reload" }, { role: "toggleDevTools" }]),
      ],
    },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        { label: "OpenGene on GitHub", click: () => shell.openExternal(REPO_URL) },
        { label: "Report a Problem", click: () => shell.openExternal(`${REPO_URL}/issues`) },
      ],
    },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

ipcMain.on("renderer-ready", (event) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  rendererReady = true;
  void flushPendingFiles();
});

// The UI reports whether a record is open, so record-only items can be
// enabled or greyed out.
ipcMain.on("menu-state", (event, state) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  const hasRecord = !!(state && state.hasRecord);
  if (hasRecord === menuState.hasRecord) return;
  menuState = { hasRecord };
  buildMenu();
});

// Text undo/redo/select-all for when a text field has the focus.
const TEXT_ROLES = new Set(["undo", "redo", "selectAll"]);
ipcMain.on("text-role", (event, role) => {
  if (!mainWindow || event.sender !== mainWindow.webContents) return;
  if (TEXT_ROLES.has(role)) event.sender[role]();
});

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 900,
    minHeight: 600,
    title: "OpenGene",
    backgroundColor: "#f5f7fa",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      additionalArguments: [
        `--api-base=http://127.0.0.1:${backendPort}`,
        `--api-token=${apiToken}`,
      ],
    },
  });

  // The window shows the bundled UI and nothing else. Links open in the
  // user's browser (web links only), and the window can't be navigated away:
  // a page loaded from elsewhere would otherwise inherit the bridge and the
  // engine's access token.
  win.webContents.setWindowOpenHandler(({ url }) => {
    openInBrowser(url);
    return { action: "deny" };
  });
  const home = pathToFileURL(rendererIndex()).href;
  const stayHome = (event, url) => {
    if (url.split("#")[0] === home) return;
    event.preventDefault();
    openInBrowser(url);
  };
  win.webContents.on("will-navigate", stayHome);
  win.webContents.on("will-redirect", stayHome);
  win.webContents.on("will-attach-webview", (event) => event.preventDefault());

  mainWindow = win;
  rendererReady = false;
  // A reload starts a new page that has to subscribe again.
  win.webContents.on("did-start-loading", () => {
    rendererReady = false;
  });
  win.on("closed", () => {
    if (mainWindow === win) {
      mainWindow = null;
      rendererReady = false;
      menuState = { hasRecord: false };
      buildMenu();
    }
  });

  win.loadFile(rendererIndex());
  return win;
}

async function boot() {
  try {
    backendPort = await findFreePort();
    const backendFailed = startBackend(backendPort);
    await Promise.race([waitForHealth(backendPort), backendFailed]);
    backendReady = true;
    restrictPermissions();
    buildMenu();
    createWindow();
    void flushPendingFiles();
  } catch (err) {
    const message = String(err && err.message ? err.message : err);
    console.error(`OpenGene failed to start: ${message}`);
    app.isQuitting = true; // no second "stopped unexpectedly" dialog
    stopBackend();
    dialog.showErrorBox("OpenGene failed to start", message);
    app.quit();
  }
}

// One running copy: opening a file while OpenGene is running hands it to the
// existing window (and its library) instead of starting a second backend.
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on("second-instance", (_event, argv, cwd) => {
    const files = filesFromArgv(argv, cwd);
    if (files.length) {
      openFiles(files);
    } else if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  // macOS delivers files (double-click, "Open With", a drop on the dock icon)
  // as events, possibly before the app is ready.
  app.on("open-file", (event, file) => {
    event.preventDefault();
    if (isImportable(file)) openFiles([file]);
  });

  // Windows and Linux pass them on the command line.
  pendingFiles.push(...filesFromArgv(process.argv, process.cwd()));

  app.whenReady().then(boot);
}

app.on("activate", () => {
  // macOS dock click. boot() opens the first window once the backend is
  // healthy; before that, opening one here would point at a backend that
  // isn't listening yet (and boot() would then open a second window).
  if (backendReady && BrowserWindow.getAllWindows().length === 0) createWindow();
});

app.on("window-all-closed", () => {
  // Standard for a document-style app: quit on all platforms except macOS,
  // where apps usually stay in the dock.
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  app.isQuitting = true;
  stopBackend();
});

process.on("exit", stopBackend);
