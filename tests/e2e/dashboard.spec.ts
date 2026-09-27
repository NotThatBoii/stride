import { test, expect } from "@playwright/test";
import { fixture } from "./fixture";

test("dashboard shortcuts, command search, and collapsed navigation remain usable", async ({
  page,
}) => {
  await page.addInitScript(
    (data) =>
      localStorage.setItem("stride-browser-preview-v1", JSON.stringify(data)),
    fixture(),
  );
  await page.goto("/");
  await expect(
    page.getByRole("img", { name: "33% of daily study goal" }),
  ).toBeVisible();
  await page.locator(".recent-session").first().click();
  await expect(page.getByRole("dialog")).toContainText(
    "Exact equations practice",
  );
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "View all", exact: false }).click();
  await expect(
    page.getByRole("heading", { name: "Study history", exact: true }),
  ).toBeVisible();
  await page.keyboard.press("Control+k");
  await page
    .getByRole("textbox", { name: "Search commands and subjects" })
    .fill("java");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Java Programming", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Java Programming", exact: true }),
  ).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "Collapse sidebar" }).click();
  await page.getByRole("button", { name: "Home", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Expand sidebar" }).click();
  await page
    .getByRole("combobox", { name: "Quick start subject" })
    .selectOption("subject-2");
  await page.getByRole("button", { name: "Let’s focus" }).click();
  await expect(
    page.getByRole("combobox", { name: "Your subject", exact: true }),
  ).toHaveValue("subject-2");
});
