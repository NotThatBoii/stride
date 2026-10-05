import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { checkReleaseVersion } from "./release-version.mjs";
import {
  publicBuildConfiguration,
  publicBuildEnvironment,
  checkPublicBundle,
} from "./public-build-config.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
try {
  await checkReleaseVersion(root);
  const fallback = JSON.parse(
    await readFile(resolve(root, "config/supabase-public.json"), "utf8"),
  );
  const configuration = publicBuildConfiguration(process.env, fallback);
  console.log(
    "Building Windows with the intended project URL and public publishable configuration.",
  );
  const result = spawnSync(
    process.execPath,
    [
      resolve(root, "node_modules/@tauri-apps/cli/tauri.js"),
      "build",
      ...process.argv.slice(2),
    ],
    {
      cwd: root,
      env: publicBuildEnvironment(process.env, configuration),
      stdio: "inherit",
      windowsHide: true,
    },
  );
  if (result.error) throw new Error("The Tauri build process could not start.");
  if (result.status !== 0) process.exitCode = result.status ?? 1;
  else {
    await checkPublicBundle(resolve(root, "dist"), configuration);
    console.log(
      "Packaged frontend public configuration and credential-pattern check passed.",
    );
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Windows build configuration failed.",
  );
  process.exitCode = 1;
}
