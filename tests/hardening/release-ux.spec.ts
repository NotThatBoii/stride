import { expect, test } from "@playwright/test";
import { openAccount, seedAccount } from "../auth-mock";
import { fixture } from "../e2e/fixture";

test("keyboard dialogs accept direct typing, contain Tab focus and restore their launcher", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, fixture());
  await expect(
    page.getByRole("heading", { name: "Keep your stride.", exact: true }),
  ).toBeVisible();
  const add = page.getByRole("button", { name: "Add subject", exact: true });
  await add.focus();
  await page.keyboard.press("Enter");
  const dialog = page.getByRole("dialog", { name: "A new subject" });
  await expect(dialog.getByLabel("Subject name")).toBeFocused();
  await page.keyboard.type("Keyboard subject");
  await expect(dialog.getByLabel("Subject name")).toHaveValue(
    "Keyboard subject",
  );
  for (let index = 0; index < 16; index++) {
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() =>
        Boolean(document.activeElement?.closest("dialog")),
      ),
    ).toBe(true);
  }
  await dialog.getByRole("button", { name: "Close dialog" }).focus();
  await page.keyboard.press("Shift+Tab");
  await expect(
    dialog.getByRole("button", { name: "Create subject", exact: true }),
  ).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(
    dialog.getByRole("button", { name: "Close dialog" }),
  ).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(add).toBeFocused();
  expect(
    await add.evaluate((element) => getComputedStyle(element).outlineStyle),
  ).not.toBe("none");

  await page.keyboard.press("Control+k");
  await expect(page.getByLabel("Search commands and subjects")).toBeFocused();
  await page.keyboard.type("java");
  await expect(page.getByLabel("Search commands and subjects")).toHaveValue(
    "java",
  );
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(add).toBeFocused();
});

test("malformed backups and invalid preferences announce readable errors without changing history", async ({
  page,
}, testInfo) => {
  await openAccount(page);
  await seedAccount(page, fixture());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByLabel("Timer presets").fill("invalid");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Enter 1–6 unique whole-minute presets",
  );
  const before = await page.evaluate(async () => {
    const { readData } = await import("/src/lib/storage.ts");
    const data = await readData();
    return {
      subjects: data.subjects,
      sessions: data.sessions,
      slices: data.slices,
    };
  });
  await page.getByLabel("Import backup file").setInputFiles({
    name: "invalid.json",
    mimeType: "application/json",
    buffer: Buffer.from("not JSON"),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "This file is not valid JSON. Choose a Stride JSON export and try again.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { readData } = await import("/src/lib/storage.ts");
      const data = await readData();
      return {
        subjects: data.subjects,
        sessions: data.sessions,
        slices: data.slices,
      };
    }),
  ).toEqual(before);
  await page.getByLabel("Timer presets").fill("25,50");
  for (const theme of ["light", "dark"]) {
    await page.getByLabel("Appearance").selectOption(theme);
    await page
      .getByRole("button", { name: "Save preferences", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", theme);
    await expect(
      page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath(`settings-${theme}.png`),
    });
  }
});

test("native file and notification failures show safe action-specific messages", async ({
  page,
}) => {
  // Only this isolated page substitutes failing native boundaries. No host
  // file dialog, notification or filesystem is opened by this regression.
  await page.addInitScript(() => {
    Object.defineProperty(window, "isTauri", { value: true });
    Object.defineProperty(window, "__TAURI_INTERNALS__", {
      value: {
        invoke: async () => {
          throw new Error("plugin failure: SELECT private_test_marker");
        },
      },
    });
  });
  await openAccount(page);
  await seedAccount(page, fixture());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Import JSON", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to open the backup. Choose the file again and try importing it. Your study data is unchanged.",
  );
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to save the backup. Choose another location and try again. Your study data is unchanged.",
  );
  await page.getByLabel("Notify when a countdown finishes").check();
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.getByRole("alert")).toHaveText(
    "Unable to set up notifications. Check this device’s notification settings and try again, or turn this preference off.",
  );
  await expect(page.locator("body")).not.toContainText("private_test_marker");
});
