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
} from "./storage";
import { defaults, type Data, type Subject } from "../models";
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
