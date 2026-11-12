import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Unit tests for the pure logic in src/lib run in Node; component tests run
// in jsdom. End-to-end tests against the real engine are Playwright's (e2e/).
export default defineConfig({
  plugins: [react()],
  test: {
    include: ["src/**/*.test.{ts,tsx}"],
    environment: "node",
    environmentMatchGlobs: [["src/components/**", "jsdom"]],
    restoreMocks: true,
  },
});
