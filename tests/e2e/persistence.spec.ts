import { test, expect, chromium } from "@playwright/test";
import { fixture } from "./fixture";
test("records survive a real browser restart and JSON backup round-trip", async ({}, testInfo) => {
  const profile = testInfo.outputPath("browser-profile");
  let context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
  });
  let page = await context.newPage();
  await page.goto("http://127.0.0.1:1420");
  await page.evaluate(
    (data) =>
      localStorage.setItem("stride-browser-preview-v1", JSON.stringify(data)),
    fixture(),
  );
  // The first launch already initialized an empty DB; reset this isolated test DB only.
  await page.evaluate(async () => {
    const { database } = await import("/src/lib/storage.ts");
    await database.delete();
  });
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  const backup = testInfo.outputPath("backup.json");
  await (await download).saveAs(backup);
  await context.close();
  context = await chromium.launchPersistentContext(profile, {
    channel: "msedge",
    headless: true,
  });
  page = await context.newPage();
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
    page.getByRole("dialog", { name: "Restore this backup?" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Replace and restore" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(page.locator(".subject-card")).toHaveCount(4);
  await expect(page.locator(".recent-session")).toHaveCount(4);
  await context.close();
});
