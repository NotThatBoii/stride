import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";
import { openAccount, seedAccount } from "../auth-mock";
test("major screens fit desktop and narrow viewports without console errors", async ({
  page,
}, testInfo) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await openAccount(page);
  await seedAccount(page, fixture());
  await expect(page.locator(".subject-card")).toHaveCount(4);
  for (const width of [1366, 1440, 1672, 1920, 800]) {
    await page.setViewportSize({
      width,
      height:
        width === 1672 ? 940 : width === 1366 || width === 800 ? 768 : 900,
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
      await page.evaluate(
        () =>
          new Promise<void>((resolve) =>
            requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
          ),
      );
      if (width === 1672 && screen === "Home")
        await page.screenshot({
          path: testInfo.outputPath("home-reference.png"),
        });
      if (width === 1440)
        await page.screenshot({
          path: testInfo.outputPath(`${screen.toLowerCase()}.png`),
          fullPage: false,
        });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  await page.locator(".subject-card").first().click();
  await page.screenshot({
    path: testInfo.outputPath("subject.png"),
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
    path: testInfo.outputPath("focus-active.png"),
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
    path: testInfo.outputPath("narrow-light.png"),
    fullPage: false,
  });
  expect(errors).toEqual([]);
});
