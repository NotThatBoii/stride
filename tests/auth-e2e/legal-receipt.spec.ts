import { expect, test, type Page } from "@playwright/test";
import {
  authOrigin,
  mockAuth,
  requestAccount,
  signIn,
  users,
} from "../auth-mock";
const versions = {
  p_terms_version: "2026-10-07",
  p_privacy_version: "2026-10-07",
};
const serverReceipt = {
  terms_version: "2026-10-07",
  privacy_version: "2026-10-07",
  accepted_at: "2026-10-07T02:15:00.123456+00:00",
};

async function receipts(page: Page) {
  const calls: { action: string; account: string | null; body: unknown }[] = [];
  const saved = new Map<string, typeof serverReceipt>();
  let mode = "ok";
  let holdRecord = false;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  await page.route(
    `${authOrigin}/rest/v1/rpc/*legal_acceptance`,
    async (route) => {
      const request = route.request();
      const action = new URL(request.url()).pathname.endsWith(
        "record_legal_acceptance",
      )
        ? "record"
        : "read";
      const account = requestAccount(request);
      const body = request.postDataJSON();
      calls.push({ action, account, body });
      const respond = (status: number, data: unknown) =>
        route
          .fulfill({
            status,
            contentType: "application/json",
            body: JSON.stringify(data),
          })
          .catch(() => {});
      if (!account)
        return respond(401, {
          code: "28000",
          message: "private-auth-diagnostic",
        });
      if (mode === "missing")
        return respond(404, {
          code: "PGRST202",
          message: "Bearer private-service-diagnostic",
        });
      if (mode === "version")
        return respond(400, {
          code: "22023",
          message: "private-version-diagnostic",
        });
      if (mode === "malformed")
        return respond(200, {
          ...serverReceipt,
          owner_id: users["second@example.test"],
        });
      if (action === "record") {
        if (!saved.has(account)) saved.set(account, serverReceipt);
        if (holdRecord) await gate;
      }
      return respond(200, saved.get(account) ?? null);
    },
  );
  return {
    calls,
    saved,
    release,
    setMode(value: string) {
      mode = value;
    },
    holdWrites() {
      holdRecord = true;
    },
  };
}
async function account(page: Page) {
  await page.getByRole("button", { name: "Account", exact: true }).click();
  return page.getByRole("dialog", { name: "Account", exact: true });
}

test("opening Account and reading current documents never records a receipt", async ({
  page,
}) => {
  await mockAuth(page);
  const server = await receipts(page);
  await page.goto("/");
  await signIn(page);
  const panel = await account(page);
  await expect(
    panel.getByText("No receipt is recorded for these document versions."),
  ).toBeVisible();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  await expect(
    panel.getByRole("button", { name: "Record acknowledgement" }),
  ).toBeDisabled();
  for (const title of ["Terms of Service", "Data & Privacy Notice"]) {
    await expect(
      panel.getByRole("link", { name: title, exact: true }),
    ).toHaveCount(1);
    await panel.getByRole("link", { name: title, exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: title, exact: true }).locator("article"),
    ).toHaveAttribute("data-version", "2026-10-07");
    await page.keyboard.press("Escape");
    await expect(
      panel.getByRole("link", { name: title, exact: true }),
    ).toBeFocused();
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
  }
  expect(server.calls.some((call) => call.action === "record")).toBe(false);
  expect(
    server.calls.filter((call) => call.action === "read").length,
  ).toBeGreaterThan(0);
});

test("intentional keyboard acknowledgement records exact version args and displays server time without local persistence", async ({
  page,
}) => {
  await mockAuth(page);
  const server = await receipts(page);
  await page.goto("/");
  await signIn(page);
  const panel = await account(page);
  const checkbox = panel.getByRole("checkbox");
  await expect(checkbox).not.toBeChecked();
  await checkbox.focus();
  await page.keyboard.press("Space");
  expect(server.calls.filter((call) => call.action === "record")).toHaveLength(
    0,
  );
  await panel.getByRole("button", { name: "Record acknowledgement" }).click();
  const status = panel.locator(".receipt-status");
  await expect(status).toBeVisible();
  await expect(status).toBeFocused();
  await expect(status.locator("time")).toHaveAttribute(
    "datetime",
    serverReceipt.accepted_at,
  );
  expect(server.calls.filter((call) => call.action === "record")).toEqual([
    { action: "record", account: users["first@example.test"], body: versions },
  ]);
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "Terms of Service", exact: true }),
  ).toHaveCount(1);
  await panel.getByRole("button", { name: "Check receipt status" }).click();
  await expect(status).toBeVisible();
  expect(server.calls.filter((call) => call.action === "record")).toHaveLength(
    1,
  );
  expect(
    await page.evaluate(async (marker) => {
      const storage = await import("/src/lib/storage.ts");
      const db = storage.getActiveDatabase();
      const tables = await Promise.all(
        db.tables.map((table) => table.toArray()),
      );
      return (
        JSON.stringify(tables).includes(marker) ||
        Object.values(localStorage).some((value) => value.includes(marker))
      );
    }, serverReceipt.accepted_at),
  ).toBe(false);
});

test("missing service, version mismatch and offline retry show safe guidance while study access stays available", async ({
  page,
  context,
}) => {
  await mockAuth(page);
  const server = await receipts(page);
  server.setMode("missing");
  await page.goto("/");
  await signIn(page);
  const panel = await account(page);
  await expect(panel).toContainText("Receipt recording is not available yet.");
  await expect(panel).not.toContainText("private-service-diagnostic");
  await expect(
    panel.getByRole("link", { name: "Data & Privacy Notice", exact: true }),
  ).toHaveCount(1);
  server.setMode("version");
  await panel.getByRole("button", { name: "Check receipt status" }).click();
  await expect(panel.getByRole("alert")).toContainText("document versions");
  await expect(panel).not.toContainText("private-version-diagnostic");
  await context.setOffline(true);
  await panel.getByRole("button", { name: "Check receipt status" }).click();
  await expect(panel.getByRole("alert")).toContainText(
    "Connect to the internet",
  );
  await context.setOffline(false);
  server.setMode("ok");
  await panel.getByRole("button", { name: "Check receipt status" }).click();
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  expect(server.calls.some((call) => call.action === "record")).toBe(false);
  await panel
    .getByRole("button", { name: "Close dialog", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
});

test("malformed receipts cannot display an owner or accepted time or imply a successful recording", async ({
  page,
}) => {
  await mockAuth(page);
  const server = await receipts(page);
  server.setMode("malformed");
  await page.goto("/");
  await signIn(page);
  const panel = await account(page);
  await expect(panel).toContainText("Could not check your acknowledgement.");
  await expect(panel.locator(".receipt-status")).toHaveCount(0);
  await expect(panel).not.toContainText(serverReceipt.accepted_at);
  await expect(panel).not.toContainText(users["second@example.test"]);
  expect(server.calls.some((call) => call.action === "record")).toBe(false);
});

test("an old account's held record cannot become the new account's receipt or consent", async ({
  page,
}) => {
  await mockAuth(page);
  const server = await receipts(page);
  server.holdWrites();
  await page.goto("/");
  await signIn(page);
  let panel = await account(page);
  await panel.getByRole("checkbox").check();
  await panel.getByRole("button", { name: "Record acknowledgement" }).click();
  await expect
    .poll(() => server.calls.filter((call) => call.action === "record").length)
    .toBe(1);
  await panel.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".auth-screen")).toBeVisible();
  await signIn(page, "second@example.test");
  panel = await account(page);
  await expect(panel.getByRole("checkbox")).not.toBeChecked();
  server.release();
  await expect(panel).toContainText(
    "No receipt is recorded for these document versions.",
  );
  await expect(panel.locator(".receipt-status")).toHaveCount(0);
  expect(server.saved.has(users["first@example.test"])).toBe(true);
  expect(server.saved.has(users["second@example.test"])).toBe(false);
});

test("an unconfirmed local session gets no optional receipt request and is never pushed through signup again", async ({
  page,
}) => {
  await mockAuth(page, { confirmed: false });
  const server = await receipts(page);
  await page.goto("/");
  await signIn(page);
  const panel = await account(page);
  await expect(panel).toContainText("Confirm your email, then sign in again");
  await expect(panel.getByRole("checkbox")).toHaveCount(0);
  await expect(
    panel.getByRole("link", { name: "Terms of Service", exact: true }),
  ).toHaveCount(1);
  expect(server.calls).toHaveLength(0);
  await expect(page.locator(".auth-screen")).toHaveCount(0);
});

for (const width of [360, 390, 430])
  test(`optional receipt and legal controls fit ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockAuth(page);
    await receipts(page);
    await page.goto("/");
    await signIn(page);
    const panel = await account(page);
    await expect(panel.getByRole("checkbox")).not.toBeChecked();
    expect(
      await panel.evaluate(
        (element) => element.scrollWidth <= element.clientWidth,
      ),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`receipt-${width}.png`),
    });
  });
