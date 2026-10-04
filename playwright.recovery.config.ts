import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/recovery-e2e",
  outputDir: "./test-results/recovery",
  workers: 1,
  timeout: 60_000,
  use: {
    baseURL: "http://127.0.0.1:1428",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1428 --strictPort",
    url: "http://127.0.0.1:1428",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
});
