import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";

// What the built UI may load and talk to. It ships its own scripts, styles and
// fonts and talks only to the engine on this computer, so everything else is
// refused: even if hostile content reached the page, it could not pull in
// outside code or send data elsewhere. (Not applied to the dev server, whose
// hot reload needs inline scripts and a websocket.)
const CONTENT_SECURITY_POLICY = [
  "default-src 'none'",
  "script-src 'self'",
  // React sets inline styles (positions, colours of features).
  "style-src 'self' 'unsafe-inline'",
  // Exported map images are assembled from data: and blob: URLs.
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://127.0.0.1:* http://localhost:* data: blob:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

function contentSecurityPolicy(): Plugin {
  return {
    name: "opengene-csp",
    apply: "build",
    transformIndexHtml: () => [
      {
        tag: "meta",
        attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
        injectTo: "head-prepend",
      },
    ],
  };
}

// Dev server proxies /api to the FastAPI backend on :8000.
export default defineConfig({
  plugins: [react(), contentSecurityPolicy()],
  // Relative asset paths so the built UI also loads over file:// inside Electron.
  base: "./",
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api/, ""),
      },
    },
  },
});
