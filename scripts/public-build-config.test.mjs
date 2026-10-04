import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  publicBuildConfiguration,
  publicBuildEnvironment,
  checkPublicBundle,
  projectUrl,
} from "./public-build-config.mjs";

const fallback = {
  url: projectUrl,
  publishableKey: "sb_publishable_test_public_configuration",
};

test("Windows build rejects secret keys and a project outside the narrow CSP", () => {
  assert.deepEqual(publicBuildConfiguration({}, fallback), fallback);
  for (const key of [
    "sb_secret_example",
    "eyJservice.role.key",
    "",
    "anon-unverified-key",
  ])
    assert.throws(() =>
      publicBuildConfiguration(
        { VITE_SUPABASE_PUBLISHABLE_KEY: key },
        { ...fallback, publishableKey: key },
      ),
    );
  assert.throws(() =>
    publicBuildConfiguration(
      { VITE_SUPABASE_URL: "https://another-project.supabase.co" },
      fallback,
    ),
  );
  assert.throws(() =>
    publicBuildConfiguration(
      { VITE_SUPABASE_URL: projectUrl + "/?token=private" },
      fallback,
    ),
  );
});

test("only intended public Vite configuration reaches the packaging process", () => {
  const output = publicBuildEnvironment(
    {
      PATH: "toolchain",
      CARGO_HOME: "cargo",
      VITE_PASSWORD: "private",
      VITE_SUPABASE_PUBLISHABLE_KEY: "sb_secret_example",
      SUPABASE_ACCESS_TOKEN: "private",
      STRIDE_LOCAL_SUPABASE_ADMIN_KEY: "private",
      GH_TOKEN: "private",
      GITHUB_TOKEN: "private",
    },
    fallback,
  );
  assert.deepEqual(output, {
    PATH: "toolchain",
    CARGO_HOME: "cargo",
    VITE_SUPABASE_URL: projectUrl,
    VITE_SUPABASE_PUBLISHABLE_KEY: fallback.publishableKey,
  });
});

test("bundle verification rejects missing public configuration and embedded private credential patterns", async () => {
  const directory = await mkdtemp(join(tmpdir(), "stride-public-build-"));
  try {
    const path = join(directory, "entry.js");
    await writeFile(path, "unconfigured");
    await assert.rejects(checkPublicBundle(directory, fallback));
    const valid = `${projectUrl} ${fallback.publishableKey}`;
    await writeFile(path, valid);
    await checkPublicBundle(directory, fallback);
    await writeFile(path, valid + " sb_secret_test_private_value");
    await assert.rejects(
      checkPublicBundle(directory, fallback),
      /private credential/,
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
