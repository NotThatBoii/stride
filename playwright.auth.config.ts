import { defineConfig } from "@playwright/test";

// A separate Vite process keeps the mock Auth configuration out of normal E2E runs.
export default defineConfig({
  testDir: "./tests/auth-e2e",
  workers: 1,
  use: {
    baseURL: "http://127.0.0.1:1421",
    launchOptions: { channel: "msedge" },
  },
  webServer: {
    command:
      "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421 --strictPort",
    url: "http://127.0.0.1:1421",
    reuseExistingServer: false,
    env: {
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
});
