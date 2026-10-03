import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/sync-e2e",
  outputDir: "./test-results/sync",
  workers: 1,
  timeout: 60_000,
  use: {
    reducedMotion: "reduce",
    baseURL: "http://127.0.0.1:1423",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1423 --strictPort",
    url: "http://127.0.0.1:1423",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
});
