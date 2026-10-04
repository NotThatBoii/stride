import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

// A separate production build keeps real worker tests independent of dev HMR.
const root = process.cwd();
const output = resolve(root, "work", "pwa-build");
if (
  !output.startsWith(resolve(root, "work") + "/") &&
  !output.startsWith(resolve(root, "work") + "\\")
)
  throw new Error("Invalid PWA test build directory.");
const build = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/vite/bin/vite.js"),
    "build",
    "--outDir",
    output,
    "--emptyOutDir",
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      VITE_SUPABASE_URL: "https://fotgomkjwbahxmmovzmn.supabase.co",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_test_only",
    },
  },
);
if (build.status !== 0) process.exit(build.status ?? 1);
const tests = spawnSync(
  process.execPath,
  [
    resolve(root, "node_modules/@playwright/test/cli.js"),
    "test",
    "--config=playwright.pwa.config.ts",
    ...process.argv.slice(2),
  ],
  { stdio: "inherit", env: process.env },
);
process.exit(tests.status ?? 1);
