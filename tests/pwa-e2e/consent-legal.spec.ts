import { expect, test } from "@playwright/test";
import { expectNoStudySync, mockAuth } from "../auth-mock";

const origin = "http://127.0.0.1:1426";

test("compiled PWA legal documents remain readable after a signed-out offline reload without account creation", async ({
  page,
  context,
  request,
}) => {
  await request.post(`${origin}/__test/release?version=A`);
  await request.post(`${origin}/__test/worker?unavailable=false`);
  const server = await mockAuth(page);
  await page.goto("/");
  await expect
    .poll(() =>
      page.evaluate(() => Boolean(navigator.serviceWorker.controller)),
    )
    .toBe(true);
  await context.setOffline(true);
  const response = await page.reload();
  expect(response?.fromServiceWorker()).toBe(true);
  await expect(page.locator(".auth-screen")).toBeVisible();
  for (const title of ["Terms of Service", "Data & Privacy Notice"]) {
    await page
      .getByRole("navigation", { name: "Legal documents" })
      .getByRole("link", { name: title, exact: true })
      .click();
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
    await dialog.getByRole("button", { name: "Done", exact: true }).click();
  }
  await page
    .getByRole("group", { name: "Account action" })
    .getByRole("button", { name: "Create account", exact: true })
    .click();
  await expect(page.getByRole("checkbox")).not.toBeChecked();
  await page
    .getByRole("link", { name: "Terms of Service", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Terms of Service" }),
  ).toBeVisible();
  await page.keyboard.press("Escape");
  expect(server.calls.some((call) => call.includes("/signup"))).toBe(false);
  expectNoStudySync(server.calls);
});
