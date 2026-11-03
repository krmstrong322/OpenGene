// Preload: expose the backend origin to the renderer as
// window.__OPENGENE_API_BASE__, which the frontend's api.ts reads.
//
// The origin is passed from the main process via --api-base=... in
// webPreferences.additionalArguments (main doesn't know the port until the
// backend is up, so it can't be baked into the build).

const { contextBridge } = require("electron");

const arg = process.argv.find((a) => a.startsWith("--api-base="));
const apiBase = arg ? arg.slice("--api-base=".length) : "";

contextBridge.exposeInMainWorld("__OPENGENE_API_BASE__", apiBase);
