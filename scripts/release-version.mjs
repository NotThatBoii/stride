import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function validateReleaseVersions(versions, tag) {
  const version = versions["package.json"];
  if (!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version ?? ""))
    throw new Error(
      "Release version must be a stable major.minor.patch version.",
    );
  for (const [name, value] of Object.entries(versions)) {
    if (value !== version)
      throw new Error(`Release version in ${name} must match package.json.`);
  }
  if (tag !== undefined && tag !== `v${version}`)
    throw new Error(
      "Release tag must match the configured application version.",
    );
  return version;
}

export async function checkReleaseVersion(root, tag) {
  const paths = [
    "package.json",
    "package-lock.json",
    "src-tauri/tauri.conf.json",
    "src-tauri/Cargo.toml",
    "src-tauri/Cargo.lock",
  ];
  const [packageText, lockText, tauriText, cargoText, cargoLockText] =
    await Promise.all(
      paths.map((path) => readFile(resolve(root, path), "utf8")),
    );
  const packageMetadata = JSON.parse(packageText);
  const lock = JSON.parse(lockText);
  const tauri = JSON.parse(tauriText);
  const cargo = cargoText.match(/^version\s*=\s*"([^"]+)"/m)?.[1];
  const cargoLock = cargoLockText.match(
    /\[\[package\]\]\s+name = "stride"\s+version = "([^"]+)"/,
  )?.[1];
  return validateReleaseVersions(
    {
      "package.json": packageMetadata.version,
      "package-lock.json": lock.version,
      "package-lock.json root package": lock.packages?.[""]?.version,
      "Tauri configuration": tauri.version,
      "Cargo.toml": cargo,
      "Cargo.lock application package": cargoLock,
    },
    tag,
  );
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
    const version = await checkReleaseVersion(root, process.argv[2]);
    console.log(`Release metadata agrees at ${version}.`);
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Release metadata failed.",
    );
    process.exitCode = 1;
  }
}
