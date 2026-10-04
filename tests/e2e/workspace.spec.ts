import { expect, test, type Page } from "@playwright/test";
import { defaults, type Data } from "../../src/models";
import { mockAuth, seedAccount, signIn, users } from "../auth-mock";

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

async function signOut(page: Page) {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(page.locator(".auth-screen")).toBeVisible();
}

test("authenticated workspace switches isolate records and reset subject view state", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await seedAccount(page, workspaceData("Account A history"));
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  await page.locator(".subject-card").click();
  await expect(
    page.getByRole("heading", { name: "Account A history", exact: true }),
  ).toBeVisible();

  await signOut(page);
  await expect(page.locator("body")).not.toContainText("Account A history");
  await signIn(page, "second@example.test");
  await expect(
    page.getByRole("heading", { name: "What are you learning?" }),
  ).toBeVisible();
  await expect(page.locator("body")).not.toContainText("Account A history");
  await seedAccount(page, workspaceData("Account B history"));
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText("Account B history");

  await signOut(page);
  await signIn(page);
  await expect(
    page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await expect(page.locator("body")).toContainText("Account A history");
  await expect(page.locator("body")).not.toContainText("Account B history");
});

test("a selected database that does not match the authenticated user fails closed", async ({
  page,
}) => {
  await mockAuth(page);
  await page.goto("/");
  await signIn(page);
  await seedAccount(page, workspaceData("Account A secret"));
  await page.evaluate(
    async ({ id, data }) => {
      const storage = await import("/src/lib/storage.ts");
      const other = new storage.StrideDatabase(`stride-account-${id}`, id);
      await storage.initialize(other);
      const imports = await import("/src/lib/sync/import.ts");
      const stage = await imports.stageImport(other, data, "backup");
      await imports.commitImport(other, stage.id);
      await other.preferences.put({ ...data.settings, id: 1 });
      storage.selectWorkspace(id);
    },
    {
      id: users["second@example.test"],
      data: workspaceData("Account B secret"),
    },
  );
  await expect(page.locator(".app")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("Account A secret");
  await expect(page.locator("body")).not.toContainText("Account B secret");
  await page.reload();
  await expect(page.locator("body")).toContainText("Account A secret");
  await expect(page.locator("body")).not.toContainText("Account B secret");
});
