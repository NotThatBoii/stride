import { expect, test } from "@playwright/test";

test("missing Supabase configuration blocks the app and preserves legacy localStorage", async ({
  page,
}) => {
  const legacy = '{"legacy-history":"recoverable"}';
  await page.addInitScript((raw) => {
    localStorage.setItem("stride-browser-preview-v1", raw);
  }, legacy);
  await page.goto("/");
  await expect(page.locator(".auth-screen")).toBeVisible();
  await expect(page.getByRole("alert")).toContainText(
    /not configured|configuration|unavailable/i,
  );
  await expect(page.locator(".app, .onboarding, .floating-timer")).toHaveCount(
    0,
  );
  await expect(
    page.getByRole("button", {
      name: /continue as guest|continue locally|skip account|find your stride/i,
    }),
  ).toHaveCount(0);
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("stride-browser-preview-v1"),
    ),
  ).toBe(legacy);
  expect(
    await page.evaluate(async () =>
      (await indexedDB.databases()).map((db) => db.name),
    ),
  ).not.toContain("stride");
});
