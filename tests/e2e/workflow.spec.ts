import { test, expect } from "@playwright/test";
test("onboarding, subject CRUD, recoverable timer, history, heatmap, and settings", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto("/");
  await page.getByRole("button", { name: "Find your stride" }).click();
  await page
    .getByRole("textbox", { name: "Subject name", exact: true })
    .fill("Differential Equations");
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  await expect(
    page.getByText("Differential Equations", { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("textbox", { name: "Subject name", exact: true })
    .fill("Java Programming");
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await expect(
    page.getByText("0 active days this year", { exact: false }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/screenshots/home-empty.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .first()
    .click();
  await page.getByRole("button", { name: "Stopwatch", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Session title", exact: true })
    .fill("Exact differential equations");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.waitForTimeout(1300);
  await page.getByRole("button", { name: "Pause", exact: true }).click();
  await page.reload();
  await page.getByRole("button", { name: /Paused/ }).click();
  await expect(
    page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: /A note for next time/ })
    .fill("Continue with integrating factors.");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    page.getByText("Exact differential equations", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit session", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Title", exact: true })
    .fill("Practice problems");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByText("Practice problems", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByText("1 active days this year", { exact: false }),
  ).toBeVisible();
  await page.locator("button.cell.today").click();
  await expect(
    page.getByRole("dialog").getByText("Practice problems", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog", exact: true }).click();
  await page
    .getByRole("button", { name: "Java Programming", exact: true })
    .click();
  await expect(
    page.getByText("0 active days this year", { exact: false }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit subject", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Subject name", exact: true })
    .fill("Java & algorithms");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Java & algorithms", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit subject", exact: true }).click();
  await page
    .getByRole("button", { name: "Archive subject", exact: true })
    .click();
  await expect(
    page.getByText("ARCHIVED SUBJECT", { exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Edit subject", exact: true }).click();
  await page
    .getByRole("button", { name: "Restore subject", exact: true })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByRole("combobox", { name: "Appearance", exact: true })
    .selectOption("light");
  await page
    .getByRole("button", { name: "Save preferences", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const downloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  expect((await downloadPromise).suggestedFilename()).toMatch(/^stride-export/);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Delete session", exact: true })
    .click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByText("0 active days this year", { exact: false }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.setViewportSize({ width: 800, height: 768 });
  await page.screenshot({
    path: "docs/screenshots/narrow-empty.png",
    fullPage: true,
  });
  expect(errors).toEqual([]);
});
