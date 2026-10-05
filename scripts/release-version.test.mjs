import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkReleaseVersion,
  validateReleaseVersions,
} from "./release-version.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const versions = {
  "package.json": "1.0.0",
  "package-lock.json": "1.0.0",
  "package-lock.json root package": "1.0.0",
  "Tauri configuration": "1.0.0",
  "Cargo.toml": "1.0.0",
  "Cargo.lock application package": "1.0.0",
};

test("all release manifests and lockfiles agree with the intended tag", async () => {
  const version = JSON.parse(
    await readFile(resolve(root, "package.json"), "utf8"),
  ).version;
  assert.equal(await checkReleaseVersion(root, `v${version}`), version);
});

test("a stale version in any independently consumed manifest or lockfile blocks a release", () => {
  for (const name of Object.keys(versions).filter(
    (name) => name !== "package.json",
  ))
    assert.throws(
      () => validateReleaseVersions({ ...versions, [name]: "0.4.0" }),
      (error) => error.message.includes(name),
    );
  assert.throws(() =>
    validateReleaseVersions({ ...versions, "Cargo.toml": undefined }),
  );
});

test("publication rejects the wrong tag or a malformed stable version", () => {
  assert.equal(validateReleaseVersions(versions, "v1.0.0"), "1.0.0");
  assert.throws(
    () => validateReleaseVersions(versions, "v0.4.0"),
    /Release tag/,
  );
  for (const version of ["01.0.0", "1.0", "1.0.0-rc.1", "v1.0.0"])
    assert.throws(
      () => validateReleaseVersions({ "package.json": version }),
      /stable/,
    );
});
