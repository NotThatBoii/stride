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
  const environment = publicBuildEnvironment(process.env, configuration);
  console.log(
    "Building the frontend with the intended project URL and public publishable configuration.",
  );
  const steps = [
    [resolve(root, "node_modules/typescript/bin/tsc"), "-b"],
    [resolve(root, "node_modules/vite/bin/vite.js"), "build"],
  ];
  for (const args of steps) {
    const result = spawnSync(process.execPath, args, {
      cwd: root,
      env: environment,
      stdio: "inherit",
      windowsHide: true,
    });
    if (result.error)
      throw new Error("The frontend build process could not start.");
    if (result.status !== 0) {
      process.exitCode = result.status ?? 1;
      break;
    }
  }
  if (!process.exitCode) {
    await checkPublicBundle(resolve(root, "dist"), configuration);
    console.log(
      "Frontend public configuration and credential-pattern check passed.",
    );
  }
} catch (error) {
  console.error(
    error instanceof Error
      ? error.message
      : "Frontend build configuration failed.",
  );
  process.exitCode = 1;
}
