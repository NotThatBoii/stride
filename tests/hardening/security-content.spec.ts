import { expect, test, type Download, type Page } from "@playwright/test";
import { defaults, type Data, type Running } from "../../src/models";
import { openAccount, seedAccount } from "../auth-mock";
import { SqlSyncServer, syncNow } from "../sync-fixture";

const hostileText = [
  "<script>window.__securityXss=1</script>",
  "<img src=x onerror=window.__securityXss=1>",
  "javascript:window.__securityXss=1",
  "<svg onload=window.__securityXss=1>",
  "&lt;img src=x onerror=window.__securityXss=1&gt;",
];

function history(names = ["Security test mathematics"]): Data {
  return {
    subjects: names.map((name, index) => ({
      id: `security-subject-${index}`,
      name,
      description: "A synthetic study subject",
      icon: "book",
      color: "#8b91e8",
      archived: 0,
      created_at: "2026-09-21T10:00:00.000Z",
    })),
    sessions: names.map((name, index) => ({
      id: `security-session-${index}`,
      subject_id: `security-subject-${index}`,
      started_at: "2026-09-21T10:00:00.000Z",
      ended_at: "2026-09-21T10:20:00.000Z",
      duration_seconds: 1200,
      session_title: name,
      notes: hostileText.join("\n"),
      mode: "stopwatch",
      completed: 1,
    })),
    slices: names.map((_, index) => ({
      session_id: `security-session-${index}`,
      day: "2026-09-21",
      seconds: 1200,
    })),
    settings: { ...defaults, onboarded: true },
    running: null,
  };
}

async function downloadedText(download: Download) {
  const stream = await download.createReadStream();
  if (!stream) throw new Error("Expected the isolated JSON download.");
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}

async function assertNoExecution(page: Page) {
  expect(await page.evaluate(() => (window as any).__securityXss ?? 0)).toBe(0);
  await expect(
    page.locator("[onerror], [onload], a[href^='javascript:']"),
  ).toHaveCount(0);
  await expect(
    page.locator(
      ".subject-card script, .session-row script, .conflict-versions script, .recovery-preview script",
    ),
  ).toHaveCount(0);
}

function pausedTimer(end: number): Running {
  return {
    id: "security-paused-timer",
    subjectId: "security-subject-0",
    startedAt: "2026-09-21T10:00:00.000Z",
    title: "Preserve this timer",
    mode: "stopwatch",
    target: 1500,
    segments: [{ start: Date.parse("2026-09-21T10:00:00Z"), end }],
    runningSince: null,
    notified: false,
  };
}

test("subject and session form values render as text without executing markup", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, history());
  await page.getByRole("button", { name: "Subjects", exact: true }).click();
  await page.getByRole("button", { name: "Add subject", exact: true }).click();
  const editor = page.getByRole("dialog", { name: "A new subject" });
  await editor.getByLabel("Subject name").fill(hostileText[0]);
  await editor.getByLabel("Description").fill(hostileText[1]);
  await editor
    .getByRole("button", { name: "Create subject", exact: true })
    .click();
  await expect(
    page.locator(".subject-card").filter({ hasText: hostileText[0] }),
  ).toContainText(hostileText[0]);
  await page.getByRole("button", { name: "History", exact: true }).click();
  await page.getByRole("button", { name: "Edit session", exact: true }).click();
  const sessionEditor = page.getByRole("dialog", {
    name: "Edit study session",
  });
  await sessionEditor.getByLabel("Title", { exact: true }).fill(hostileText[1]);
  await sessionEditor
    .getByRole("textbox", { name: "Notes", exact: true })
    .fill(hostileText.join("\n"));
  await sessionEditor
    .getByRole("button", { name: "Save changes", exact: true })
    .click();
  await expect(page.locator(".session-row strong").first()).toHaveText(
    hostileText[1],
  );
  for (const payload of hostileText)
    await expect(page.locator(".session-main p")).toContainText(payload);
  await assertNoExecution(page);
});

test("JSON-imported strings and sync conflict/recovery previews remain plain text", async ({
  page,
}) => {
  const server = await SqlSyncServer.create();
  try {
    await openAccount(page);
    await server.attach(page);
    const empty = history([]);
    await seedAccount(page, empty);
    expect(await syncNow(page)).toBe(true);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    const imported = history(hostileText);
    await page.getByLabel("Import backup file").setInputFiles({
      name: "security-strings.json",
      mimeType: "application/json",
      buffer: Buffer.from(
        JSON.stringify({
          format: "stride",
          version: 1,
          exportedAt: "2026-10-06T00:00:00.000Z",
          ...imported,
        }),
      ),
    });
    const review = page.getByRole("dialog", { name: "Review backup import" });
    await expect(review).toBeVisible();
    await expect(
      review.getByRole("button", { name: "Import history", exact: true }),
    ).toBeDisabled();
    const backupDownload = page.waitForEvent("download");
    await review
      .getByRole("button", { name: "Download backup", exact: true })
      .click();
    expect(
      JSON.parse(await downloadedText(await backupDownload)).subjects[0].name,
    ).toBe(hostileText[0]);
    await review
      .getByRole("button", { name: "Import history", exact: true })
      .click();
    await expect(review).toHaveCount(0);
    await page.getByRole("button", { name: "Subjects", exact: true }).click();
    for (const payload of hostileText)
      await expect(
        page.locator(".subject-card").filter({ hasText: payload }),
      ).toContainText(payload);
    await page.getByRole("button", { name: "History", exact: true }).click();
    for (const payload of hostileText)
      await expect(
        page.locator(".session-main strong").filter({ hasText: payload }),
      ).toHaveText(payload);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.evaluate(
      async ({ data, remoteName }) => {
        const { getActiveDatabase } = await import("/src/lib/storage.ts");
        const db = getActiveDatabase();
        await db.conflicts.add({
          id: "security-text-conflict",
          entity: "subject",
          record_id: data.subjects[0].id,
          local_snapshot: { action: "upsert", payload: data.subjects[0] },
          remote_snapshot: {
            action: "upsert",
            payload: { ...data.subjects[0], name: remoteName },
          },
          base_revision: "1",
          remote_revision: "2",
          created_at: new Date().toISOString(),
          resolved_at: null,
          kind: "concurrent_edit",
          source: "push",
        });
        await db.recoveryCopies.add({
          id: "security-text-recovery",
          reason: "json_restore",
          entity: null,
          record_id: null,
          snapshot: data,
          created_at: new Date().toISOString(),
        });
      },
      { data: imported, remoteName: hostileText[1] },
    );
    const conflict = page.locator(".sync-conflict");
    await conflict.locator("summary").click();
    await expect(conflict.locator(".conflict-versions")).toContainText(
      hostileText[0],
    );
    await expect(conflict.locator(".conflict-versions")).toContainText(
      hostileText[1],
    );
    const copies = page
      .locator(".recovery-center details")
      .filter({ has: page.getByText(/^Preserved copies \(/) });
    await copies.locator("summary").click();
    await copies
      .locator(".recovery-item")
      .filter({ has: page.getByText("Study history", { exact: true }) })
      .first()
      .getByRole("button", { name: "Inspect copy", exact: true })
      .click();
    const preserved = page.getByRole("dialog", {
      name: "Inspect preserved copy",
    });
    for (const payload of hostileText)
      await expect(preserved).toContainText(payload);
    await assertNoExecution(page);
  } finally {
    await server.close();
  }
});

test("ordinary and recovery JSON exports exclude the persisted SDK credentials", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, history());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  for (const button of ["Export JSON", "Export recovery data"]) {
    const event = page.waitForEvent("download");
    await page.getByRole("button", { name: button, exact: true }).click();
    const exported = await downloadedText(await event);
    const result = await page.evaluate(async (text) => {
      const { supabaseAuthStorageKey } = await import("/src/lib/supabase.ts");
      const credentials = JSON.parse(
        localStorage.getItem(supabaseAuthStorageKey!) ?? "null",
      );
      const { readData } = await import("/src/lib/storage.ts");
      const workspace = JSON.stringify(await readData());
      // Compare inside the isolated browser; never return credential values to
      // runner output. These are mock SDK credentials, never real accounts.
      return {
        sdkCredentialsPresent:
          !!credentials?.access_token && !!credentials?.refresh_token,
        exportedCredentialsAbsent:
          !!credentials &&
          !text.includes(credentials.access_token) &&
          !text.includes(credentials.refresh_token) &&
          !text.includes("password123"),
        workspaceCredentialsAbsent:
          !!credentials &&
          !workspace.includes(credentials.access_token) &&
          !workspace.includes(credentials.refresh_token),
        studyNotesPresent: text.includes("__securityXss"),
      };
    }, exported);
    expect(result).toEqual({
      sdkCredentialsPresent: true,
      exportedCredentialsAbsent: true,
      workspaceCredentialsAbsent: true,
      studyNotesPresent: true,
    });
  }
});

test("browser rejects an oversized backup before reading it and preserves history", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, history());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const before = await page.evaluate(async () => {
    const { readData } = await import("/src/lib/storage.ts");
    (window as any).__securityFileReads = 0;
    Object.defineProperty(File.prototype, "text", {
      configurable: true,
      value: async function () {
        (window as any).__securityFileReads++;
        throw new Error("Oversized fixture must not be read.");
      },
    });
    return readData();
  });
  await page.getByLabel("Import backup file").setInputFiles({
    name: "oversized.json",
    mimeType: "application/json",
    buffer: Buffer.alloc(25 * 1024 * 1024 + 1, 0x78),
  });
  await expect(page.getByRole("alert")).toHaveText(
    "Backups must be smaller than 25 MB.",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(await page.evaluate(() => (window as any).__securityFileReads)).toBe(
    0,
  );
  expect(
    await page.evaluate(async () => {
      const { readData } = await import("/src/lib/storage.ts");
      return readData();
    }),
  ).toEqual(before);
});

test("a tiny extreme timer backup is rejected before changing the workspace", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, history());
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const before = await page.evaluate(async () => {
    const { readData } = await import("/src/lib/storage.ts");
    return readData();
  });
  const text = JSON.stringify({
    format: "stride",
    version: 1,
    exportedAt: "2026-10-06T00:00:00Z",
    ...history(),
    running: pausedTimer(Date.parse("9999-12-31T10:00:00Z")),
  });
  expect(Buffer.byteLength(text)).toBeLessThan(2500);
  await page.getByLabel("Import backup file").setInputFiles({
    name: "extreme-timer.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
  await expect(page.getByRole("alert")).toContainText(
    "more than 1,000 recorded days",
  );
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expect(
    await page.evaluate(async () => {
      const { readData } = await import("/src/lib/storage.ts");
      return readData();
    }),
  ).toEqual(before);
});

test("an existing malformed timer fails saving safely and can still be exported and discarded into recovery", async ({
  page,
}) => {
  await openAccount(page);
  await seedAccount(page, history());
  const timer = pausedTimer(1e308);
  await page.evaluate(async (value) => {
    const { saveRunning } = await import("/src/lib/storage.ts");
    await saveRunning(value);
  }, timer);
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  const review = page.getByRole("dialog", { name: "A step forward." });
  await review
    .getByRole("button", { name: "Save session", exact: true })
    .click();
  await expect(page.locator(".error-toast")).toContainText(
    "Invalid timer interval",
  );
  await review.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText(
    "Its stored copy is preserved",
  );
  const preserved = await page.evaluate(async () => {
    const { readData } = await import("/src/lib/storage.ts");
    const data = await readData();
    return { running: data.running, sessions: data.sessions.length };
  });
  expect(preserved).toEqual({ running: timer, sessions: 1 });
  await page
    .getByRole("button", { name: "Back to workspace" })
    .click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const download = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON", exact: true }).click();
  expect(JSON.parse(await downloadedText(await download)).running).toEqual(
    timer,
  );
  await page.getByRole("button", { name: "Focus", exact: true }).click();
  await page
    .getByRole("button", { name: "Discard session", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Discard this session?" })
    .getByRole("button", { name: "Discard", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start session", exact: true }),
  ).toBeVisible();
  const discarded = await page.evaluate(async () => {
    const { getActiveDatabase, readData } = await import("/src/lib/storage.ts");
    const data = await readData();
    const copies = await getActiveDatabase().recoveryCopies.toArray();
    return {
      running: data.running,
      sessions: data.sessions.length,
      rawTimerPreserved: copies.some(
        (copy) =>
          copy.reason === "timer_discard" &&
          (
            copy.snapshot as {
              discarded_timer?: { segments: { end: number }[] };
            }
          ).discarded_timer?.segments[0].end === 1e308,
      ),
    };
  });
  expect(discarded).toEqual({
    running: null,
    sessions: 1,
    rawTimerPreserved: true,
  });
});
