// Electron main process.
//
// Lifecycle:
//   1. pick a free localhost port
//   2. spawn the packaged backend (PyInstaller exe) on that port, with
//      OPENGENE_DATA_DIR pointed at the OS per-user data directory
//   3. poll /health until the server is ready
//   4. open a window on the built UI, injecting the backend origin via preload
//   5. terminate the backend when the app quits

const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("child_process");
const http = require("http");
const net = require("net");
const path = require("path");

let backendProcess = null;
let backendPort = 0;

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

function startBackend(port) {
  const exe = backendExecutable();
  backendProcess = spawn(exe, ["--port", String(port)], {
    env: { ...process.env, OPENGENE_DATA_DIR: app.getPath("userData") },
    stdio: ["ignore", "pipe", "pipe"],
  });
  backendProcess.stdout.on("data", (d) => process.stdout.write(`[backend] ${d}`));
  backendProcess.stderr.on("data", (d) => process.stderr.write(`[backend] ${d}`));
  backendProcess.on("exit", (code) => {
    if (code && code !== 0 && !app.isQuitting) {
      dialog.showErrorBox("OpenGene", `The backend stopped unexpectedly (code ${code}).`);
    }
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
      additionalArguments: [`--api-base=http://127.0.0.1:${backendPort}`],
    },
  });

  // Open external links in the user's browser, not inside the app window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });

  win.loadFile(rendererIndex());
  return win;
}

async function boot() {
  try {
    backendPort = await findFreePort();
    startBackend(backendPort);
    await waitForHealth(backendPort);
    createWindow();
  } catch (err) {
    dialog.showErrorBox("OpenGene failed to start", String(err && err.message ? err.message : err));
    app.quit();
  }
}

app.whenReady().then(boot);

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
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
