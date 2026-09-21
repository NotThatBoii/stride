import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  use: {
    reducedMotion: "reduce",
    baseURL: "http://127.0.0.1:1420",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command: "npm run dev",
    url: "http://127.0.0.1:1420",
    reuseExistingServer: !process.env.CI,
  },
  workers: 1,
});
