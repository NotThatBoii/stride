import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/performance",
  outputDir: "./test-results/performance",
  workers: 1,
  timeout: 180_000,
  use: {
    baseURL: "http://127.0.0.1:1435",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    timezoneId: "Asia/Manila",
    serviceWorkers: "block",
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command: "node scripts/performance/serve-production.mjs",
    url: "http://127.0.0.1:1435",
    reuseExistingServer: false,
  },
});
