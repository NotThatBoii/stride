import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/stress-e2e",
  outputDir: "./test-results/stress",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:1429",
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1429 --strictPort",
    url: "http://127.0.0.1:1429",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
});
