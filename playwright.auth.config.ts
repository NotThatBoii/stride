import { defineConfig } from "@playwright/test";

// All configured auth requests are intercepted by test-only server fixtures.
// A second build verifies that missing configuration never opens a workspace.
export default defineConfig({
  workers: 1,
  use: {
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
    launchOptions: { channel: "msedge" },
  },
  projects: [
    {
      name: "auth",
      testDir: "./tests/auth-e2e",
      use: { baseURL: "http://127.0.0.1:1421" },
    },
    {
      name: "missing-config",
      testDir: "./tests/auth-unconfigured",
      use: { baseURL: "http://127.0.0.1:1422" },
    },
  ],
  webServer: [
    {
      command:
        "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1421 --strictPort",
      url: "http://127.0.0.1:1421",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
        VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
      },
    },
    {
      command:
        "node ./node_modules/vite/bin/vite.js --host 127.0.0.1 --port 1422 --strictPort",
      url: "http://127.0.0.1:1422",
      reuseExistingServer: false,
      env: {
        VITE_SUPABASE_URL: "",
        VITE_SUPABASE_PUBLISHABLE_KEY: "",
      },
    },
  ],
});
