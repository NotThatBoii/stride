import { expect, test, type Page } from "@playwright/test";
import { defaults, type Data } from "../../src/models";
import {
  authOrigin,
  expectNoStudySync,
  expectAccountStudySync,
  mockAuth,
  seedAccount,
  signIn,
  users,
} from "../auth-mock";

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

async function legacySnapshot(page: Page) {
  return page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    return {
      data: await storage.readData(storage.database),
      recovery: await storage.database.recoveryCopies.toArray(),
      metadata: await storage.database.meta.toArray(),
      raw: localStorage.getItem("stride-browser-preview-v1"),
    };
  });
}

async function seedLegacy(page: Page) {
  const data = studyData("Legacy private history");
  data.running = {
    id: "legacy-running",
    subjectId: "subject-Legacy private history",
    startedAt: "2026-09-20T10:00:00.000Z",
    title: "Legacy private focus",
    mode: "stopwatch",
    target: 1500,
    segments: [],
    runningSince: Date.now(),
    notified: false,
  };
  await page.evaluate(async (value) => {
    const storage = await import("/src/lib/storage.ts");
    localStorage.setItem("stride-browser-preview-v1", JSON.stringify(value));
    await storage.initialize(storage.database);
    await storage.database.recoveryCopies.put({
      id: "legacy-recovery",
      reason: "json_restore",
      entity: null,
      record_id: null,
      snapshot: value,
      created_at: "2026-09-20T10:00:00.000Z",
    });
  }, data);
  return legacySnapshot(page);
}

async function watchPrivateScreens(page: Page) {
  await page.addInitScript(() => {
    const exposed: string[] = [];
    (window as unknown as { privateScreens: string[] }).privateScreens =
      exposed;
    new MutationObserver(() => {
      if (document.querySelector(".auth-screen")) exposed.push("login");
      if (document.body?.innerText.includes("Legacy private history"))
        exposed.push("legacy");
    }).observe(document, { childList: true, subtree: true });
  });
}

async function submitCredentials(page: Page, password = "password123") {
  await page.getByLabel("Email", { exact: true }).fill("first@example.test");
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.locator(".account-form button").click();
}

test("logged-out entry exposes only authentication and leaves raw legacy data untouched", async ({
  page,
}, testInfo) => {
  const server = await mockAuth(page);
  const raw = JSON.stringify(studyData("Legacy private history"));
  await page.addInitScript((value) => {
    localStorage.setItem("stride-browser-preview-v1", value);
  }, raw);
  await page.goto("/");
  await expect(
    page.getByRole("heading", { name: "Welcome to Stride." }),
  ).toBeVisible();
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.getByLabel("Email", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
  await expect(page.locator(".app, .onboarding, .floating-timer")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: /continue as guest|continue locally|skip account|find your stride/i,
    }),
  ).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText(
    "Legacy private history",
  );
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.goto("/#/Home");
  await expect(page.locator(".auth-screen")).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("stride-browser-preview-v1"),
    ),
  ).toBe(raw);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    ),
  ).not.toContain("stride");
  await page.screenshot({
    path: testInfo.outputPath("auth-desktop.png"),
    fullPage: true,
  });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath("auth-narrow.png"),
    fullPage: true,
  });
  expectNoStudySync(server.calls);
});

test("successful sign-in opens its account workspace and authenticated onboarding", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Subject name", exact: true })
    .fill("Account subject");
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  expect(
    await page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      return storage.getActiveDatabase().name;
    }),
  ).toBe(`stride-account-${users["first@example.test"]}`);
  expectAccountStudySync(server.calls);
});

test("sign-up validation and email confirmation keep the user outside the app", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  const legacy = await seedLegacy(page);
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Create account" })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("not-an-email");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.locator(".account-form button").click();
  expect(server.calls.some((call) => call.includes("/signup"))).toBe(false);
  expect(
    await page
      .getByLabel("Email", { exact: true })
      .evaluate((input: HTMLInputElement) => input.validity.valid),
  ).toBe(false);
  await page.getByLabel("Email", { exact: true }).fill("new@example.test");
  await page.locator(".account-form button").click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  await expect(page.locator(".app, .onboarding")).toHaveCount(0);
  expect(await legacySnapshot(page)).toEqual(legacy);
  expect(
    await page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      return storage.getActiveWorkspace().accountId;
    }),
  ).toBeNull();
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Sign in" })
    .click();
  await expect(page.getByLabel("Password", { exact: true })).toHaveValue("");
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  expect(await legacySnapshot(page)).toEqual(legacy);
  expectAccountStudySync(server.calls);
});

test("a sign-up response containing an official session opens authenticated onboarding", async ({
  page,
}) => {
  const server = await mockAuth(page, { signupSession: true });
  await page.goto("/");
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Create account" })
    .click();
  await submitCredentials(page);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  expectAccountStudySync(server.calls);
});

test("invalid sign-in displays an error without opening study data", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  await submitCredentials(page, "wrong-password");
  await expect(page.getByRole("alert")).toContainText(
    "Invalid login credentials",
  );
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator(".app, .onboarding")).toHaveCount(0);
  await expect(page.locator(".account-form button")).toBeEnabled();
  expectNoStudySync(server.calls);
});

test("offline sign-in failure stays behind the authentication gate", async ({
  page,
}) => {
  const server = await mockAuth(page, { failSignIn: true });
  await page.goto("/");
  await page.context().setOffline(true);
  await submitCredentials(page);
  await expect(page.getByRole("alert")).toContainText(
    /fetch|network|connect|offline/i,
  );
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator(".app, .onboarding, .floating-timer")).toHaveCount(
    0,
  );
  await expect(page.locator(".account-form button")).toBeEnabled();
  expectNoStudySync(server.calls);
});

test("an existing valid session restores its onboarded account without showing login", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  await seedLegacy(page);
  await signIn(page);
  await seedAccount(page, studyData("Restored account history"));
  await watchPrivateScreens(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText("Restored account history");
  await expect(page.locator(".auth-screen, .onboarding")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { privateScreens: string[] }).privateScreens,
    ),
  ).toEqual([]);
  expectAccountStudySync(server.calls);
});

test("restored accounts that have not completed onboarding resume authenticated onboarding", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await watchPrivateScreens(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect(page.locator(".auth-screen, .app")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { privateScreens: string[] }).privateScreens,
    ),
  ).toEqual([]);
});

test("a valid saved session restores cached account data when Auth is unreachable", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await seedAccount(page, studyData("Offline cached account history"));
  await page.unroute(`${authOrigin}/**`);
  const unavailableCalls: string[] = [];
  await page.route(`${authOrigin}/**`, (route) => {
    unavailableCalls.push(route.request().url());
    return route.abort("internetdisconnected");
  });
  // Keep the local test bundle accessible while the external Auth service is
  // unreachable. Authentication still follows auth-js's persisted-session path.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "onLine", { get: () => false });
  });
  await watchPrivateScreens(page);
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText(
    "Offline cached account history",
  );
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  expect(
    await page.evaluate(
      () => (window as unknown as { privateScreens: string[] }).privateScreens,
    ),
  ).toEqual([]);
  expect(unavailableCalls).toEqual([]);
});

test("official session refresh keeps bootstrap visible without flashing login or legacy data", async ({
  page,
}) => {
  const server = await mockAuth(page, {
    holdRefresh: true,
  });
  try {
    await page.goto("/");
    await seedLegacy(page);
    await signIn(page);
    await seedAccount(page, studyData("Refreshed account history"));
    // Expire only after the ordinary import fixture has completed. Otherwise
    // initial sync waits on this test's held refresh before seeding can lock.
    await server.expireSavedSession();
    await watchPrivateScreens(page);
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect
      .poll(() =>
        server.calls.some((call) => call.includes("grant_type=refresh_token")),
      )
      .toBe(true);
    await expect(page.locator(".boot")).toBeVisible();
    await expect(page.locator(".auth-screen, .app, .onboarding")).toHaveCount(
      0,
    );
    await expect(page.locator("body")).not.toContainText(
      "Legacy private history",
    );
    await expect(page.locator("body")).not.toContainText(
      "Refreshed account history",
    );
    server.releaseRefresh();
    await expect(page.locator("body")).toContainText(
      "Refreshed account history",
    );
    await expect(page.locator(".auth-screen")).toHaveCount(0);
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { privateScreens: string[] }).privateScreens,
      ),
    ).toEqual([]);
    expectAccountStudySync(server.calls);
  } finally {
    server.releaseRefresh();
  }
});

test("sign-out immediately hides timers and study data while preserving all local histories", async ({
  page,
}) => {
  const server = await mockAuth(page, { holdLogout: true });
  try {
    await page.goto("/");
    const legacy = await seedLegacy(page);
    await signIn(page);
    await seedAccount(page, studyData("Account private history"));
    await page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      await storage.saveRunning({
        id: "account-running",
        subjectId: "subject-Account private history",
        startedAt: new Date().toISOString(),
        title: "Account private focus",
        mode: "stopwatch",
        target: 1500,
        segments: [],
        runningSince: Date.now(),
        notified: false,
      });
    });
    await expect(page.locator(".floating-timer")).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page.locator(".auth-screen")).toBeVisible();
    await expect(page.locator(".app, .floating-timer")).toHaveCount(0);
    await expect(page.locator("body")).not.toContainText(
      "Account private history",
    );
    await expect(page.locator("body")).not.toContainText(
      "Legacy private history",
    );
    await expect
      .poll(() => server.calls.includes("logout-authorized:true"))
      .toBe(true);
    expect(await legacySnapshot(page)).toEqual(legacy);
    server.releaseLogout();
    await expect
      .poll(() =>
        page.evaluate(() =>
          localStorage.getItem(
            "stride-auth-v1-fotgomkjwbahxmmovzmn.supabase.co",
          ),
        ),
      )
      .toBeNull();
    await signIn(page);
    await expect(page.locator("body")).toContainText("Account private history");
    await expect(page.locator(".floating-timer")).toBeVisible();
    expect(await legacySnapshot(page)).toEqual(legacy);
    expectAccountStudySync(server.calls);
  } finally {
    server.releaseLogout();
  }
});

test("failed remote logout stays signed out after reload and preserves account data", async ({
  page,
}) => {
  const server = await mockAuth(page, { failLogout: true });
  await page.goto("/");
  const legacy = await seedLegacy(page);
  await signIn(page);
  await seedAccount(page, studyData("Offline account history"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    "Check your connection and try again",
  );
  await page.reload();
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(
    "Offline account history",
  );
  await expect(page.locator("body")).not.toContainText(
    "Legacy private history",
  );
  expect(await legacySnapshot(page)).toEqual(legacy);
  await signIn(page);
  await expect(page.locator("body")).toContainText("Offline account history");
  expectAccountStudySync(server.calls);
});

test("a newly signed-in user can sign out directly from onboarding", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Account" })
    .getByRole("button", { name: "Sign out", exact: true })
    .click();
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator(".onboarding, .app")).toHaveCount(0);
});
