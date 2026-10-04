import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/hardening",
  outputDir: "./test-results/hardening",
  workers: 1,
  timeout: 90_000,
  use: {
    baseURL: "http://127.0.0.1:1427",
    viewport: { width: 390, height: 844 },
    reducedMotion: "reduce",
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1427 --strictPort",
    url: "http://127.0.0.1:1427",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
});
