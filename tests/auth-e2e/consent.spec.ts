import { expect, test, type Page } from "@playwright/test";
import { authOrigin, expectNoStudySync, mockAuth, signIn } from "../auth-mock";

const consentName =
  "I agree to the Terms of Service and acknowledge the Data & Privacy Notice.";
const consentMessage =
  "Agree to the Terms of Service and acknowledge the Data & Privacy Notice before creating your account.";

async function signup(page: Page) {
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await page.getByLabel("Email", { exact: true }).fill("new@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password123");
}

test("consent defaults unchecked and native or malformed UI submission cannot bypass the signup guard", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  await signup(page);
  const consent = page.getByRole("checkbox", {
    name: consentName,
    exact: true,
  });
  await expect(consent).not.toBeChecked();
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("alert")).toHaveText(consentMessage);
  await expect(consent).toHaveAttribute("aria-invalid", "true");
  await expect(consent).toBeFocused();
  await page.evaluate(() => {
    const checkbox =
      document.querySelector<HTMLInputElement>("#signup-consent")!;
    checkbox.removeAttribute("required");
    checkbox.checked = true;
    document
      .querySelector(".account-form")!
      .dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  await expect(page.getByRole("alert")).toHaveText(consentMessage);
  expect(server.calls.some((call) => call.includes("/signup"))).toBe(false);
  await expect(page.locator(".auth-screen")).toBeVisible();
  expectNoStudySync(server.calls);
});

test("valid signup with intentional consent submits ordinary Auth credentials without acceptance metadata", async ({
  page,
}) => {
  const server = await mockAuth(page);
  const requests: Record<string, unknown>[] = [];
  page.on("request", (request) => {
    if (
      new URL(request.url()).pathname === "/auth/v1/signup" &&
      request.method() === "POST"
    )
      requests.push(request.postDataJSON());
  });
  await page.goto("/");
  await signup(page);
  await page.getByRole("checkbox", { name: consentName, exact: true }).check();
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("status")).toContainText("Check your email");
  expect(requests).toHaveLength(1);
  expect(requests[0]).toMatchObject({
    email: "new@example.test",
    password: "password123",
    data: {},
  });
  expect(JSON.stringify(requests[0])).not.toMatch(
    /terms.?version|privacy.?version|accepted.?at/i,
  );
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await expect(page.locator(".app, .onboarding")).toHaveCount(0);
  expectNoStudySync(server.calls);
});

test("legal links and consent work by keyboard, preserve unchecked state, and return focus", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signup(page);
  const consent = page.getByRole("checkbox", {
    name: consentName,
    exact: true,
  });
  for (const title of ["Terms of Service", "Data & Privacy Notice"]) {
    const link = page.getByRole("link", { name: title, exact: true });
    await link.focus();
    await page.keyboard.press("Enter");
    const dialog = page.getByRole("dialog", { name: title, exact: true });
    await expect(dialog).toBeVisible();
    await expect(dialog.locator("article")).toHaveAttribute(
      "data-version",
      "2026-10-07",
    );
    await expect(dialog).toContainText(
      title === "Terms of Service"
        ? "Availability, warranties and liability"
        : "Local account separation is an application boundary, not local encryption.",
    );
    await expect(consent).not.toBeChecked();
    const close = dialog.getByRole("button", { name: "Close legal document" });
    await close.focus();
    await page.keyboard.press("Shift+Tab");
    await expect(
      dialog.getByRole("button", { name: "Done", exact: true }),
    ).toBeFocused();
    await page.keyboard.press("Tab");
    await expect(close).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
    await expect(link).toBeFocused();
  }
  await consent.focus();
  await page.keyboard.press("Space");
  await expect(consent).toBeChecked();
  await page.keyboard.press("Tab");
  await expect(
    page.getByRole("link", { name: "Terms of Service", exact: true }),
  ).toBeFocused();
  expect(
    await page
      .getByRole("link", { name: "Terms of Service", exact: true })
      .evaluate((link) => getComputedStyle(link).outlineStyle),
  ).toBe("solid");
});

test("switching account modes resets consent while existing sign-in remains available", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signup(page);
  await page.getByRole("checkbox").check();
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).toHaveCount(0);
  await signup(page);
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Sign in", exact: true })
    .click();
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
});

test("authenticated accounts can read legal documents from Account without repeating signup", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await page.getByRole("button", { name: "Account", exact: true }).click();
  const account = page.getByRole("dialog", { name: "Account", exact: true });
  await account
    .getByRole("link", { name: "Data & Privacy Notice", exact: true })
    .click();
  const privacy = page.getByRole("dialog", {
    name: "Data & Privacy Notice",
    exact: true,
  });
  await expect(privacy).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(account).toBeVisible();
  await expect(
    account.getByRole("link", { name: "Data & Privacy Notice", exact: true }),
  ).toBeFocused();
  await expect(page.locator(".auth-screen")).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: consentName })).toHaveCount(
    0,
  );
});

for (const width of [360, 390, 430]) {
  test(`signup consent and readable legal dialogs fit ${width}px`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockAuth(page);
    await page.goto("/");
    await signup(page);
    await expect(
      page.getByRole("checkbox", { name: consentName, exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: testInfo.outputPath(`consent-${width}.png`),
      fullPage: true,
    });
    for (const title of ["Terms of Service", "Data & Privacy Notice"]) {
      await page.getByRole("link", { name: title, exact: true }).click();
      const dialog = page.getByRole("dialog", { name: title, exact: true });
      await expect(dialog).toBeVisible();
      expect(
        await dialog.evaluate(
          (element) => element.scrollWidth <= element.clientWidth,
        ),
      ).toBe(true);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: testInfo.outputPath(
          `${title.startsWith("Terms") ? "terms" : "privacy"}-${width}.png`,
        ),
      });
      await dialog.getByRole("button", { name: "Done", exact: true }).click();
    }
    await expect(page.getByRole("checkbox")).not.toBeChecked();
  });
}

test("unknown Auth diagnostic messages cannot expose credential text in the sign-in screen or console", async ({
  page,
}) => {
  await mockAuth(page);
  const marker =
    "private-test-password Bearer private-test-token refresh_token=private-test-refresh";
  const messages: string[] = [];
  page.on("console", (message) => messages.push(message.text()));
  await page.route(`${authOrigin}/auth/v1/token?grant_type=password`, (route) =>
    route.fulfill({
      status: 400,
      contentType: "application/json",
      body: JSON.stringify({ code: "unknown_auth_failure", message: marker }),
    }),
  );
  await page.goto("/");
  await page.getByLabel("Email", { exact: true }).fill("first@example.test");
  await page.getByLabel("Password", { exact: true }).fill("password123");
  await page.locator(".auth-submit").click();
  await expect(page.getByRole("alert")).toHaveText(
    "Authentication failed. Please try again.",
  );
  await expect(page.locator("body")).not.toContainText(marker);
  expect(messages.join("\n")).not.toContain(marker);
  await expect(page.locator(".app, .onboarding")).toHaveCount(0);
});

test("failed expired-session restoration keeps Auth diagnostics out of the workspace and console", async ({
  page,
}) => {
  const server = await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await server.expireSavedSession();
  const marker = "private-restoration-token-marker";
  const messages: string[] = [];
  let refreshRequests = 0;
  page.on("console", (message) => messages.push(message.text()));
  await page.route(
    `${authOrigin}/auth/v1/token?grant_type=refresh_token`,
    (route) => {
      refreshRequests += 1;
      return route.fulfill({
        status: 400,
        contentType: "application/json",
        body: JSON.stringify({ code: "unknown_auth_failure", message: marker }),
      });
    },
  );
  await page.reload();
  await expect.poll(() => refreshRequests).toBe(1);
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(marker);
  await expect(page.locator(".app, .onboarding")).toHaveCount(0);
  expect(messages.join("\n")).not.toContain(marker);
});
