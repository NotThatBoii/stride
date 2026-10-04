import { expect, test as base, type Page } from "@playwright/test";
import { defaults } from "../../src/models";
import { signIn, users } from "../auth-mock";
import {
  SqlSyncServer,
  device,
  saveSession,
  saveSubject,
  session,
  settle,
  signOut,
  slices,
  snapshot,
  subject,
  syncNow,
} from "../sync-fixture";

const test = base.extend<{ cloud: SqlSyncServer }>({
  cloud: async ({}, use) => {
    const cloud = await SqlSyncServer.create();
    try {
      await use(cloud);
    } finally {
      await cloud.close();
    }
  },
});

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

async function analytics(page: Page) {
  return page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const { aggregate, streaks } = await import("/src/lib/analytics.ts");
    const data = await storage.readData();
    const days = aggregate(data.sessions, data.slices);
    return {
      days: [...days].sort(([a], [b]) => a.localeCompare(b)),
      streaks: streaks(days, data.settings.minimum, "2026-09-22"),
      subjectStreaks: streaks(
        aggregate(
          data.sessions.filter(
            (record) => record.subject_id === "shared-subject",
          ),
          data.slices,
        ),
        data.settings.minimum,
        "2026-09-22",
      ),
    };
  });
}

test("A: a subject pushed on Device A lands in Device B's independent IndexedDB", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  expect((await snapshot(b.page)).data.subjects).toEqual([subject()]);
  expect(await cloud.rows("subjects")).toHaveLength(1);
  await expect(b.page.locator(".subject-card")).toContainText(subject().name);
  expect(a.context).not.toBe(b.context);
});

test("B: completed sessions, allocations, streaks, shared preferences, and archive behavior cross timezones", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud, { timezone: "Asia/Manila" });
  const b = await device(browser, cloud, { timezone: "America/Los_Angeles" });
  await b.page.getByRole("button", { name: "Settings", exact: true }).click();
  const goalInput = b.page.getByLabel("Daily study goal (minutes)");
  const minimumInput = b.page.getByLabel("Minimum Day (minutes)");
  await expect(goalInput).toHaveValue(String(defaults.goal));
  await saveSubject(a.page);
  await saveSession(a.page);
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const { settings } = await storage.readData();
    await storage.saveSettings({
      ...settings,
      goal: 75,
      theme: "light",
      notifications: true,
    });
  });
  await settle(a.page);
  await syncNow(b.page);
  const result = await snapshot(b.page);
  expect(result.data.sessions).toEqual([session()]);
  expect(result.data.slices).toEqual(slices());
  expect(result.data.settings).toMatchObject({
    goal: 75,
    theme: "dark",
    notifications: false,
    onboarded: true,
  });
  expect(result.data.running).toBeNull();
  await expect(goalInput).toHaveValue("75");
  await expect(b.page.getByLabel("Appearance")).toHaveValue("dark");
  await minimumInput.fill("21");
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const { settings } = await storage.readData();
    await storage.saveSettings({ ...settings, goal: 85 });
  });
  await settle(a.page);
  await syncNow(b.page);
  expect((await snapshot(b.page)).data.settings.goal).toBe(85);
  expect((await snapshot(b.page)).data.settings.minimum).toBe(defaults.minimum);
  await expect(minimumInput).toHaveValue("21");
  await expect(b.page.getByLabel("Appearance")).toHaveValue("dark");
  await b.page.getByRole("button", { name: "Home", exact: true }).click();
  expect(await analytics(a.page)).toEqual(await analytics(b.page));
  expect(await analytics(b.page)).toEqual({
    days: [
      ["2026-09-21", 1200],
      ["2026-09-22", 1200],
    ],
    streaks: { current: 2, longest: 2 },
    subjectStreaks: { current: 2, longest: 2 },
  });
  await expect(
    b.page.getByText("2 active days this year", { exact: false }),
  ).toBeVisible();
  await b.page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    b.page.getByText(session().session_title, { exact: true }),
  ).toBeVisible();
  await b.page.getByRole("button", { name: "Insights", exact: true }).click();
  const totalSessions = b.page
    .locator(".stat")
    .filter({
      has: b.page.getByText("TOTAL SESSIONS", { exact: true }),
    })
    .locator("strong");
  await expect(totalSessions).toHaveText("1");
  await expect(
    b.page
      .locator(".distribution .row")
      .filter({ hasText: subject().name })
      .locator("strong"),
  ).toHaveText("40m");
  await saveSubject(a.page, { ...subject(), archived: 1 });
  await settle(a.page);
  await syncNow(b.page);
  expect((await snapshot(b.page)).data.subjects[0].archived).toBe(1);
  expect((await snapshot(b.page)).data.sessions).toHaveLength(1);
  expect(await analytics(b.page)).toEqual(await analytics(a.page));
  await expect(totalSessions).toHaveText("0");
  await expect(b.page.locator(".distribution .row")).toHaveCount(0);
  await b.page.getByRole("button", { name: "History", exact: true }).click();
  await expect(
    b.page.getByText(session().session_title, { exact: true }),
  ).toBeVisible();
});

test("C: concurrent offline edits preserve both versions and Keep both safely resolves the conflict", async ({
  browser,
  cloud,
}, testInfo) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await b.context.setOffline(true);
  await saveSubject(
    b.page,
    subject("shared-subject", "Device B offline version"),
  );
  await saveSubject(
    a.page,
    subject("shared-subject", "Device A cloud version"),
  );
  await settle(a.page);
  await b.context.setOffline(false);
  await syncNow(b.page);
  await expect
    .poll(
      async () =>
        (await snapshot(b.page)).conflicts.filter((item) => !item.resolved_at)
          .length,
    )
    .toBe(1);
  const result = await snapshot(b.page);
  expect(result.data.subjects[0].name).toBe("Device B offline version");
  expect(
    result.operations.some((item) => item.record_id === "shared-subject"),
  ).toBe(true);
  expect(JSON.stringify(result.conflicts)).toContain(
    "Device B offline version",
  );
  expect(JSON.stringify(result.conflicts)).toContain("Device A cloud version");
  expect((await cloud.rows("subjects"))[0].name).toBe("Device A cloud version");
  await b.page.getByRole("button", { name: "Settings", exact: true }).click();
  await b.page.locator(".sync-conflict summary").click();
  await expect(b.page.locator("body")).toContainText(/conflict|two versions/i);
  await b.page.screenshot({
    path: "docs/screenshots/phase5-sync-settings.png",
    fullPage: true,
  });
  await b.page
    .locator(".sync-panel")
    .screenshot({ path: "docs/screenshots/phase5-sync-conflict.png" });
  await b.page.setViewportSize({ width: 390, height: 844 });
  expect(
    await b.page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await b.page.screenshot({
    path: "docs/screenshots/phase5-sync-narrow.png",
    fullPage: true,
  });
  await b.page.getByRole("button", { name: "Keep both", exact: true }).click();
  await settle(b.page);
  const resolved = await snapshot(b.page);
  expect(resolved.conflicts.filter((item) => !item.resolved_at)).toHaveLength(
    0,
  );
  expect(resolved.data.subjects.map((record) => record.name).sort()).toEqual([
    "Device A cloud version",
    "Device B offline version",
  ]);
  expect(new Set(resolved.data.subjects.map((record) => record.id)).size).toBe(
    2,
  );
  await syncNow(a.page);
  expect((await snapshot(a.page)).data.subjects).toHaveLength(2);
});

test("D: subject deletion pulls ordered child tombstones and preserves an active local timer", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await saveSession(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await b.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage.saveRunning({
      id: "device-only-timer",
      subjectId: "shared-subject",
      startedAt: "2026-09-22T12:00:00.000Z",
      title: "Recoverable active work",
      mode: "stopwatch",
      target: 1500,
      segments: [{ start: 1790078400000, end: 1790078410000 }],
      runningSince: null,
      notified: false,
    });
  });
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage.deleteSubject("shared-subject");
  });
  await settle(a.page);
  await syncNow(b.page);
  const result = await snapshot(b.page);
  expect(result.data.sessions).toHaveLength(0);
  expect(result.data.slices).toHaveLength(0);
  expect(result.data.running?.id).toBe("device-only-timer");
  expect(JSON.stringify(result.recovery)).toContain("Recoverable active work");
  expect(await cloud.rows("subjects")).toHaveLength(0);
  expect(await cloud.rows("sessions")).toHaveLength(0);
  expect(await cloud.rows("allocations")).toHaveLength(0);
  const applied = cloud.calls.filter(
    (call) => call.name === "apply_sync_operation",
  );
  expect(
    applied.every(
      (call) => !JSON.stringify(call.body).includes("device-only-timer"),
    ),
  ).toBe(true);
});

test("E: a committed request with a lost acknowledgment retries its unchanged operation UUID", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  cloud.dropNextAcknowledgment = true;
  await saveSubject(a.page);
  await syncNow(a.page);
  await expect.poll(async () => (await cloud.rows("subjects")).length).toBe(1);
  const original = cloud.calls.find(
    (call) =>
      call.name === "apply_sync_operation" &&
      call.body.p_record_id === "shared-subject",
  )!;
  await settle(a.page);
  const attempts = cloud.calls.filter(
    (call) =>
      call.name === "apply_sync_operation" &&
      call.body.p_operation_id === original.body.p_operation_id,
  );
  expect(attempts.length).toBeGreaterThanOrEqual(2);
  for (const attempt of attempts) expect(attempt.body).toEqual(original.body);
  expect(await cloud.rows("subjects")).toHaveLength(1);
  const receipts = await cloud.db.query<{ n: number }>(
    "select count(*)::integer as n from stride_private.stride_sync_operations where owner_id = $1 and operation_id = $2",
    [users["first@example.test"], original.body.p_operation_id],
  );
  expect(receipts.rows[0].n).toBe(1);
  expect((await snapshot(a.page)).conflicts).toHaveLength(0);
});

test("F: interruption before cursor commit rolls back the complete page and restart replays safely", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await saveSession(a.page);
  await settle(a.page);
  const before = await snapshot(b.page);
  await b.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    const db = storage.getActiveDatabase();
    const fail = () => {
      throw new Error("Injected crash before cursor commit");
    };
    db.syncCursors.hook("creating", fail);
    db.syncCursors.hook("updating", fail);
  });
  await syncNow(b.page);
  const interrupted = await snapshot(b.page);
  expect(interrupted.cursors).toEqual(before.cursors);
  expect(interrupted.data.subjects).toEqual(before.data.subjects);
  expect(interrupted.data.sessions).toEqual(before.data.sessions);
  expect(interrupted.data.slices).toEqual(before.data.slices);
  await b.page.reload();
  await expect(
    b.page.getByRole("heading", { name: "Keep your stride." }),
  ).toBeVisible();
  await syncNow(b.page);
  const restarted = await snapshot(b.page);
  expect(restarted.data.subjects).toEqual([subject()]);
  expect(restarted.data.sessions).toEqual([session()]);
  expect(restarted.data.slices).toEqual(slices());
  expect(restarted.cursors.length).toBeGreaterThan(0);
  expect(restarted.conflicts).toHaveLength(0);
});

test("G: two authenticated accounts on one computer isolate cloud cursors and reused record IDs", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  await saveSubject(a.page, subject("shared-subject", "First account history"));
  await settle(a.page);
  await signOut(a.page);
  await signIn(a.page, "second@example.test");
  expect((await snapshot(a.page)).data.subjects).toHaveLength(0);
  await saveSubject(
    a.page,
    subject("shared-subject", "Second account history"),
  );
  await settle(a.page);
  expect(
    (await cloud.rows("subjects", users["first@example.test"]))[0].name,
  ).toBe("First account history");
  expect(
    (await cloud.rows("subjects", users["second@example.test"]))[0].name,
  ).toBe("Second account history");
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage
      .getActiveDatabase()
      .preferences.update(1, { onboarded: true });
  });
  await signOut(a.page);
  await signIn(a.page);
  await syncNow(a.page);
  expect((await snapshot(a.page)).data.subjects[0].name).toBe(
    "First account history",
  );
  await expect(a.page.locator("body")).not.toContainText(
    "Second account history",
  );
  expect(
    cloud.calls.every(
      (call) => !JSON.stringify(call.body).includes("owner_id"),
    ),
  ).toBe(true);
});

test("H: sign-out during a committed push cannot apply its late acknowledgment to another account", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  const gate = cloud.holdNextAcknowledgment();
  let pushing: Promise<unknown> | undefined;
  try {
    await saveSubject(
      a.page,
      subject("shared-subject", "First account in-flight history"),
    );
    pushing = syncNow(a.page);
    await gate.committed;
    await signOut(a.page);
    await signIn(a.page, "second@example.test");
    await saveSubject(
      a.page,
      subject("shared-subject", "Second account isolated history"),
    );
    gate.release();
    await pushing;
    await settle(a.page);
    const second = await snapshot(a.page);
    expect(second.data.subjects[0].name).toBe(
      "Second account isolated history",
    );
    expect(second.conflicts).toHaveLength(0);
    expect(
      (await cloud.rows("subjects", users["first@example.test"]))[0].name,
    ).toBe("First account in-flight history");
    expect(
      (await cloud.rows("subjects", users["second@example.test"]))[0].name,
    ).toBe("Second account isolated history");
    await a.page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      await storage
        .getActiveDatabase()
        .preferences.update(1, { onboarded: true });
    });
    await signOut(a.page);
    await signIn(a.page);
    await settle(a.page);
    expect((await snapshot(a.page)).data.subjects[0].name).toBe(
      "First account in-flight history",
    );
    expect((await snapshot(a.page)).conflicts).toHaveLength(0);
  } finally {
    gate.release();
    await pushing?.catch(() => undefined);
  }
});

test("incremental pagination handles hundreds of records without replaying full history", async ({
  browser,
  cloud,
}) => {
  cloud.pageSize = 37;
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    for (let n = 0; n < 300; n++) {
      const id = `bulk-session-${String(n).padStart(3, "0")}`;
      await storage.saveSession(
        {
          id,
          subject_id: "shared-subject",
          started_at: "2026-09-21T10:00:00.000Z",
          ended_at: "2026-09-21T10:01:00.000Z",
          duration_seconds: 60,
          session_title: `Bulk session ${n}`,
          notes: "",
          mode: "stopwatch",
          completed: 1,
        },
        [{ session_id: id, day: "2026-09-21", seconds: 60 }],
      );
    }
  });
  await settle(a.page);
  const start = cloud.calls.length;
  await syncNow(b.page);
  expect((await snapshot(b.page)).data.sessions).toHaveLength(300);
  expect((await snapshot(b.page)).data.slices).toHaveLength(300);
  const pulls = cloud.calls
    .slice(start)
    .filter((call) => call.name === "get_sync_changes");
  expect(pulls.length).toBeGreaterThanOrEqual(9);
  expect(pulls.map((call) => call.body.p_after)).toEqual(
    expect.arrayContaining(["0", "37", "74"]),
  );
  const cursor = (await snapshot(b.page)).cursors[0].cursor;
  const next = cloud.calls.length;
  await syncNow(b.page);
  const incremental = cloud.calls
    .slice(next)
    .filter((call) => call.name === "get_sync_changes");
  expect(incremental.length).toBeGreaterThan(0);
  expect(incremental.every((call) => call.body.p_after === cursor)).toBe(true);
  expect((await snapshot(b.page)).data.sessions).toHaveLength(300);
});

test("legacy import is explicit, backs up first, retains the source and safely keeps divergent ID histories", async ({
  browser,
  cloud,
}, testInfo) => {
  const a = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  const legacy = {
    subjects: [
      subject("shared-subject", "Legacy version"),
      subject("different-id", subject().name),
    ],
    sessions: [session()],
    slices: slices(),
    settings: { ...defaults, onboarded: true },
    running: null,
  };
  await a.page.evaluate(async (source) => {
    const storage = await import("/src/lib/storage.ts");
    localStorage.setItem("stride-browser-preview-v1", JSON.stringify(source));
    await storage.restoreData(source, storage.database);
  }, legacy);
  const readLegacy = () =>
    a.page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      return {
        data: await storage.readData(storage.database),
        raw: localStorage.getItem("stride-browser-preview-v1"),
      };
    });
  const original = await readLegacy();
  await a.page.reload();
  await expect(
    a.page.getByText("Existing study history found on this device", {
      exact: true,
    }),
  ).toBeVisible();
  await syncNow(a.page);
  expect((await snapshot(a.page)).data.subjects).toHaveLength(1);
  expect(await cloud.rows("sessions")).toHaveLength(0);
  await a.page
    .getByRole("button", { name: "Keep it stored for later", exact: true })
    .click();
  await a.page.reload();
  await expect(
    a.page.getByRole("button", { name: "Import into my account", exact: true }),
  ).toHaveCount(0);
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Import stored history", exact: true })
    .click();
  await expect(
    a.page.getByRole("dialog", { name: "Review history import" }),
  ).toBeVisible();
  await expect(
    a.page.getByRole("button", { name: "Import history", exact: true }),
  ).toBeDisabled();
  const backup = a.page.waitForEvent("download");
  await a.page
    .getByRole("button", { name: "Download backup", exact: true })
    .click();
  await (await backup).saveAs(testInfo.outputPath("legacy-backup.json"));
  await a.page.screenshot({
    path: "docs/screenshots/phase5-legacy-import.png",
    fullPage: true,
  });
  await a.page
    .getByRole("button", { name: "Import history", exact: true })
    .click();
  await expect(
    a.page.getByRole("dialog", { name: "Review history import" }),
  ).toHaveCount(0);
  await syncNow(a.page);
  const staged = await snapshot(a.page);
  expect(staged.data.subjects).toHaveLength(2);
  expect(staged.data.sessions).toHaveLength(0);
  expect(staged.conflicts.filter((record) => !record.resolved_at)).toHaveLength(
    1,
  );
  await a.page.locator(".sync-conflict summary").click();
  await expect(
    a.page.getByText("Legacy version", { exact: true }),
  ).toBeVisible();
  await a.page.getByRole("button", { name: "Keep both", exact: true }).click();
  await settle(a.page);
  const imported = await snapshot(a.page);
  expect(imported.data.subjects).toHaveLength(3);
  expect(imported.data.sessions).toHaveLength(1);
  const cloned = imported.data.subjects.find(
    (record) => record.name === "Legacy version",
  )!;
  expect(cloned.id).not.toBe("shared-subject");
  expect(imported.data.sessions[0].subject_id).toBe(cloned.id);
  expect(
    imported.data.slices.map((record) => ({
      day: record.day,
      seconds: record.seconds,
    })),
  ).toEqual(
    slices().map((record) => ({ day: record.day, seconds: record.seconds })),
  );
  expect(await readLegacy()).toEqual(original);
  await a.page.reload();
  await syncNow(a.page);
  expect((await snapshot(a.page)).data.subjects).toHaveLength(3);
  expect((await snapshot(a.page)).data.sessions).toHaveLength(1);
  expect(await cloud.rows("subjects")).toHaveLength(3);
  expect(await cloud.rows("sessions")).toHaveLength(1);
});

test("signed-in JSON backup import adds history, preserves unrelated cloud rows and remains restartable", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  await saveSubject(a.page);
  await saveSubject(
    a.page,
    subject("account-only", "Unrelated account history"),
  );
  await settle(a.page);
  const backup = {
    format: "stride",
    version: 1,
    exportedAt: "2026-09-22T12:00:00.000Z",
    subjects: [subject(), subject("backup-only", "Imported backup history")],
    sessions: [session()],
    slices: slices(),
    settings: { ...defaults, onboarded: true },
    running: null,
  };
  async function importBackup() {
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page.getByLabel("Import backup file").setInputFiles({
      name: "backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(backup)),
    });
    await expect(
      a.page.getByRole("dialog", { name: "Review backup import" }),
    ).toBeVisible();
    const download = a.page.waitForEvent("download");
    await a.page
      .getByRole("button", { name: "Download backup", exact: true })
      .click();
    await download;
    await a.page
      .getByRole("button", { name: "Import history", exact: true })
      .click();
    await expect(
      a.page.getByRole("dialog", { name: "Review backup import" }),
    ).toHaveCount(0);
    await settle(a.page);
  }
  await importBackup();
  const imported = await snapshot(a.page);
  expect(imported.data.subjects).toHaveLength(3);
  expect(
    imported.data.subjects.find((record) => record.id === "account-only")?.name,
  ).toBe("Unrelated account history");
  expect(imported.data.sessions).toEqual([session()]);
  expect(imported.data.slices).toEqual(slices());
  await a.page.reload();
  await syncNow(a.page);
  await importBackup();
  expect((await snapshot(a.page)).data.subjects).toHaveLength(3);
  expect((await snapshot(a.page)).data.sessions).toHaveLength(1);
  expect(await cloud.rows("subjects")).toHaveLength(3);
  expect(await cloud.rows("sessions")).toHaveLength(1);
});

test("late concurrent child cascaded by a parent delete remains recoverable and can be restored with its allocations", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await a.page.evaluate(async () => {
    const storage = await import("/src/lib/storage.ts");
    await storage.deleteSubject("shared-subject");
  });
  const gate = cloud.holdNextPull(a.page);
  let deleting: Promise<unknown> | undefined;
  try {
    deleting = syncNow(a.page);
    await gate.captured;
    await saveSession(b.page, session("late-child"), slices("late-child"));
    await settle(b.page);
    gate.release();
    await deleting;
    await syncNow(a.page);
    const deleted = await snapshot(a.page);
    expect(await cloud.rows("sessions")).toHaveLength(0);
    const conflict = deleted.conflicts.find(
      (record) =>
        record.entity === "session" &&
        record.record_id === "late-child" &&
        !record.resolved_at,
    )!;
    expect(conflict).toBeDefined();
    expect(conflict.local_snapshot).toMatchObject({
      action: "upsert",
      payload: { session: session("late-child"), slices: slices("late-child") },
    });
    expect(conflict.remote_snapshot).toEqual({
      action: "delete",
      payload: null,
    });
    await a.page.evaluate(async (id) => {
      const { activeSyncWorker } = await import("/src/lib/sync/worker.ts");
      const { resolveConflict } = await import("/src/lib/sync/conflicts.ts");
      if (!activeSyncWorker) throw new Error("Missing account sync worker");
      await activeSyncWorker.runExclusive((db, guard) =>
        resolveConflict(db, id, "local", guard),
      );
    }, conflict.id);
    await settle(a.page);
    const recovered = await snapshot(a.page);
    expect(recovered.data.subjects).toHaveLength(1);
    expect(recovered.data.sessions).toEqual([session("late-child")]);
    expect(recovered.data.slices).toEqual(slices("late-child"));
    expect(await cloud.rows("subjects")).toHaveLength(1);
    expect(await cloud.rows("sessions")).toHaveLength(1);
    expect(await cloud.rows("allocations")).toHaveLength(2);
  } finally {
    gate.release();
    await deleting?.catch(() => undefined);
  }
});

test("a child create rejected after concurrent parent deletion can be safely recovered under new operation IDs", async ({
  browser,
  cloud,
}, testInfo) => {
  const a = await device(browser, cloud);
  const b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await b.context.setOffline(true);
  await saveSession(
    b.page,
    session("rejected-child"),
    slices("rejected-child"),
  );
  const gate = cloud.holdNextPull(b.page);
  let submitting: Promise<unknown> | undefined;
  try {
    await b.context.setOffline(false);
    submitting = syncNow(b.page);
    await gate.captured;
    await a.page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      await storage.deleteSubject("shared-subject");
    });
    await settle(a.page);
    gate.release();
    await submitting;
    const rejected = await snapshot(b.page);
    expect(rejected.data.sessions).toEqual([session("rejected-child")]);
    expect(rejected.data.slices).toEqual(slices("rejected-child"));
    const pending = rejected.operations.find(
      (record) => record.record_id === "rejected-child",
    )!;
    expect(pending.status).toBe("in_flight");
    const error = rejected.metadata.find(
      (record) => record.key === `op_error:${pending.id}`,
    )!;
    expect(JSON.parse(error.value).definitiveNoCommit).toBe(true);
    expect(await cloud.rows("sessions")).toHaveLength(0);
    const receipts = await cloud.db.query<{ n: number }>(
      "select count(*)::integer as n from stride_private.stride_sync_operations where owner_id = $1 and operation_id = $2",
      [users["first@example.test"], pending.id],
    );
    expect(receipts.rows[0].n).toBe(0);
    await b.page.getByRole("button", { name: "Settings", exact: true }).click();
    await b.page.locator(".sync-conflict summary").click();
    await b.page
      .getByRole("button", { name: "Keep this device’s version", exact: true })
      .click();
    try {
      await settle(b.page);
    } catch (error) {
      await testInfo.attach("recovery-state", {
        body: JSON.stringify(await snapshot(b.page), null, 2),
        contentType: "application/json",
      });
      await testInfo.attach("rpc-calls", {
        body: JSON.stringify(cloud.calls, null, 2),
        contentType: "application/json",
      });
      throw error;
    }
    const restored = await snapshot(b.page);
    expect(restored.data.subjects).toEqual([subject()]);
    expect(restored.data.sessions).toEqual([session("rejected-child")]);
    expect(restored.data.slices).toEqual(slices("rejected-child"));
    expect(
      restored.conflicts.filter((record) => !record.resolved_at),
    ).toHaveLength(0);
    expect(JSON.stringify(restored.recovery)).toContain(pending.id);
    const attempts = cloud.calls.filter(
      (call) =>
        call.name === "apply_sync_operation" &&
        call.body.p_record_id === "rejected-child",
    );
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.at(-1)!.body.p_operation_id).not.toBe(pending.id);
    expect(attempts.at(-1)!.body.p_payload).toEqual(attempts[0].body.p_payload);
    expect(await cloud.rows("subjects")).toHaveLength(1);
    expect(await cloud.rows("sessions")).toHaveLength(1);
    expect(await cloud.rows("allocations")).toHaveLength(2);
  } finally {
    gate.release();
    await submitting?.catch(() => undefined);
  }
});

for (const choice of ["remote", "both"] as const) {
  test(`parent ${choice} resolution preserves children moved to another subject and their independent conflicts`, async ({
    browser,
    cloud,
  }) => {
    const a = await device(browser, cloud);
    const b = await device(browser, cloud);
    const otherParent = subject("other-subject", "Another existing subject");
    const originalChild = session("existing-moved-child");
    const localChild = {
      ...originalChild,
      notes: "Local child edit awaiting an independent decision",
    };
    const newChild = {
      ...session("new-moved-child"),
      session_title: "Pending child created before moving",
    };
    await saveSubject(a.page);
    await saveSubject(a.page, otherParent);
    await saveSession(a.page, originalChild);
    await settle(a.page);
    await syncNow(b.page);
    // Development mode has no app-shell worker. Load this route while online
    // before the offline conflict review; production PWA precaches its chunks.
    await b.page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      b.page.getByRole("heading", { name: "Settings", exact: true }),
    ).toBeVisible();
    await b.page.getByRole("button", { name: "Home", exact: true }).click();
    await b.context.setOffline(true);
    await saveSubject(
      b.page,
      subject("shared-subject", "Device B parent version"),
    );
    await saveSession(b.page, newChild);
    await saveSession(b.page, localChild);
    await saveSubject(
      a.page,
      subject("shared-subject", "Device A parent version"),
    );
    await saveSession(a.page, {
      ...originalChild,
      notes: "Cloud child edit awaiting an independent decision",
    });
    await settle(a.page);
    await b.context.setOffline(false);
    await syncNow(b.page);
    const captured = await snapshot(b.page);
    const parentConflict = captured.conflicts.find(
      (record) => record.entity === "subject" && !record.resolved_at,
    )!;
    const childConflict = captured.conflicts.find(
      (record) =>
        record.entity === "session" &&
        record.record_id === originalChild.id &&
        !record.resolved_at,
    )!;
    expect(parentConflict).toBeDefined();
    expect(childConflict).toBeDefined();
    expect(captured.data.sessions).toHaveLength(2);
    await b.context.setOffline(true);
    const movedChild = { ...localChild, subject_id: otherParent.id };
    const movedNewChild = { ...newChild, subject_id: otherParent.id };
    await saveSession(b.page, movedChild);
    await saveSession(b.page, movedNewChild);
    const beforeChoice = await snapshot(b.page);
    const movedOperations = beforeChoice.operations.filter(
      (operation) => operation.entity === "session",
    );
    expect(movedOperations).toHaveLength(2);
    await b.page.getByRole("button", { name: "Settings", exact: true }).click();
    const parentReview = b.page
      .locator(".sync-conflict")
      .filter({ hasText: "Two versions of a subject need review" });
    await parentReview.locator("summary").click();
    await parentReview
      .getByRole("button", {
        name: choice === "remote" ? "Use cloud version" : "Keep both",
        exact: true,
      })
      .click();
    await expect
      .poll(async () =>
        Boolean(
          (await snapshot(b.page)).conflicts.find(
            (record) => record.id === parentConflict.id,
          )?.resolved_at,
        ),
      )
      .toBe(true);
    const afterChoice = await snapshot(b.page);
    expect(afterChoice.data.sessions).toEqual(
      expect.arrayContaining([movedChild, movedNewChild]),
    );
    expect(afterChoice.data.sessions).toHaveLength(2);
    expect(afterChoice.data.slices).toEqual(
      expect.arrayContaining([
        ...slices(originalChild.id),
        ...slices(newChild.id),
      ]),
    );
    expect(afterChoice.data.slices).toHaveLength(4);
    expect(
      afterChoice.operations.filter(
        (operation) => operation.entity === "session",
      ),
    ).toEqual(movedOperations);
    expect(
      afterChoice.conflicts.find((record) => record.id === childConflict.id)
        ?.resolved_at,
    ).toBeNull();
    expect(afterChoice.data.subjects).toHaveLength(choice === "both" ? 3 : 2);
    await b.context.setOffline(false);
    await syncNow(b.page);
    await expect
      .poll(async () =>
        (await snapshot(b.page)).operations.some(
          (operation) => operation.record_id === newChild.id,
        ),
      )
      .toBe(false);
    const independentlyPending = await snapshot(b.page);
    expect(
      independentlyPending.conflicts.find(
        (record) => record.id === childConflict.id,
      )?.resolved_at,
    ).toBeNull();
    expect(independentlyPending.data.sessions).toContainEqual(movedChild);
    expect(
      (await cloud.rows("sessions")).find((row) => row.id === newChild.id),
    ).toMatchObject({
      id: movedNewChild.id,
      subject_id: otherParent.id,
      session_title: movedNewChild.session_title,
      notes: movedNewChild.notes,
      duration_seconds: movedNewChild.duration_seconds,
    });
    expect(
      (await cloud.rows("sessions")).find((row) => row.id === originalChild.id),
    ).toMatchObject({
      subject_id: "shared-subject",
      notes: "Cloud child edit awaiting an independent decision",
    });
    await b.context.setOffline(true);
    const childReview = b.page
      .locator(".sync-conflict")
      .filter({ hasText: "Two versions of a session need review" });
    await childReview.locator("summary").click();
    await childReview
      .getByRole("button", { name: "Keep this device’s version", exact: true })
      .click();
    await b.context.setOffline(false);
    await settle(b.page);
    await syncNow(a.page);
    const received = await snapshot(a.page);
    expect(received.data.sessions).toEqual(
      expect.arrayContaining([movedChild, movedNewChild]),
    );
    expect(received.data.sessions).toHaveLength(2);
    expect(received.data.slices).toHaveLength(4);
    expect(await cloud.rows("allocations")).toHaveLength(4);
    expect(
      (await cloud.rows("sessions")).find((row) => row.id === originalChild.id),
    ).toMatchObject({
      id: movedChild.id,
      subject_id: otherParent.id,
      session_title: movedChild.session_title,
      notes: movedChild.notes,
      duration_seconds: movedChild.duration_seconds,
    });
  });
}
