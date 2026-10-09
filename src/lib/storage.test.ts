import "fake-indexeddb/auto";
import { beforeEach, afterEach, describe, it, expect } from "vitest";
import {
  database,
  initialize,
  readData,
  restoreData,
  saveSubject,
  saveSession,
  saveRunning,
  deleteSession,
  deleteSubject,
  captureEditSnapshot,
  selectWorkspace,
  getActiveDatabase,
} from "./storage";
import { defaults, type Data, type Subject, type Running } from "../models";
import {
  resumeTimer,
  activeSegments,
  elapsed,
  assertTimerOrder,
} from "./timer";
import { splitSegments } from "./analytics";
import { parseBackup, validateData } from "./validation";
const subject: Subject = {
  id: "math",
  name: "Mathematics",
  description: "",
  icon: "book",
  color: "#8b91e8",
  created_at: "2026-09-21T10:00:00.000Z",
  archived: 0,
};
const sample = (): Data => ({
  subjects: [subject],
  sessions: [
    {
      id: "one",
      subject_id: "math",
      started_at: "2026-09-21T10:00:00.000Z",
      ended_at: "2026-09-21T10:20:00.000Z",
      duration_seconds: 1200,
      session_title: "Practice",
      notes: "",
      mode: "stopwatch",
      completed: 1,
    },
  ],
  slices: [{ session_id: "one", day: "2026-09-21", seconds: 1200 }],
  settings: { ...defaults, onboarded: true },
  running: null,
});
beforeEach(async () => {
  selectWorkspace(null);
  await database.delete();
  await database.open();
});
afterEach(async () => {
  await database.delete();
});
describe("IndexedDB persistence", () => {
  it("migrates old browser data exactly once and survives closing the database", async () => {
    await initialize(database, JSON.stringify(sample()));
    await database.subjects.put({ ...subject, name: "Renamed" });
    database.close();
    await database.open();
    await initialize(database, JSON.stringify(sample()));
    const result = await readData();
    expect(result.subjects[0].name).toBe("Renamed");
    expect(result.sessions).toEqual(sample().sessions);
    expect(result.slices).toEqual(sample().slices);
  });
  it("does not initialize or write records when the old data is invalid", async () => {
    await expect(
      initialize(database, JSON.stringify({ ...sample(), slices: [] })),
    ).rejects.toThrow();
    expect(await database.subjects.count()).toBe(0);
    expect(await database.meta.get("initialized")).toBeUndefined();
  });
  it("atomically saves the session, allocations, and recovery checkpoint", async () => {
    await initialize(database, null);
    await saveSubject(subject);
    await saveRunning({
      id: "one",
      subjectId: "math",
      startedAt: "2026-09-21T10:00:00.000Z",
      title: "",
      mode: "stopwatch",
      target: 1500,
      segments: [],
      runningSince: Date.parse("2026-09-21T10:00:00.000Z"),
      notified: false,
    });
    await saveSession(sample().sessions[0], sample().slices);
    expect((await readData()).running).toBeNull();
    expect(await database.sessions.count()).toBe(1);
    await saveSession(sample().sessions[0], sample().slices);
    expect(await database.sessions.count()).toBe(1);
    await deleteSession("one");
    expect(await database.slices.count()).toBe(0);
  });
  it("deletes a subject and its related records together", async () => {
    await initialize(database, JSON.stringify(sample()));
    await deleteSubject("math");
    const data = await readData();
    expect([
      data.subjects.length,
      data.sessions.length,
      data.slices.length,
    ]).toEqual([0, 0, 0]);
  });
  it("rejects an invalid restore without modifying existing data", async () => {
    await initialize(database, JSON.stringify(sample()));
    await expect(restoreData({ ...sample(), subjects: [] })).rejects.toThrow();
    expect((await readData()).sessions).toEqual(sample().sessions);
  });
  it("replaces data transactionally and persists preferences", async () => {
    await initialize(database, null);
    await restoreData({
      ...sample(),
      settings: { ...defaults, theme: "light", minimum: 35 },
    });
    database.close();
    await database.open();
    expect((await readData()).settings.minimum).toBe(35);
    expect((await readData()).subjects).toEqual(sample().subjects);
  });
});
describe("editor compare-and-save", () => {
  it("allows ordinary subject and text-only session edits without changing allocations", async () => {
    await initialize(database, JSON.stringify(sample()));
    const original = sample().sessions[0];
    const subjectEdit = await captureEditSnapshot(
      "subject",
      subject.id,
      subject,
    );
    const sessionEdit = await captureEditSnapshot("session", original.id, {
      session: original,
      slices: sample().slices,
    });
    await saveSubject({ ...subject, name: "New name" }, subjectEdit);
    await saveSession(
      { ...original, notes: "New notes" },
      sample().slices,
      sessionEdit,
    );
    expect((await readData()).slices).toEqual(sample().slices);
    expect((await readData()).sessions[0].notes).toBe("New notes");
  });

  it.each(["changed", "archived", "deleted", "revision"])(
    "rejects a subject draft after the record is %s, without any write",
    async (change) => {
      await initialize(database, JSON.stringify(sample()));
      const edit = await captureEditSnapshot("subject", subject.id, subject);
      if (change === "deleted") await deleteSubject(subject.id);
      else if (change === "revision")
        await database.recordRevisions.put({
          entity: "subject",
          record_id: subject.id,
          server_revision: "2",
          updated_at: subject.created_at,
        });
      else
        await saveSubject({
          ...subject,
          description: "Remote text",
          archived: change === "archived" ? 1 : 0,
        });
      const before = await readData();
      await expect(
        saveSubject({ ...subject, name: "Draft" }, edit),
      ).rejects.toThrow("Your draft");
      await expect(deleteSubject(subject.id, edit)).rejects.toThrow(
        "Your draft",
      );
      expect(await readData()).toEqual(before);
    },
  );

  it.each(["changed", "deleted", "allocations", "revision"])(
    "rejects a session draft after %s changes, without any write",
    async (change) => {
      await initialize(database, JSON.stringify(sample()));
      const original = sample().sessions[0];
      const edit = await captureEditSnapshot("session", original.id, {
        session: original,
        slices: sample().slices,
      });
      if (change === "deleted") await deleteSession(original.id);
      else if (change === "revision")
        await database.recordRevisions.put({
          entity: "session",
          record_id: original.id,
          server_revision: "2",
          updated_at: subject.created_at,
        });
      else if (change === "allocations")
        await database.slices.put({ ...sample().slices[0], seconds: 1199 });
      else
        await saveSession(
          { ...original, notes: "Remote notes" },
          sample().slices,
        );
      const before = await readData();
      await expect(
        saveSession({ ...original, notes: "Draft" }, sample().slices, edit),
      ).rejects.toThrow("Your draft");
      expect(await readData()).toEqual(before);
    },
  );

  it("refuses to capture stale visible fields and refuses a snapshot after switching accounts", async () => {
    await initialize(database, JSON.stringify(sample()));
    await expect(
      captureEditSnapshot("subject", subject.id, { ...subject, name: "Old" }),
    ).rejects.toThrow("Your draft");
    const edit = await captureEditSnapshot("subject", subject.id, subject);
    selectWorkspace("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa");
    const account = getActiveDatabase();
    try {
      await initialize(account, null);
      await saveSubject(subject);
      await expect(
        saveSubject({ ...subject, name: "Wrong account" }, edit),
      ).rejects.toThrow("Your draft");
      expect((await readData(account)).subjects).toEqual([subject]);
      expect(await account.pendingOperations.count()).toBe(1);
    } finally {
      selectWorkspace(null);
      await account.delete();
    }
  });

  it("serializes a newer write ahead of a stale save and rolls back its outbox mutation", async () => {
    selectWorkspace("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb");
    const account = getActiveDatabase();
    try {
      await initialize(account, null);
      await saveSubject(subject);
      const edit = await captureEditSnapshot("subject", subject.id, subject);
      const newer = saveSubject({
        ...subject,
        description: "New remote value",
      });
      const stale = saveSubject({ ...subject, name: "Old draft" }, edit);
      await newer;
      await expect(stale).rejects.toThrow("Your draft");
      expect((await readData()).subjects[0].description).toBe(
        "New remote value",
      );
      const ops = await account.pendingOperations.toArray();
      expect(ops).toHaveLength(1);
      expect(ops[0].payload).toMatchObject({
        name: subject.name,
        description: "New remote value",
      });
    } finally {
      selectWorkspace(null);
      await account.delete();
    }
  });
});

describe("timer archive and clock integrity", () => {
  const start = new Date(2026, 8, 21, 23, 50).getTime();
  const timer = (): Running => ({
    id: "timer",
    subjectId: subject.id,
    startedAt: new Date(start).toISOString(),
    title: "",
    mode: "stopwatch",
    target: 1500,
    segments: [],
    runningSince: start,
    notified: false,
  });

  it("updates an existing archived-subject timer across restart and saves the original midnight allocations", async () => {
    await initialize(database, null);
    await saveSubject(subject);
    await saveRunning(timer());
    await saveSubject({ ...subject, archived: 1 });
    const paused = {
      ...timer(),
      segments: activeSegments(timer(), start + 1200000),
      runningSince: null,
    };
    await saveRunning(paused);
    database.close();
    await database.open();
    expect((await readData()).running).toEqual(paused);
    await saveRunning(resumeTimer(paused, start + 1800000));
    await saveRunning(paused);
    await saveSession(
      {
        ...sample().sessions[0],
        id: paused.id,
        started_at: paused.startedAt,
        ended_at: new Date(start + 1200000).toISOString(),
      },
      splitSegments(paused.id, paused.segments),
    );
    const data = await readData();
    expect(data.running).toBeNull();
    expect(data.slices).toEqual([
      { session_id: "timer", day: "2026-09-21", seconds: 600 },
      { session_id: "timer", day: "2026-09-22", seconds: 600 },
    ]);
    await expect(saveRunning({ ...timer(), id: "new" })).rejects.toThrow(
      "active subject",
    );
  });

  it("rejects backward resume atomically, retaining all ten minutes after restart", async () => {
    await initialize(database, null);
    await saveSubject(subject);
    const paused = {
      ...timer(),
      segments: activeSegments(timer(), start + 600000),
      runningSince: null,
    };
    await saveRunning(paused);
    expect(() => resumeTimer(paused, start + 300000)).toThrow(
      "clock moved backward",
    );
    await expect(
      saveRunning({ ...paused, runningSince: start + 300000 }),
    ).rejects.toThrow("clock moved backward");
    database.close();
    await database.open();
    expect((await readData()).running).toEqual(paused);
    expect(elapsed(paused, start + 900000)).toBe(600);
    await saveSession(
      {
        ...sample().sessions[0],
        id: paused.id,
        started_at: paused.startedAt,
        ended_at: new Date(start + 600000).toISOString(),
        duration_seconds: 600,
      },
      splitSegments(paused.id, paused.segments),
    );
    expect((await readData()).slices.reduce((n, s) => n + s.seconds, 0)).toBe(
      600,
    );
  });

  it.each(["stopwatch", "countdown"] as const)(
    "keeps normal multiple pauses and midnight accounting for %s",
    (mode) => {
      const first = {
        ...timer(),
        mode,
        segments: activeSegments(timer(), start + 600000),
        runningSince: null,
      };
      const second = resumeTimer(first, start + 900000);
      const paused = {
        ...second,
        segments: activeSegments(second, start + 1500000),
        runningSince: null,
      };
      const third = resumeTimer(paused, start + 1800000);
      const segments = activeSegments(third, start + 2400000);
      assertTimerOrder({ ...third, segments, runningSince: null });
      const seconds = mode === "countdown" ? 1500 : 1800;
      expect(elapsed(third, start + 2400000)).toBe(seconds);
      expect(
        splitSegments("timer", segments).reduce((n, s) => n + s.seconds, 0),
      ).toBe(seconds);
      expect(segments[1].start).toBe(start + 900000);
    },
  );

  it("preserves a previously overlapping timer as a raw recovery copy rather than silently rewriting it", async () => {
    await initialize(database, null);
    await saveSubject(subject);
    const affected = {
      ...timer(),
      segments: [
        { start, end: start + 600000 },
        { start: start + 300000, end: start + 900000 },
      ],
      runningSince: null,
    };
    await database.timers.put({ id: 1, value: affected });
    expect(() => resumeTimer(affected, start + 900000)).toThrow(
      "overlapping time",
    );
    await expect(saveRunning(affected)).rejects.toThrow("overlapping time");
    expect((await readData()).running).toEqual(affected);
    await saveRunning(null);
    expect((await database.recoveryCopies.toArray())[0].snapshot).toMatchObject(
      { discarded_timer: affected },
    );
  });
});

describe("backup validation", () => {
  it("rejects duplicates, broken references, invalid dates and mismatched totals", () => {
    expect(() =>
      validateData({ ...sample(), subjects: [subject, subject] }),
    ).toThrow();
    expect(() =>
      validateData({
        ...sample(),
        sessions: [{ ...sample().sessions[0], subject_id: "missing" }],
      }),
    ).toThrow();
    expect(() =>
      validateData({
        ...sample(),
        slices: [{ session_id: "one", day: "2026-02-31", seconds: 1200 }],
      }),
    ).toThrow();
    expect(() =>
      validateData({
        ...sample(),
        slices: [{ session_id: "one", day: "2026-09-21", seconds: 100 }],
      }),
    ).toThrow();
  });
  it("rejects unknown backup versions", () =>
    expect(() =>
      parseBackup(
        JSON.stringify({
          ...sample(),
          format: "stride",
          version: 2,
          exportedAt: "2026-09-21T11:00:00.000Z",
        }),
      ),
    ).toThrow());
  it("pauses imported timers at export time", () => {
    const data = {
      ...sample(),
      running: {
        id: "two",
        subjectId: "math",
        startedAt: "2026-09-21T11:00:00.000Z",
        title: "",
        mode: "stopwatch",
        target: 1500,
        segments: [],
        runningSince: Date.parse("2026-09-21T11:00:00.000Z"),
        notified: false,
      },
    };
    const result = parseBackup(
      JSON.stringify({
        ...data,
        format: "stride",
        version: 1,
        exportedAt: "2026-09-21T11:02:00.000Z",
      }),
    );
    expect(result.running?.runningSince).toBeNull();
    expect(result.running?.segments).toEqual([
      {
        start: Date.parse("2026-09-21T11:00:00.000Z"),
        end: Date.parse("2026-09-21T11:02:00.000Z"),
      },
    ]);
  });
});
