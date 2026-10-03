import { test, expect, chromium } from "@playwright/test";
import { fixture } from "./fixture";
import { mockAuth, seedAccount, signIn } from "../auth-mock";
test("records survive a real browser restart and JSON import stays staged while offline", async ({}, testInfo) => {
  const profile = testInfo.outputPath("browser-profile");
  let context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
  });
  try {
    let page = await context.newPage();
    await mockAuth(page);
    await page.goto("http://127.0.0.1:1420");
    await signIn(page);
    await seedAccount(page, fixture());
    await expect(
      page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Export JSON", exact: true })
      .click();
    const backup = testInfo.outputPath("backup.json");
    await (await download).saveAs(backup);
    await context.close();
    context = await chromium.launchPersistentContext(profile, {
      channel: "msedge",
      headless: true,
    });
    page = await context.newPage();
    await mockAuth(page);
    await page.goto("http://127.0.0.1:1420");
    await expect(page.locator(".subject-card")).toHaveCount(4);
    await expect(page.locator(".recent-session")).toHaveCount(4);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByLabel("Import backup file").setInputFiles({
      name: "bad.json",
      mimeType: "application/json",
      buffer: Buffer.from('{"format":"wrong"}'),
    });
    await expect(page.getByRole("alert")).toContainText("Stride version 1");
    await page.getByLabel("Import backup file").setInputFiles(backup);
    await expect(
      page.getByRole("dialog", { name: "Review backup import" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import history", exact: true }),
    ).toBeDisabled();
    // Successful backup-gated imports use the real SQL transport in the sync
    // suite. Here the cloud is unavailable, so no cached record is replaced.
    await expect(
      page.getByRole("button", { name: "Download backup", exact: true }),
    ).toBeEnabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.reload();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("button", { name: "Continue backup import", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Review backup import" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import history", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(page.locator(".subject-card")).toHaveCount(4);
    await expect(page.locator(".recent-session")).toHaveCount(4);
  } finally {
    await context.close();
  }
});
