import { expect, type Page, type Request } from "@playwright/test";
import type { Data } from "../src/models";

// Test-only server responses exercise the real Supabase client. No test auth
// switch, token generator, or fixture hook is included in the production app.
export const users = {
  "first@example.test": "11111111-1111-4111-8111-111111111111",
  "second@example.test": "22222222-2222-4222-8222-222222222222",
} as const;
export const authOrigin = "https://fotgomkjwbahxmmovzmn.supabase.co";

export function requestAccount(request: Request): string | null {
  try {
    const token = request.headers().authorization?.replace(/^Bearer /i, "");
    const claims = JSON.parse(
      Buffer.from(token?.split(".")[1] ?? "", "base64url").toString(),
    );
    return claims.role === "authenticated" &&
      Object.values(users).includes(claims.sub)
      ? claims.sub
      : null;
  } catch {
    return null;
  }
}

interface MockOptions {
  failLogout?: boolean;
  failSignIn?: boolean;
  signupSession?: boolean;
  holdLogout?: boolean;
  holdRefresh?: boolean;
  passwordExpiresIn?: number;
}

function userFor(email: keyof typeof users) {
  return {
    id: users[email],
    email,
    aud: "authenticated",
    role: "authenticated",
    created_at: "2026-09-20T10:00:00.000Z",
    app_metadata: { provider: "email", providers: ["email"] },
    user_metadata: {},
    identities: [],
  };
}

function sessionFor(email: keyof typeof users, expiresIn = 3600) {
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  const accessToken = `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: users[email], role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + expiresIn })}.test`;
  return {
    access_token: accessToken,
    token_type: "bearer",
    expires_in: expiresIn,
    refresh_token: `refresh-${users[email]}`,
    user: userFor(email),
  };
}

export async function mockAuth(page: Page, options: MockOptions = {}) {
  const calls: string[] = [];
  let releaseLogout!: () => void;
  let releaseRefresh!: () => void;
  const logoutGate = new Promise<void>((resolve) => {
    releaseLogout = resolve;
  });
  const refreshGate = new Promise<void>((resolve) => {
    releaseRefresh = resolve;
  });
  await page.route(`${authOrigin}/**`, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    calls.push(`${request.method()} ${url.pathname}${url.search}`);
    const respond = (status: number, body: unknown) =>
      route.fulfill({
        status,
        contentType: "application/json",
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET, POST, OPTIONS",
          "access-control-allow-headers": "*",
        },
        body: JSON.stringify(body),
      });
    if (request.method() === "OPTIONS") return respond(200, {});
    if (url.pathname.startsWith("/rest/v1/")) {
      const account = requestAccount(request);
      calls.push(`sync-authorized:${account ?? "none"}`);
      if (!account) return respond(401, { message: "Unauthorized" });
      // Auth regression tests keep study writes in the local outbox. The
      // dedicated sync suite routes these RPCs to the actual Phase 3 SQL.
      return respond(503, {
        code: "TEST_SYNC_UNAVAILABLE",
        message: "Study synchronization is temporarily unavailable.",
      });
    }
    if (url.pathname === "/auth/v1/token") {
      if (url.searchParams.get("grant_type") === "password") {
        if (options.failSignIn) return route.abort("internetdisconnected");
        const { email, password } = request.postDataJSON() as {
          email: keyof typeof users;
          password: string;
        };
        if (!users[email] || password !== "password123")
          return respond(400, {
            code: "invalid_credentials",
            message: "Invalid login credentials",
          });
        return respond(200, sessionFor(email, options.passwordExpiresIn));
      }
      if (url.searchParams.get("grant_type") === "refresh_token") {
        if (options.holdRefresh) await refreshGate;
        const { refresh_token: refreshToken } = request.postDataJSON() as {
          refresh_token: string;
        };
        const email = (Object.keys(users) as (keyof typeof users)[]).find(
          (key) => refreshToken === `refresh-${users[key]}`,
        );
        return email
          ? respond(200, sessionFor(email))
          : respond(400, { message: "Invalid refresh token" });
      }
    }
    if (url.pathname === "/auth/v1/signup") {
      const { email } = request.postDataJSON() as { email: string };
      if (options.signupSession && email in users)
        return respond(200, sessionFor(email as keyof typeof users));
      return respond(200, {
        user: {
          id: "33333333-3333-4333-8333-333333333333",
          email,
          aud: "authenticated",
          created_at: "2026-09-20T10:00:00.000Z",
          identities: [{}],
        },
        session: null,
      });
    }
    if (url.pathname === "/auth/v1/logout") {
      calls.push(
        `logout-authorized:${Boolean(request.headers().authorization?.startsWith("Bearer "))}`,
      );
      if (options.holdLogout) await logoutGate;
      return options.failLogout
        ? respond(503, { message: "Network unavailable" })
        : respond(200, {});
    }
    if (url.pathname === "/auth/v1/user") {
      const bearer =
        request.headers().authorization?.replace(/^Bearer /i, "") ?? "";
      let id: string | undefined;
      try {
        id = JSON.parse(
          Buffer.from(bearer.split(".")[1], "base64url").toString(),
        ).sub;
      } catch {
        /* An invalid bearer remains unauthorized in this test server. */
      }
      const email = (Object.keys(users) as (keyof typeof users)[]).find(
        (key) => users[key] === id,
      );
      return email
        ? respond(200, userFor(email))
        : respond(401, { message: "Unauthorized" });
    }
    return respond(404, { message: "Unexpected request" });
  });
  async function expireSavedSession(
    email: keyof typeof users = "first@example.test",
  ) {
    const expired = {
      ...sessionFor(email, -1),
      expires_in: 3600,
      expires_at: Math.floor(Date.now() / 1000) - 1,
    };
    await page.evaluate(async (session) => {
      const { supabaseAuthStorageKey } = await import("/src/lib/supabase.ts");
      if (!supabaseAuthStorageKey)
        throw new Error("Auth fixture requires configured session storage.");
      localStorage.setItem(supabaseAuthStorageKey, JSON.stringify(session));
    }, expired);
  }
  return { calls, releaseLogout, releaseRefresh, expireSavedSession };
}

export async function signIn(
  page: Page,
  email: keyof typeof users = "first@example.test",
) {
  await page.getByLabel("Email", { exact: true }).fill(email);
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.locator(".account-form button").click();
  await expect
    .poll(() =>
      page.evaluate(async () => {
        const storage = await import("/src/lib/storage.ts");
        return storage.getActiveWorkspace().accountId;
      }),
    )
    .toBe(users[email]);
  await expect(page.locator(".boot")).toHaveCount(0);
  await expect(page.locator(".auth-screen")).toHaveCount(0);
}

export async function openAccount(page: Page) {
  const server = await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  return server;
}

export async function seedAccount(page: Page, data: Data) {
  await page.evaluate(async (value) => {
    const storage = await import("/src/lib/storage.ts");
    const db = storage.getActiveDatabase();
    if (!db.accountId)
      throw new Error("Test fixture requires a signed-in account.");
    const imports = await import("/src/lib/sync/import.ts");
    const { activeSyncWorker: worker } = await import(
      "/src/lib/sync/worker.ts"
    );
    if (!worker || worker.db !== db)
      throw new Error("Test fixture requires its account worker.");
    await worker.runExclusive(async (current, guard) => {
      const stage = await imports.stageImport(current, value, "backup", guard);
      await imports.commitImport(current, stage.id, guard);
      // Fixture setup explicitly supplies this device's onboarding/appearance.
      await current.preferences.put({ ...value.settings, id: 1 });
      guard();
    });
  }, data);
}

export function expectNoStudySync(calls: string[]) {
  expect(
    calls.filter(
      (call) => call.includes("/rest/v1/") || call.includes("/rpc/"),
    ),
  ).toEqual([]);
}

export function expectAccountStudySync(
  calls: string[],
  allowedAccounts: string[] = [users["first@example.test"]],
) {
  const requests = calls.filter(
    (call) => call.includes("/rest/v1/") && !call.startsWith("OPTIONS "),
  );
  const owners = calls.filter((call) => call.startsWith("sync-authorized:"));
  expect(owners).toHaveLength(requests.length);
  for (const owner of owners)
    expect(allowedAccounts).toContain(owner.slice("sync-authorized:".length));
  for (const request of requests)
    expect(request).toMatch(
      /^POST \/rest\/v1\/rpc\/(get_sync_changes|apply_sync_operation)$/,
    );
}
