import { expect, test as base, type Page } from "@playwright/test";
import {
  SqlSyncServer,
  device,
  saveSubject,
  saveSession,
  subject,
  session,
  slices,
  settle,
  syncNow,
  snapshot,
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

async function assertConverged(
  a: Page,
  b: Page,
  cloud: SqlSyncServer,
  count: number,
) {
  await settle(a);
  await syncNow(b);
  const first = await snapshot(a),
    second = await snapshot(b);
  expect(first.operations).toHaveLength(0);
  expect(second.operations).toHaveLength(0);
  expect(first.data.sessions).toHaveLength(count);
  expect(second.data.subjects).toEqual(first.data.subjects);
  expect(second.data.sessions).toEqual(first.data.sessions);
  expect(second.data.slices).toEqual(first.data.slices);
  const records = await cloud.rows("sessions"),
    allocations = await cloud.rows("allocations");
  expect(records).toHaveLength(count);
  expect(allocations).toHaveLength(first.data.slices.length);
  for (const record of first.data.sessions) {
    expect(records.find((row) => row.id === record.id)).toMatchObject({
      subject_id: record.subject_id,
      notes: record.notes,
      duration_seconds: record.duration_seconds,
      session_title: record.session_title,
      mode: record.mode,
      completed: record.completed,
    });
    const stored = records.find((row) => row.id === record.id)!;
    expect(new Date(stored.started_at as string).toISOString()).toBe(
      record.started_at,
    );
    expect(new Date(stored.ended_at as string).toISOString()).toBe(
      record.ended_at,
    );
    const days = allocations.filter((row) => row.session_id === record.id);
    expect(
      days.map((row) => ({
        day:
          row.day instanceof Date
            ? row.day.toISOString().slice(0, 10)
            : row.day,
        seconds: row.seconds,
      })),
    ).toEqual(
      first.data.slices
        .filter((row) => row.session_id === record.id)
        .map((row) => ({ day: row.day, seconds: row.seconds })),
    );
  }
}

for (const choice of ["remote", "both"] as const) {
  test(`review: ${choice} live-subject resolution preserves independent new and edited child uploads`, async ({
    browser,
    cloud,
  }) => {
    const a = await device(browser, cloud),
      b = await device(browser, cloud);
    await saveSubject(a.page);
    await saveSession(a.page);
    await settle(a.page);
    await syncNow(b.page);
    await a.context.setOffline(true);
    await saveSubject(a.page, { ...subject(), name: "Device subject" });
    await saveSession(a.page, {
      ...session(),
      notes: "Independent device edit",
    });
    await saveSession(a.page, session("new-local"), slices("new-local"));
    await saveSubject(b.page, { ...subject(), name: "Cloud subject" });
    await settle(b.page);
    await a.context.setOffline(false);
    await syncNow(a.page);
    await a.page.getByRole("button", { name: "Settings", exact: true }).click();
    await a.page.locator(".sync-conflict summary").click();
    await a.page
      .getByRole("button", {
        name: choice === "remote" ? "Use cloud version" : "Keep both",
        exact: true,
      })
      .click();
    await assertConverged(a.page, b.page, cloud, choice === "remote" ? 2 : 4);
    const final = await snapshot(a.page);
    expect(
      final.data.sessions.find((row) => row.id === session().id)?.notes,
    ).toBe("Independent device edit");
    expect(final.data.sessions.some((row) => row.id === "new-local")).toBe(
      true,
    );
    expect(final.conflicts.filter((row) => !row.resolved_at)).toHaveLength(0);
    if (choice === "both") {
      expect(final.data.subjects).toHaveLength(2);
      expect(new Set(final.data.sessions.map((row) => row.id)).size).toBe(4);
    }
  });
}

for (const [entity, change] of [
  ["subject", "edited"],
  ["session", "edited"],
  ["subject", "archived"],
  ["subject", "deleted"],
  ["session", "deleted"],
  ["session", "parent deleted"],
] as const) {
  test(`review: an open ${entity} editor retains its draft after the remote record is ${change}`, async ({
    browser,
    cloud,
  }) => {
    const a = await device(browser, cloud),
      b = await device(browser, cloud);
    await saveSubject(a.page);
    await saveSession(a.page);
    await settle(a.page);
    await syncNow(b.page);
    if (entity === "subject" || change === "parent deleted") {
      await a.page
        .getByRole("button", { name: "Subjects", exact: true })
        .click();
      await a.page
        .getByRole("button", { name: subject().name, exact: true })
        .click();
      await a.page
        .getByRole("button", {
          name: entity === "subject" ? "Edit subject" : "Edit session",
          exact: true,
        })
        .click();
    } else {
      await a.page
        .getByRole("button", { name: "History", exact: true })
        .click();
      await a.page
        .getByRole("button", { name: "Edit session", exact: true })
        .click();
    }
    const editor = a.page.getByRole("dialog", {
      name: entity === "subject" ? "Edit subject" : "Edit study session",
      exact: true,
    });
    await expect(
      editor.getByRole("button", { name: "Save changes", exact: true }),
    ).toBeEnabled();
    const field = editor.getByLabel(
      entity === "subject" ? "Subject name" : "Title",
      { exact: true },
    );
    await field.fill("Unsaved device draft");
    if (change === "deleted" || change === "parent deleted")
      await b.page.evaluate(
        async ({ entity, id }) => {
          const storage = await import("/src/lib/storage.ts");
          if (entity === "subject") await storage.deleteSubject(id);
          else await storage.deleteSession(id);
        },
        {
          entity: change === "parent deleted" ? "subject" : entity,
          id:
            entity === "subject" || change === "parent deleted"
              ? subject().id
              : session().id,
        },
      );
    else if (entity === "subject")
      await saveSubject(b.page, {
        ...subject(),
        description: "New remote description",
        archived: change === "archived" ? 1 : 0,
      });
    else await saveSession(b.page, { ...session(), notes: "New remote notes" });
    await settle(b.page);
    await syncNow(a.page);
    await editor
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(editor.getByRole("alert")).toContainText("Your draft");
    await expect(field).toHaveValue("Unsaved device draft");
    await expect(editor).toBeVisible();
    await syncNow(a.page);
    await syncNow(b.page);
    const first = await snapshot(a.page),
      second = await snapshot(b.page);
    expect(first.data.subjects).toEqual(second.data.subjects);
    expect(first.data.sessions).toEqual(second.data.sessions);
    expect(first.data.slices).toEqual(second.data.slices);
    expect(first.operations).toHaveLength(0);
    if (change === "deleted" || change === "parent deleted") {
      expect(
        entity === "subject" ? first.data.subjects : first.data.sessions,
      ).toHaveLength(0);
      expect(
        await cloud.rows(entity === "subject" ? "subjects" : "sessions"),
      ).toHaveLength(0);
      return;
    }
    expect(
      entity === "subject"
        ? first.data.subjects[0].description
        : first.data.sessions[0].notes,
    ).toBe(
      entity === "subject" ? "New remote description" : "New remote notes",
    );
    expect(
      (await cloud.rows(entity === "subject" ? "subjects" : "sessions"))[0],
    ).toMatchObject(
      entity === "subject"
        ? { description: "New remote description" }
        : { notes: "New remote notes" },
    );
  });
}

test("review: a remotely archived subject can be restored while its existing timer safely pauses, restarts and finishes", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud),
    b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await a.page.clock.install({ time: new Date("2026-10-01T23:50:00+08:00") });
  await a.page.clock.setFixedTime(new Date("2026-10-01T23:50:00+08:00"));
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await a.page.getByRole("button", { name: "Stopwatch", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await a.page.clock.fastForward(20 * 60_000);
  await a.page.clock.setFixedTime(new Date("2026-10-02T00:10:00+08:00"));
  await saveSubject(b.page, { ...subject(), archived: 1 });
  await settle(b.page);
  await syncNow(a.page);
  await a.page.getByRole("button", { name: "Pause", exact: true }).click();
  await expect(
    a.page.getByRole("button", { name: "Resume", exact: true }),
  ).toBeVisible();
  const paused = (await snapshot(a.page)).data.running!;
  await a.page.reload();
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  expect((await snapshot(a.page)).data.running).toEqual(paused);
  await a.context.setOffline(true);
  await a.page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await a.page
    .getByRole("button", { name: "Save session", exact: true })
    .click();
  const saved = (await snapshot(a.page)).data;
  expect(saved.running).toBeNull();
  expect(saved.sessions[0].duration_seconds).toBe(1200);
  expect(saved.slices.map((row) => row.day)).toEqual([
    "2026-10-01",
    "2026-10-02",
  ]);
  await a.context.setOffline(false);
  await assertConverged(a.page, b.page, cloud, 1);
  // A second existing timer exercises the restoration control, independently of finish.
  await saveSubject(b.page, { ...subject(), archived: 0 });
  await settle(b.page);
  await syncNow(a.page);
  await a.page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await saveSubject(b.page, { ...subject(), archived: 1 });
  await settle(b.page);
  await syncNow(a.page);
  await a.page.getByRole("button", { name: "Back to workspace" }).click();
  await a.page.getByRole("button", { name: "Subjects", exact: true }).click();
  await a.page.getByRole("button", { name: "Archived", exact: true }).click();
  await a.page
    .getByRole("button", { name: subject().name, exact: true })
    .click();
  await a.page
    .getByRole("button", { name: "Edit subject", exact: true })
    .click();
  await a.page
    .getByRole("button", { name: "Restore subject", exact: true })
    .click();
  await settle(a.page);
  await syncNow(b.page);
  expect((await snapshot(a.page)).data.running).not.toBeNull();
  expect((await cloud.rows("subjects"))[0].archived).toBe(0);
});

test("review: backward-clock resume is blocked without losing paused time and remains saveable after restart", async ({
  browser,
  cloud,
}) => {
  const a = await device(browser, cloud),
    b = await device(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await a.page.clock.install({ time: new Date("2026-10-01T10:00:00+08:00") });
  await a.page.clock.setFixedTime(new Date("2026-10-01T10:00:00+08:00"));
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await a.page.getByRole("button", { name: "Stopwatch", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Start session", exact: true })
    .click();
  await a.page.clock.fastForward(600_000);
  await a.page.clock.setFixedTime(new Date("2026-10-01T10:10:00+08:00"));
  await a.page.getByRole("button", { name: "Pause", exact: true }).click();
  const paused = (await snapshot(a.page)).data.running!;
  await a.page.clock.setFixedTime(new Date("2026-10-01T10:05:00+08:00"));
  await a.page.getByRole("button", { name: "Resume", exact: true }).click();
  await expect(a.page.getByRole("alert")).toContainText("clock moved backward");
  expect((await snapshot(a.page)).data.running).toEqual(paused);
  await a.page.clock.setFixedTime(new Date("2026-10-01T10:15:00+08:00"));
  await a.page.reload();
  await a.page.getByRole("button", { name: "Focus", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Finish session", exact: true })
    .click();
  await a.page
    .getByRole("button", { name: "Save session", exact: true })
    .click();
  const saved = (await snapshot(a.page)).data;
  expect(saved.running).toBeNull();
  expect(saved.sessions[0].duration_seconds).toBe(600);
  expect(saved.slices.reduce((total, row) => total + row.seconds, 0)).toBe(
    saved.sessions[0].duration_seconds,
  );
  await settle(a.page);
  await syncNow(b.page);
  await assertConverged(a.page, b.page, cloud, 1);
  expect((await snapshot(b.page)).data.sessions).toEqual(saved.sessions);
  expect((await snapshot(b.page)).data.slices).toEqual(saved.slices);
  expect((await cloud.rows("sessions"))[0].duration_seconds).toBe(
    saved.sessions[0].duration_seconds,
  );
});
