import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = resolve(root, "node_modules/supabase/dist/supabase.js");
const tests = resolve(root, "supabase/tests/local-integration.mjs");
const vitest = resolve(root, "node_modules/vitest/vitest.mjs");

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

if (!existsSync(cli)) {
  fail("Local Supabase CLI is missing. Run npm ci before integration tests.");
} else if (!existsSync(tests)) {
  fail("Local Supabase integration tests are missing.");
} else {
  // Keep any hosted-project credentials out of both local child processes.
  const localEnv = Object.fromEntries(
    Object.entries(process.env).filter(
      ([name]) => !/^(SUPABASE_|STRIDE_LOCAL_SUPABASE_)/i.test(name),
    ),
  );

  // This invokes the installed CLI's equivalent of
  // `npx --no-install supabase status -o json`, without shell expansion or an
  // unexpected download. Capture the output because status includes keys.
  const status = spawnSync(process.execPath, [cli, "status", "-o", "json"], {
    cwd: root,
    env: localEnv,
    encoding: "utf8",
    windowsHide: true,
    timeout: 60000,
    maxBuffer: 1024 * 1024,
  });

  if (status.error || status.status !== 0) {
    fail("Local Supabase is unavailable. Start it with npx supabase start.");
  } else {
    let values;
    try {
      values = JSON.parse(status.stdout);
    } catch {
      fail("Supabase CLI did not return valid JSON status.");
    }

    if (values) {
      const apiUrl = values.API_URL ?? values.api_url;
      const publicKey =
        values.PUBLISHABLE_KEY ?? values.ANON_KEY ?? values.anon_key;
      const adminKey =
        values.SECRET_KEY ?? values.SERVICE_ROLE_KEY ?? values.service_role_key;
      // Used only to sign a disposable unconfirmed-user negative fixture.
      // Never inherit a hosted secret or print the CLI status/secret/token.
      const localJwtSecret = values.JWT_SECRET ?? values.jwt_secret;
      let url;
      try {
        url = new URL(apiUrl);
      } catch {
        fail("Supabase CLI did not return a usable local API URL.");
      }

      if (
        url &&
        (url.protocol !== "http:" ||
          !["127.0.0.1", "localhost"].includes(url.hostname) ||
          !url.port ||
          url.pathname !== "/" ||
          url.username ||
          url.password ||
          url.search ||
          url.hash)
      ) {
        fail("Supabase status points outside the plain HTTP loopback API.");
        url = undefined;
      }

      if (url && (typeof localJwtSecret !== "string" || !localJwtSecret)) {
        fail(
          "Supabase status did not return the local JWT secret required for the confirmation-boundary fixture.",
        );
        url = undefined;
      }

      if (
        url &&
        (typeof publicKey !== "string" ||
          !publicKey ||
          typeof adminKey !== "string" ||
          !adminKey)
      ) {
        fail("Supabase CLI did not return local API keys.");
        url = undefined;
      }

      if (url) {
        const testEnv = {
          ...localEnv,
          STRIDE_LOCAL_SUPABASE_URL: url.origin,
          STRIDE_LOCAL_SUPABASE_PUBLIC_KEY: publicKey,
          STRIDE_LOCAL_SUPABASE_ADMIN_KEY: adminKey,
        };
        const result = spawnSync(process.execPath, ["--test", tests], {
          cwd: root,
          env: { ...testEnv, STRIDE_LOCAL_SUPABASE_JWT_SECRET: localJwtSecret },
          stdio: "inherit",
          windowsHide: true,
        });
        if (result.error) {
          fail("Could not start the local integration tests.");
        } else {
          process.exitCode = result.status ?? 1;
        }
        if (!existsSync(vitest)) {
          fail("Vitest is missing for the client integration gate.");
        } else {
          const clientResult = spawnSync(
            process.execPath,
            [vitest, "run", "--config", "vitest.integration.config.ts"],
            { cwd: root, env: testEnv, stdio: "inherit", windowsHide: true },
          );
          if (clientResult.error)
            fail("Could not start the real client integration tests.");
          else if (clientResult.status !== 0)
            process.exitCode = clientResult.status ?? 1;
        }
      }
    }
  }
}
