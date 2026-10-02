import { expect, test, type Page } from "@playwright/test";
import { defaults, type Data } from "../../src/models";

const users = {
  "first@example.test": "11111111-1111-4111-8111-111111111111",
  "second@example.test": "22222222-2222-4222-8222-222222222222",
} as const;

function studyData(name: string): Data {
  return {
    subjects: [
      {
        id: `subject-${name}`,
        name,
        description: "",
        icon: "book",
        color: "#8b91e8",
        created_at: "2026-09-20T10:00:00.000Z",
        archived: 0,
      },
    ],
    sessions: [],
    slices: [],
    settings: { ...defaults, onboarded: true },
    running: null,
  };
}

function token(userId: string): string {
  const encoded = (value: object) =>
    Buffer.from(JSON.stringify(value)).toString("base64url");
  return `${encoded({ alg: "HS256", typ: "JWT" })}.${encoded({ sub: userId, role: "authenticated", aud: "authenticated", exp: Math.floor(Date.now() / 1000) + 3600 })}.test`;
}

async function mockAuth(page: Page, failLogout = false) {
  const calls: string[] = [];
  await page.route(
    "https://fotgomkjwbahxmmovzmn.supabase.co/**",
    async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      calls.push(`${request.method()} ${url.pathname}`);
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
      if (
        url.pathname === "/auth/v1/token" &&
        url.searchParams.get("grant_type") === "password"
      ) {
        const { email, password } = request.postDataJSON() as {
          email: string;
          password: string;
        };
        const id = users[email as keyof typeof users];
        if (!id || password !== "password123")
          return respond(400, {
            code: "invalid_credentials",
            message: "Invalid login credentials",
          });
        const user = {
          id,
          email,
          aud: "authenticated",
          role: "authenticated",
          created_at: "2026-09-20T10:00:00.000Z",
        };
        return respond(200, {
          access_token: token(id),
          token_type: "bearer",
          expires_in: 3600,
          refresh_token: `refresh-${id}`,
          user,
        });
      }
      if (url.pathname === "/auth/v1/signup") {
        const { email } = request.postDataJSON() as { email: string };
        return respond(200, {
          user: {
            id: crypto.randomUUID(),
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
        return failLogout
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
          /* An invalid bearer remains unauthorized. */
        }
        if (id)
          return respond(200, {
            user: {
              id,
              email: Object.keys(users).find(
                (email) => users[email as keyof typeof users] === id,
              ),
              aud: "authenticated",
            },
          });
        return respond(401, { message: "Unauthorized" });
      }
      return respond(404, { message: "Unexpected request" });
    },
  );
  return calls;
}

async function seed(page: Page, name: string) {
  await page.evaluate(async (data) => {
    const storage = await import("/src/lib/storage.ts");
    await storage.restoreData(data);
  }, studyData(name));
  await expect(page.locator("body")).toContainText(name);
}

async function anonymousSubjectNames(page: Page): Promise<string[]> {
  return page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const data = await storage.readData(storage.database);
    return data.subjects.map((subject) => subject.name);
  });
}

async function signIn(
  page: Page,
  email: keyof typeof users,
  password = "password123",
) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".account-form input[type=email]").fill(email);
  await page.locator(".account-form input[type=password]").fill(password);
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
}

test("account switching keeps three local histories isolated across reload and sign-out", async ({
  page,
}) => {
  const calls = await mockAuth(page);
  await page.goto("/");
  await seed(page, "Anonymous history");
  await page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage.saveRunning({
      id: "anonymous-running",
      subjectId: "subject-Anonymous history",
      startedAt: new Date().toISOString(),
      title: "Anonymous focus",
      mode: "stopwatch",
      target: 1500,
      segments: [],
      runningSince: Date.now(),
      notified: false,
    });
  });
  await expect(page.locator(".floating-timer")).toBeVisible();

  await signIn(page, "first@example.test");
  await expect(
    page.getByRole("button", { name: "Anonymous history", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".floating-timer")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Find your stride" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Anonymous history on this device" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Keep separate" }).click();
  await expect(
    page.getByRole("heading", { name: "Anonymous history on this device" }),
  ).toHaveCount(0);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Anonymous history on this device" }),
  ).toHaveCount(0);
  await seed(page, "First account history");

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("body")).toContainText("Anonymous history");
  await expect(page.locator(".floating-timer")).toBeVisible();
  await expect(page.locator("body")).not.toContainText("First account history");

  await signIn(page, "second@example.test");
  await expect(page.locator("body")).not.toContainText("First account history");
  await expect(page.locator(".floating-timer")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Anonymous history on this device" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Prepare import" }).click();
  await expect(page.locator("body")).toContainText(
    "Nothing has been copied or uploaded",
  );
  await page.getByRole("button", { name: "Got it" }).click();
  await seed(page, "Second account history");
  await page.reload();
  await expect(page.locator("body")).toContainText("Second account history");
  await expect(page.locator("body")).not.toContainText("First account history");
  await expect(
    page.getByRole("heading", { name: "Anonymous history on this device" }),
  ).toHaveCount(0);

  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("body")).toContainText("Anonymous history");
  await expect(page.locator("body")).not.toContainText(
    "Second account history",
  );
  expect(
    calls.some((call) => call.includes("/rest/v1/") || call.includes("/rpc/")),
  ).toBe(false);
});

test("sign-up confirmation and invalid password do not change anonymous data", async ({
  page,
}) => {
  const calls = await mockAuth(page);
  await page.goto("/");
  await seed(page, "Safe anonymous history");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .first()
    .click();
  await page
    .locator(".account-form input[type=email]")
    .fill("new@example.test");
  await page.locator(".account-form input[type=password]").fill("password123");
  await page.locator(".account-form button").click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(await anonymousSubjectNames(page)).toContain("Safe anonymous history");
  await page
    .getByRole("button", { name: "Sign in", exact: true })
    .first()
    .click();
  await page
    .locator(".account-form input[type=email]")
    .fill("first@example.test");
  await page
    .locator(".account-form input[type=password]")
    .fill("wrong-password");
  await page.locator(".account-form button").click();
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  expect(await anonymousSubjectNames(page)).toContain("Safe anonymous history");
  expect(
    calls.some((call) => call.includes("/rest/v1/") || call.includes("/rpc/")),
  ).toBe(false);
});

test("failed remote logout still returns to anonymous data after reload", async ({
  page,
}) => {
  const calls = await mockAuth(page, true);
  await page.goto("/");
  await seed(page, "Anonymous record");
  await signIn(page, "first@example.test");
  await seed(page, "Account record");
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page.locator("body")).toContainText("Anonymous record");
  await expect(page.locator("body")).not.toContainText("Account record");
  await expect(page.getByRole("alert")).toContainText(
    "Account connection issue",
  );
  expect(calls).toContain("POST /auth/v1/logout");
  expect(calls).toContain("logout-authorized:true");
  await page.reload();
  await expect(page.locator("body")).toContainText("Anonymous record");
  await expect(page.locator("body")).not.toContainText("Account record");
});
