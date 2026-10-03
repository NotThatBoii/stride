import { test, expect } from "@playwright/test";
import { openAccount } from "../auth-mock";
test("countdown completes once and time edits recalculate streaks", async ({
  page,
}) => {
  await page.clock.install({ time: new Date("2026-09-21T12:00:00") });
  await openAccount(page);
  await page
    .getByRole("textbox", { name: "Subject name", exact: true })
    .fill("Circuits");
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Let’s begin" }).click();
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page
    .getByRole("spinbutton", { name: "Custom duration in minutes" })
    .fill("1");
  await page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await page.clock.fastForward(65_000);
  await expect(
    page.getByText("Session complete. Take a breath."),
  ).toBeVisible();
  await expect(page.getByRole("timer")).toHaveAttribute(
    "aria-label",
    "0 minutes 0 seconds",
  );
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Session title", exact: true })
    .fill("Kirchhoff practice");
  await page.getByRole("button", { name: "Save session", exact: true }).click();
  await page.getByRole("button", { name: "History", exact: true }).click();
  await expect(page.locator(".session-row")).toHaveCount(1);
  await expect(page.locator(".session-row .duration")).toHaveText("1m");
  await page.getByRole("button", { name: "Edit session", exact: true }).click();
  await page.getByLabel("Started", { exact: true }).fill("2026-09-21T10:00");
  await page
    .getByRole("spinbutton", { name: "Minutes", exact: true })
    .fill("20");
  await page.getByRole("button", { name: "Save changes", exact: true }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByText("✓ Minimum Day complete", { exact: true }),
  ).toBeVisible();
  await expect(page.locator(".streak-summary strong")).toHaveText("1 day");
  await page.locator("button.cell.today").focus();
  await page.keyboard.press("ArrowUp");
  await expect(page.locator("#heatmap-2026-09-20")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Insights", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Insights" })).toBeVisible();
  await expect(page.locator(".distribution")).toContainText("20m");
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  await page.locator(".subject-card").click();
  await page.getByRole("button", { name: "Edit subject", exact: true }).click();
  await page
    .getByRole("button", { name: "Delete subject", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Permanently delete", exact: true })
    .click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Add your first subject", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".streak-summary strong")).toHaveText("0 days");
  await page.reload();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
});
