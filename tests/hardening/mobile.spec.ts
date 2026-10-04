import { expect, test } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { defaults } from "../../src/models";
import { mockAuth, signIn } from "../auth-mock";
import { session, slices, subject } from "../sync-fixture";

for (const width of [360, 390, 430]) {
  test(`mobile ${width}px: entry, onboarding, every view, timer, conflict, recovery, and legacy review remain usable`, async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width, height: 844 });
    await mockAuth(page);
    await page.goto("/");
    const measurements: unknown[] = [];
    async function check(view: string, screenshot = false) {
      const result = await page.evaluate(() => ({
        viewport: innerWidth,
        document: document.documentElement.scrollWidth,
        smallButtons: [
          ...document.querySelectorAll<HTMLButtonElement>("button:not(.cell)"),
        ]
          .filter((element) => {
            const box = element.getBoundingClientRect();
            return box.width > 0 && box.height > 0 && box.height < 43.5;
          })
          .map(
            (element) =>
              element.getAttribute("aria-label") ??
              element.textContent?.trim().slice(0, 100),
          ),
        overflows: [
          ...document.querySelectorAll<HTMLElement>(
            "button,input,select,textarea,summary",
          ),
        ]
          .filter((element) => {
            // The year heatmap has its own keyboard-accessible horizontal
            // scroll region; offscreen cells remain reachable there.
            if (element.closest(".heatmap-scroll")) return false;
            const box = element.getBoundingClientRect();
            return (
              box.width > 0 &&
              box.height > 0 &&
              (box.left < -1 || box.right > innerWidth + 1)
            );
          })
          .map((element) => ({
            text:
              element.getAttribute("aria-label") ??
              element.textContent?.trim().slice(0, 100),
            tag: element.tagName,
          })),
      }));
      measurements.push({ view, ...result });
      expect(
        result.document,
        `${view}: horizontal document overflow`,
      ).toBeLessThanOrEqual(width);
      expect(
        result.overflows,
        `${view}: controls outside the viewport`,
      ).toEqual([]);
      expect(result.smallButtons, `${view}: small button targets`).toEqual([]);
      if (screenshot)
        await page.screenshot({
          path: testInfo.outputPath(`${view}-${width}.png`),
          fullPage: true,
        });
    }
    await expect(page.locator(".auth-screen")).toBeVisible();
    await check("authentication", true);
    await signIn(page);
    await expect(
      page.getByRole("heading", { name: "What are you learning?" }),
    ).toBeVisible();
    await check("onboarding-subjects");
    await page
      .getByLabel("Subject name", { exact: true })
      .fill("Mobile mathematics");
    await page
      .getByRole("button", { name: "Add subject", exact: true })
      .click();
    await expect(page.locator(".onboarding-subjects")).toContainText(
      "Mobile mathematics",
    );
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    await check("onboarding-minimum");
    await page.getByRole("button", { name: "Let’s begin" }).click();
    await expect(
      page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await page.evaluate(async (record) => {
      const storage = await import("/src/lib/storage.ts");
      const data = await storage.readData();
      await storage.saveSession(
        { ...record, subject_id: data.subjects[0].id },
        [
          {
            session_id: record.id,
            day: "2026-09-21",
            seconds: record.duration_seconds,
          },
        ],
      );
    }, session("mobile-session"));
    await check("dashboard", true);
    await page.getByRole("button", { name: "Subjects", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Subjects", exact: true }),
    ).toBeVisible();
    await check("subjects");
    await page.locator(".subject-card").first().click();
    await expect(
      page.getByRole("heading", { name: "Mobile mathematics", exact: true }),
    ).toBeVisible();
    await check("subject-detail");
    await page.getByRole("button", { name: "Focus", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Start a session" }),
    ).toBeVisible();
    await check("focus-ready", true);
    await page
      .getByRole("button", { name: "Start session", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Pause", exact: true }),
    ).toBeVisible();
    await check("focus-running");
    await page.getByRole("button", { name: "Pause", exact: true }).click();
    await check("focus-paused");
    await page.getByRole("button", { name: "Back to workspace" }).click();
    for (const name of ["History", "Insights", "Settings"] as const) {
      await page.getByRole("button", { name, exact: true }).click();
      await expect(
        page.getByRole("heading", {
          name: name === "History" ? "Study history" : name,
          exact: true,
        }),
      ).toBeVisible();
      await check(name.toLowerCase());
    }
    await expect(
      page.getByRole("heading", {
        name: "Recovery and sync issues",
        exact: true,
      }),
    ).toBeVisible();
    await page.evaluate(
      async ({ local, remote }) => {
        const { getActiveDatabase } = await import("/src/lib/storage.ts");
        await getActiveDatabase().conflicts.add({
          id: "mobile-conflict",
          entity: "subject",
          record_id: local.id,
          local_snapshot: { action: "upsert", payload: local },
          remote_snapshot: { action: "upsert", payload: remote },
          base_revision: "1",
          remote_revision: "2",
          created_at: new Date().toISOString(),
          resolved_at: null,
          kind: "concurrent_edit",
          source: "push",
        });
      },
      {
        local: subject("mobile-conflict-subject", "This device version"),
        remote: subject("mobile-conflict-subject", "Cloud version"),
      },
    );
    await page.locator(".sync-conflict summary").click();
    await expect(
      page.getByRole("button", { name: "Keep both", exact: true }),
    ).toBeVisible();
    await check("conflict-recovery", true);
    const pending = page
      .locator(".recovery-center details")
      .filter({ has: page.getByText(/^Pending changes \(/) });
    await pending.locator("summary").click();
    await check("pending-changes");
    await page.evaluate(
      async (source) => {
        const storage = await import("/src/lib/storage.ts");
        await storage.restoreData(source, storage.database);
      },
      {
        subjects: [subject("mobile-legacy", "Stored history")],
        sessions: [session("mobile-legacy-session", "mobile-legacy")],
        slices: slices("mobile-legacy-session"),
        settings: { ...defaults, onboarded: true },
        running: null,
      },
    );
    await page.reload();
    await expect(
      page.getByRole("button", { name: "Import into my account", exact: true }),
    ).toBeVisible();
    await check("legacy-offer");
    await page
      .getByRole("button", { name: "Import into my account", exact: true })
      .click();
    await expect(
      page.getByRole("dialog", { name: "Review history import" }),
    ).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Import history", exact: true }),
    ).toBeDisabled();
    await check("legacy-review", true);
    const download = page.waitForEvent("download");
    await page
      .getByRole("button", { name: "Download backup", exact: true })
      .click();
    await (await download).saveAs(testInfo.outputPath("mobile-backup.json"));
    await expect(
      page.getByRole("button", { name: "Import history", exact: true }),
    ).toBeEnabled();
    await check("legacy-backed-up");
    await mkdir("docs/measurements", { recursive: true });
    await writeFile(
      `docs/measurements/phase6-mobile-${width}.json`,
      JSON.stringify(
        {
          width,
          engine:
            "Microsoft Edge, emulated touch viewport; no physical handset",
          measurements,
        },
        null,
        2,
      ) + "\n",
    );
  });
}
