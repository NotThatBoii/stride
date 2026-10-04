import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/pwa-e2e",
  outputDir: "./test-results/pwa",
  timeout: 60_000,
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1426",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command: "node scripts/pwa-test-server.mjs",
    url: "http://127.0.0.1:1426",
    reuseExistingServer: false,
  },
});
