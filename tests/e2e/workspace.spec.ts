import { expect, test } from "@playwright/test";
import { defaults, type Data } from "../../src/models";

function workspaceData(name: string): Data {
  return {
    subjects: [
      {
        id: "shared-subject-id",
        name,
        description: "",
        icon: "book",
        color: "#8b91e8",
        created_at: "2026-09-20T10:00:00.000Z",
        archived: 0,
      },
    ],
    sessions: [],
    slices: [],
    settings: { ...defaults, onboarded: true },
    running: null,
  };
}

test("switching local workspaces clears visible account records and view state", async ({
  page,
}) => {
  await page.goto("/");
  await expect(
    page.getByRole("button", { name: "Find your stride" }),
  ).toBeVisible();

  await page.evaluate(async (data) => {
    const storage = await import("/src/lib/storage.ts");
    await storage.restoreData(data);
  }, workspaceData("Anonymous history"));
  await expect(page.locator("body")).toContainText("Anonymous history");

  const accountA = "11111111-1111-4111-8111-111111111111";
  const accountB = "22222222-2222-4222-8222-222222222222";
  await page.evaluate((id) => {
    return import("/src/lib/storage.ts").then((storage) =>
      storage.selectWorkspace(id),
    );
  }, accountA);
  await expect(page.locator("body")).not.toContainText("Anonymous history");
  await page.evaluate(async (data) => {
    const storage = await import("/src/lib/storage.ts");
    await storage.initialize();
    await storage.restoreData(data);
  }, workspaceData("Account A history"));
  await expect(page.locator("body")).toContainText("Account A history");

  await page.evaluate((id) => {
    return import("/src/lib/storage.ts").then((storage) =>
      storage.selectWorkspace(id),
    );
  }, accountB);
  await expect(page.locator("body")).not.toContainText("Account A history");
  await page.evaluate(async (data) => {
    const storage = await import("/src/lib/storage.ts");
    await storage.initialize();
    await storage.restoreData(data);
  }, workspaceData("Account B history"));
  await expect(page.locator("body")).toContainText("Account B history");

  await page.evaluate((id) => {
    return import("/src/lib/storage.ts").then((storage) =>
      storage.selectWorkspace(id),
    );
  }, accountA);
  await expect(page.locator("body")).toContainText("Account A history");
  await expect(page.locator("body")).not.toContainText("Account B history");

  await page.evaluate(() => {
    return import("/src/lib/storage.ts").then((storage) =>
      storage.selectWorkspace(null),
    );
  });
  await expect(page.locator("body")).toContainText("Anonymous history");
  await expect(page.locator("body")).not.toContainText("Account A history");
});

test("anonymous onboarding works when Supabase is not configured", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(page.getByRole("dialog", { name: "Account" })).toContainText(
    "Account access is unavailable in this build",
  );
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "Find your stride" }).click();
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
});
