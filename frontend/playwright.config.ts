import { defineConfig, devices } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// End-to-end tests: the real UI against the real engine. Playwright starts
// both — the engine with a throwaway library, so tests never touch (or depend
// on) anyone's saved plasmids — and stops them afterwards.
//
//   npm run e2e            (needs the backend installed: pip install -e ../backend)
const dataDir = mkdtempSync(join(tmpdir(), "opengene-e2e-"));

export default defineConfig({
  testDir: "e2e",
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : "list",
  use: {
    baseURL: "http://localhost:5173",
    trace: process.env.CI ? "retain-on-failure" : "off",
    permissions: ["clipboard-read", "clipboard-write"],
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } } }],
  webServer: [
    {
      command: "python -m uvicorn opengene.api:app --port 8000",
      cwd: "../backend",
      env: { OPENGENE_DATA_DIR: dataDir },
      url: "http://localhost:8000/health",
      reuseExistingServer: false,
      timeout: 60_000,
    },
    {
      command: "npm run dev -- --port 5173 --strictPort",
      url: "http://localhost:5173",
      reuseExistingServer: false,
      timeout: 60_000,
    },
  ],
});
