import { test, expect, chromium, type Page } from "@playwright/test";
import { authOrigin, mockAuth, users } from "../auth-mock";
import { SqlSyncServer } from "../sync-fixture";

const origin = "http://127.0.0.1:1426";
const database = `stride-account-${users["first@example.test"]}`;

async function ready(page: Page) {
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
}

async function snapshot(page: Page) {
  return page.evaluate(async (name) => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(name);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    try {
      const stores = [
        "subjects",
        "sessions",
        "slices",
        "timers",
        "pendingOperations",
      ];
      return await new Promise<Record<string, unknown[]>>((resolve, reject) => {
        const transaction = db.transaction(stores);
        const value: Record<string, unknown[]> = {};
        for (const store of stores) {
          const request = transaction.objectStore(store).getAll();
          request.onsuccess = () => {
            value[store] = request.result;
          };
        }
        transaction.oncomplete = () => resolve(value);
        transaction.onerror = () => reject(transaction.error);
      });
    } finally {
      db.close();
    }
  }, database);
}

async function signInAndOnboard(page: Page) {
  await page.getByLabel("Email", { exact: true }).fill("first@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.locator(".account-form button").click();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await page
    .getByLabel("Subject name", { exact: true })
    .fill("PWA offline mathematics");
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
}

async function startPausedTimer(page: Page) {
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page.getByRole("button", { name: "Stopwatch", exact: true }).click();
  await page
    .getByLabel("Session title", { exact: true })
    .fill("Offline PWA session");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
}

async function saveTimer(page: Page) {
  const floating = page.getByRole("button", { name: /Paused/ });
  if (await floating.count()) await floating.click();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page.getByRole("button", { name: "Save session", exact: true }).click();
}

test.beforeEach(async ({ request }) => {
  await request.post(`${origin}/__test/release?version=A`);
  await request.post(`${origin}/__test/worker?unavailable=false`);
});

test("Chromium parses an installable manifest and caches only the exact static shell", async ({
  page,
  context,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await ready(page);
  const cdp = await context.newCDPSession(page);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
  const value = JSON.parse(manifest.data!);
  expect(value).toMatchObject({
    short_name: "Stride",
    display: "standalone",
    start_url: "/",
    scope: "/",
  });
  expect(value.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "192x192",
    "512x512",
  ]);
  expect(
    (
      await cdp.send("Page.getInstallabilityErrors")
    ).installabilityErrors.filter((error) => error.errorId !== "in-incognito"),
  ).toEqual([]);
  await page
    .getByRole("button", { name: "Create account", exact: true })
    .first()
    .click();
  await page
    .getByLabel("Email", { exact: true })
    .fill("private-confirmation@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.locator(".account-form button").click();
  await expect(
    page.getByText("Check your email to confirm your account, then sign in."),
  ).toBeVisible();
  await page.evaluate(async (auth) => {
    await fetch("/__test/private");
    await fetch("/index.html?code=PRIVATE_CALLBACK_SENTINEL");
    await fetch(`${auth}/auth/v1/user`);
    await fetch(`${auth}/rest/v1/rpc/get_sync_changes`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
  }, authOrigin);
  const caches = await page.evaluate(async () => {
    const entries = [];
    for (const name of await window.caches.keys()) {
      const cache = await window.caches.open(name);
      for (const request of await cache.keys()) {
        entries.push({
          name,
          url: request.url,
          body: await (await cache.match(request))!.text(),
        });
      }
    }
    return entries;
  });
  expect(caches.length).toBeGreaterThanOrEqual(7);
  for (const entry of caches) {
    const url = new URL(entry.url);
    expect(url.origin).toBe(origin);
    expect(url.search).toBe("");
    expect(url.hash).toBe("");
    expect(url.pathname).toMatch(
      /^\/(__stride_shell_activated__|index\.html|manifest\.webmanifest|icons\/(stride\.svg|(?:192|512|180)x(?:192|512|180)\.png)|assets\/[^/]+\.(js|css|svg|png|webp|woff2?))$/,
    );
    expect(entry.body).not.toMatch(
      /private-confirmation@example\.test|STRIDE_PRIVATE_RESPONSE_SENTINEL|PRIVATE_CALLBACK_SENTINEL/,
    );
  }
  await context.setOffline(true);
  await expect(
    page.evaluate(async () => fetch("/?code=PRIVATE_CALLBACK_SENTINEL")),
  ).rejects.toThrow();
  await expect(
    page.evaluate(async () => fetch("/__test/private")),
  ).rejects.toThrow();
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator(".auth-screen")).toBeVisible();
});

test("the production shell reopens offline with account data, pending writes, and a paused timer; reconnect syncs and sign-out stays closed", async ({
  page,
  context,
}) => {
  const server = await SqlSyncServer.create();
  try {
    await mockAuth(page);
    await server.attach(page);
    await page.goto("/");
    await ready(page);
    await signInAndOnboard(page);
    await expect
      .poll(async () => (await snapshot(page)).pendingOperations.length, {
        timeout: 20_000,
      })
      .toBe(0);
    await context.setOffline(true);
    await page.getByRole("button", { name: "Subjects", exact: true }).click();
    await page
      .getByRole("button", { name: "Add subject", exact: true })
      .first()
      .click();
    await page
      .getByLabel("Subject name", { exact: true })
      .fill("Created entirely offline");
    await page
      .getByRole("button", { name: "Create subject", exact: true })
      .click();
    await startPausedTimer(page);
    const before = await snapshot(page);
    expect(before.subjects).toHaveLength(2);
    expect(before.pendingOperations.length).toBeGreaterThan(0);
    expect(before.timers).toHaveLength(1);
    await page.close();
    const reopened = await context.newPage();
    await mockAuth(reopened);
    await server.attach(reopened);
    const response = await reopened.goto("/");
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(
      reopened.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    expect(await snapshot(reopened)).toEqual(before);
    await saveTimer(reopened);
    await reopened
      .getByRole("button", { name: "Settings", exact: true })
      .click();
    await expect(
      reopened.getByText("The app is ready to reopen offline.", {
        exact: false,
      }),
    ).toBeVisible();
    await context.setOffline(false);
    await expect
      .poll(async () => (await snapshot(reopened)).pendingOperations.length, {
        timeout: 25_000,
      })
      .toBe(0);
    expect(await server.rows("subjects")).toHaveLength(2);
    expect(await server.rows("sessions")).toHaveLength(1);
    await context.setOffline(true);
    await reopened
      .getByRole("button", { name: "Sign out", exact: true })
      .click();
    await expect(reopened.locator(".auth-screen")).toBeVisible();
    await reopened.reload();
    await expect(reopened.locator(".auth-screen")).toBeVisible();
    await expect(
      reopened.getByText("Created entirely offline", { exact: true }),
    ).toHaveCount(0);
    expect((await snapshot(reopened)).subjects).toHaveLength(2);
    expect((await snapshot(reopened)).sessions).toHaveLength(1);
  } finally {
    await server.close();
  }
});

test("updates wait for explicit acceptance, protect timers and other windows, preserve unsynced data, and bound old shell caches", async ({
  page,
  context,
  request,
}) => {
  const server = await SqlSyncServer.create();
  server.unavailable = true;
  try {
    await mockAuth(page);
    await server.attach(page);
    await page.goto("/");
    await ready(page);
    await signInAndOnboard(page);
    await startPausedTimer(page);
    const timer = (await snapshot(page)).timers;
    await request.post(`${origin}/__test/release?version=B`);
    await page.getByRole("button", { name: /Back to workspace/ }).click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.locator(".pwa-update-notice")).toBeVisible();
    await expect(
      page
        .locator(".pwa-update-notice")
        .getByRole("button", { name: "Reload to update" }),
    ).toBeDisabled();
    expect((await snapshot(page)).timers).toEqual(timer);
    await expect(
      page.locator('meta[name="stride-test-release"]'),
    ).toHaveAttribute("content", "A");
    await page.getByRole("button", { name: "Later", exact: true }).click();
    await saveTimer(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const before = await snapshot(page);
    expect(before.pendingOperations.length).toBeGreaterThan(0);
    const other = await context.newPage();
    await mockAuth(other);
    await server.attach(other);
    await other.goto("/");
    await expect(
      other.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Reload to update", exact: true })
      .click();
    await expect(
      page.getByText(
        "Close other Stride windows before updating, then try again.",
        { exact: true },
      ),
    ).toBeVisible();
    await expect(
      page.locator('meta[name="stride-test-release"]'),
    ).toHaveAttribute("content", "A");
    expect((await snapshot(page)).subjects).toEqual(before.subjects);
    expect((await snapshot(page)).sessions).toEqual(before.sessions);
    await other.close();
    await page
      .getByRole("button", { name: "Reload to update", exact: true })
      .click();
    await expect(
      page.locator('meta[name="stride-test-release"]'),
    ).toHaveAttribute("content", "B");
    await expect(
      page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    const after = await snapshot(page);
    expect(after.subjects).toEqual(before.subjects);
    expect(after.sessions).toEqual(before.sessions);
    expect(after.slices).toEqual(before.slices);
    expect(after.pendingOperations).toEqual(before.pendingOperations);
    await request.post(`${origin}/__test/release?version=C`);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect(page.locator(".pwa-update-notice")).toBeVisible();
    await request.post(`${origin}/__test/release?version=D`);
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const registration = await navigator.serviceWorker.getRegistration();
          const names = await caches.keys();
          return (
            Boolean(registration?.waiting) &&
            names.some((name) => name.endsWith("-test-D")) &&
            !names.some((name) => name.endsWith("-test-C"))
          );
        }),
      )
      .toBe(true);
    expect(
      await page.evaluate(
        async () =>
          (await caches.keys()).filter((name) =>
            name.startsWith("stride-shell-v1-"),
          ).length,
      ),
    ).toBe(3);
    await page
      .locator(".pwa-update-notice")
      .getByRole("button", { name: "Reload to update" })
      .click();
    await expect(
      page.locator('meta[name="stride-test-release"]'),
    ).toHaveAttribute("content", "D");
    await expect
      .poll(() =>
        page.evaluate(
          async () =>
            (await caches.keys()).filter((name) =>
              name.startsWith("stride-shell-v1-"),
            ).length,
        ),
      )
      .toBe(2);
  } finally {
    await server.close();
  }
});

test("a compiled production app never registers its web worker when the native platform is detected", async ({
  page,
}) => {
  await page.addInitScript(() => {
    (globalThis as typeof globalThis & { isTauri: boolean }).isTauri = true;
  });
  const requests: string[] = [];
  page.on("request", (request) =>
    requests.push(new URL(request.url()).pathname),
  );
  await mockAuth(page);
  await page.goto("/");
  await expect(page.locator(".auth-screen")).toBeVisible();
  expect(
    await page.evaluate(() =>
      navigator.serviceWorker.getRegistrations().then((value) => value.length),
    ),
  ).toBe(0);
  expect(requests).not.toContain("/sw.js");
});

test("a failed first worker registration recovers through the visible update action without replacing local study data", async ({
  page,
  request,
}) => {
  const server = await SqlSyncServer.create();
  server.unavailable = true;
  try {
    await request.post(`${origin}/__test/worker?unavailable=true`);
    await mockAuth(page);
    await server.attach(page);
    await page.goto("/");
    await signInAndOnboard(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByText(
        "Offline access is not ready. Stay connected and check for updates again.",
        { exact: true },
      ),
    ).toBeVisible();
    const before = await snapshot(page);
    await request.post(`${origin}/__test/worker?unavailable=false`);
    await page
      .getByRole("button", { name: "Check for updates", exact: true })
      .click();
    await ready(page);
    await expect(
      page.getByText("The app is ready to reopen offline.", { exact: false }),
    ).toBeVisible();
    expect(await snapshot(page)).toEqual(before);
  } finally {
    await server.close();
  }
});

test("isolated Chromium PWA installation and standalone launch restore the account workspace when platform support is available", async ({}, testInfo) => {
  test.skip(
    process.env.STRIDE_TEST_PWA_INSTALL !== "1",
    "OS PWA installation is opt-in. Headless Edge's experimental launch command does not complete on this host; manifest and worker coverage run separately.",
  );
  const profile = testInfo.outputPath("isolated-installed-profile");
  const context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
    viewport: { width: 390, height: 844 },
  });
  const server = await SqlSyncServer.create();
  let installed = false;
  const page = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(page);
  try {
    // The installed window inherits the same isolated profile routes.
    const transport = { route: context.route.bind(context) } as Page;
    await mockAuth(transport);
    await server.attach(transport);
    await page.goto(origin);
    await ready(page);
    expect(
      (await cdp.send("Page.getInstallabilityErrors")).installabilityErrors,
    ).toEqual([]);
    await signInAndOnboard(page);
    try {
      console.log("PWA experiment: installing isolated app");
      await cdp.send(
        "PWA.install" as never,
        {
          manifestId: `${origin}/`,
          installUrlOrBundleUrl: `${origin}/`,
        } as never,
      );
      installed = true;
      console.log("PWA experiment: install completed");
      await cdp.send(
        "PWA.changeAppUserSettings" as never,
        { manifestId: `${origin}/`, displayMode: "standalone" } as never,
      );
      console.log("PWA experiment: standalone preference set");
    } catch (error) {
      const reason =
        error instanceof Error
          ? error.message
          : "Experimental PWA installation unavailable";
      await testInfo.attach("PWA-platform-limitation", {
        body: reason,
        contentType: "text/plain",
      });
      test.skip(
        true,
        `Isolated Edge cannot perform experimental PWA installation: ${reason}`,
      );
    }
    const launched = context
      .waitForEvent("page", { timeout: 5_000 })
      .catch(() => null);
    const launchedTarget = await Promise.race([
      cdp
        .send("PWA.launch" as never, { manifestId: `${origin}/` } as never)
        .catch(() => null),
      new Promise<null>((resolve) => setTimeout(() => resolve(null), 5_000)),
    ]);
    console.log("PWA experiment: launch returned", launchedTarget);
    const app = await launched;
    if (!app) {
      console.log("PWA experiment: launch produced no page event");
      await testInfo.attach("PWA-launch-platform-limitation", {
        body: JSON.stringify({
          installed: true,
          standalonePreferenceSet: true,
          launchCompleted: Boolean(launchedTarget),
          controlledPageAvailable: false,
        }),
        contentType: "application/json",
      });
      test.skip(
        true,
        "Headless Edge acknowledged experimental installation, but standalone launch was not exposed as a controllable browser page. OS installation remains unverified.",
      );
    }
    await app.waitForLoadState();
    await expect(
      app.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    expect(
      await app.evaluate(
        () => matchMedia("(display-mode: standalone)").matches,
      ),
    ).toBe(true);
    expect((await snapshot(app)).subjects).toHaveLength(1);
    await context.setOffline(true);
    const response = await app.reload();
    expect(response?.fromServiceWorker()).toBe(true);
    await expect(
      app.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await testInfo.attach("PWA-platform-result", {
      body: "Installed in isolated Edge profile; standalone launch, account restoration, IndexedDB retention, and offline reload verified.",
      contentType: "text/plain",
    });
  } finally {
    console.log("PWA experiment: cleaning isolated install", installed);
    try {
      if (installed)
        await cdp.send(
          "PWA.uninstall" as never,
          { manifestId: `${origin}/` } as never,
        );
      console.log("PWA experiment: uninstall completed");
    } finally {
      try {
        await context.close();
      } finally {
        await server.close();
      }
    }
  }
});
