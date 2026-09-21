import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
test("major screens fit desktop and narrow viewports without console errors", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.addInitScript((data) => {
    if (!localStorage.getItem("stride-browser-preview-v1"))
      localStorage.setItem("stride-browser-preview-v1", JSON.stringify(data));
  }, fixture());
  await page.goto("/");
  await expect(page.locator(".subject-card")).toHaveCount(4);
  for (const width of [1366, 1440, 1920, 800]) {
    await page.setViewportSize({
      width,
      height: width === 1366 || width === 800 ? 768 : 900,
    });
    for (const screen of [
      "Home",
      "Subjects",
      "History",
      "Insights",
      "Settings",
      "Focus",
    ]) {
      await page.getByRole("button", { name: screen, exact: true }).click();
      await expect(page.locator("main h1")).toBeVisible();
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= window.innerWidth,
        ),
      ).toBeTruthy();
      if (width === 1440)
        await page.screenshot({
          path: `docs/screenshots/${screen.toLowerCase()}.png`,
          fullPage: false,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  await page.locator(".subject-card").first().click();
  await page.screenshot({
    path: "docs/screenshots/subject.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await expect(page.locator(".sidebar")).toBeHidden();
  await page.screenshot({
    path: "docs/screenshots/focus-active.png",
    fullPage: false,
  });
  await page
    .getByRole("button", { name: "Back to workspace", exact: false })
    .click();
  await expect(page.locator(".sidebar")).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Appearance" })
    .selectOption("light");
  await page.getByRole("button", { name: "Save preferences" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await page.setViewportSize({ width: 800, height: 768 });
  await page.screenshot({
    path: "docs/screenshots/narrow-light.png",
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
