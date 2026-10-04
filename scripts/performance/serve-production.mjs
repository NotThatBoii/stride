import { build, preview } from "vite";

// Separate output and port prevent performance work from replacing release/PWA artifacts.
const config = {
  define: {
    "import.meta.env.VITE_SUPABASE_URL": JSON.stringify(
      "https://fotgomkjwbahxmmovzmn.supabase.co",
    ),
    "import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY": JSON.stringify(
      "sb_publishable_test_only",
    ),
  },
  build: { outDir: "test-results/performance-app", emptyOutDir: true },
};
await build(config);
await preview({
  ...config,
  preview: { host: "127.0.0.1", port: 1435, strictPort: true },
});
