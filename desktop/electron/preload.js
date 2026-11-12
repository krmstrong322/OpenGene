// Preload: the only bridge between the UI and the Electron shell.
//
//   window.__OPENGENE_API_BASE__  the backend origin, which the frontend's
//       api.ts reads. It is passed from the main process via --api-base=...
//       in webPreferences.additionalArguments (main doesn't know the port
//       until the backend is up, so it can't be baked into the build).
//
//   window.opengeneDesktop  menu commands and files handed to the app. The
//       UI gets plain data and callbacks only — no Node or Electron objects.

const { contextBridge, ipcRenderer } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--api-base="));
const apiBase = arg ? arg.slice("--api-base=".length) : "";

contextBridge.exposeInMainWorld("__OPENGENE_API_BASE__", apiBase);

function subscribe(channel, callback) {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on(channel, handler);
  return () => ipcRenderer.removeListener(channel, handler);
}

contextBridge.exposeInMainWorld("opengeneDesktop", {
  // A menu item was chosen: "new", "undo", "export:genbank", "view:map", ...
  onCommand: (callback) => subscribe("command", callback),
  // Files to import, as [{ name, data: Uint8Array }].
  onOpenFiles: (callback) => subscribe("open-files", callback),
  // Call once both subscriptions are in place; queued files arrive after it.
  ready: () => ipcRenderer.send("renderer-ready"),
  setMenuState: (state) => ipcRenderer.send("menu-state", { hasRecord: !!state.hasRecord }),
  // Text-field undo / redo / select-all ("undo" | "redo" | "selectAll").
  textRole: (role) => ipcRenderer.send("text-role", String(role)),
});
