import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { splitSegments } from "./analytics";
import {
  defaults,
  type Running,
  type Session,
  type Slice,
  type Subject,
} from "../models";
import {
  StrideDatabase,
  database,
  deleteSession,
  getActiveDatabase,
  initialize,
  readData,
  restoreData,
  saveRunning,
  saveSession,
  saveSubject,
  selectWorkspace,
} from "./storage";
import { parseBackup } from "./validation";

const subject: Subject = {
  id: "math",
  name: "Mathematics",
  description: "Original subject",
  icon: "book",
  color: "#8b91e8",
  created_at: "2026-09-20T10:00:00.000Z",
  archived: 0,
};

const session: Session = {
  id: "session-one",
  subject_id: subject.id,
  started_at: "2026-09-21T10:00:00.000Z",
  ended_at: "2026-09-21T10:20:00.000Z",
  duration_seconds: 1200,
  session_title: "Practice",
  notes: "Original notes",
  mode: "stopwatch",
  completed: 1,
};

const slices: Slice[] = [
  { session_id: session.id, day: "2026-09-21", seconds: 1200 },
];

const timer: Running = {
  id: "unfinished-timer",
  subjectId: subject.id,
  startedAt: "2026-09-22T10:00:00.000Z",
  title: "Continue tomorrow",
  mode: "stopwatch",
  target: 1500,
  segments: [{ start: 1790071200000, end: 1790071260000 }],
  runningSince: null,
  notified: false,
};

const openedDatabases = new Set<StrideDatabase>();

async function openAccount(accountId = crypto.randomUUID()) {
  selectWorkspace(accountId);
  const db = getActiveDatabase();
  openedDatabases.add(db);
  await initialize(undefined, null);
  return db;
}

beforeEach(async () => {
  selectWorkspace(null);
  await database.delete();
  await database.open();
});

afterEach(async () => {
  selectWorkspace(null);
  for (const db of openedDatabases) await db.delete();
  openedDatabases.clear();
  await database.delete();
});

describe("Dexie V2 migration and workspace boundaries", () => {
  it("upgrades a genuine V1 database without changing IDs, relationships, allocations, or timer recovery", async () => {
    const name = `stride-v1-upgrade-${crypto.randomUUID()}`;
    const v1 = new Dexie(name);
    v1.version(1).stores({
      subjects: "id,archived,created_at",
      sessions: "id,subject_id,started_at",
      slices: "[session_id+day],session_id,day",
      preferences: "id",
      timers: "id",
      meta: "key",
    });
    await v1.open();
    const olderSession: Session = {
      ...session,
      id: "session-two",
      started_at: "2026-09-20T10:00:00.000Z",
      ended_at: "2026-09-20T10:30:00.000Z",
      duration_seconds: 1800,
      session_title: "Earlier work",
    };
    const olderSlice: Slice = {
      session_id: olderSession.id,
      day: "2026-09-20",
      seconds: 1800,
    };
    await v1.transaction("rw", v1.tables, async () => {
      await v1.table("subjects").put(subject);
      await v1.table("sessions").bulkPut([session, olderSession]);
      await v1.table("slices").bulkPut([...slices, olderSlice]);
      await v1.table("preferences").put({ ...defaults, id: 1 });
      await v1.table("timers").put({ id: 1, value: timer });
      await v1
        .table("meta")
        .put({ key: "initialized", value: "2026-09-22T10:00:00.000Z" });
    });
    v1.close();

    const upgraded = new StrideDatabase(name);
    openedDatabases.add(upgraded);
    await upgraded.open();
    expect(upgraded.verno).toBe(2);
    const staleLegacy = JSON.stringify({
      subjects: [{ ...subject, name: "Stale browser copy" }],
      sessions: [session],
      slices,
      settings: defaults,
      running: null,
    });
    await initialize(upgraded, staleLegacy);
    const original = await readData(upgraded);
    expect(original.subjects).toEqual([subject]);
    expect(original.sessions).toEqual([session, olderSession]);
    expect(original.slices).toEqual(
      expect.arrayContaining([...slices, olderSlice]),
    );
    expect(original.slices).toHaveLength(2);
    expect(original.running).toEqual(timer);
    expect(original.settings).toMatchObject(defaults);
    expect(await upgraded.pendingOperations.count()).toBe(0);

    upgraded.close();
    await upgraded.open();
    await initialize(upgraded, staleLegacy);
    expect(await readData(upgraded)).toEqual(original);
  });

  it("keeps anonymous data available and allows two accounts to reuse the same record IDs", async () => {
    await initialize(undefined, null);
    await saveSubject(subject);
    await saveSession(session, slices);
    expect(await database.pendingOperations.count()).toBe(0);

    const accountA = crypto.randomUUID();
    const accountB = crypto.randomUUID();
    await openAccount(accountA);
    expect((await readData()).subjects).toEqual([]);
    await saveSubject({ ...subject, name: "Account A" });
    await saveSession({ ...session, notes: "Account A notes" }, slices);

    await openAccount(accountB);
    expect((await readData()).subjects).toEqual([]);
    await saveSubject({ ...subject, name: "Account B" });
    await saveSession({ ...session, notes: "Account B notes" }, slices);

    selectWorkspace(accountA);
    expect((await readData()).subjects[0].name).toBe("Account A");
    expect((await readData()).sessions[0].notes).toBe("Account A notes");
    await deleteSession(session.id);
    expect((await readData()).sessions).toEqual([]);
    expect((await readData()).slices).toEqual([]);
    selectWorkspace(accountB);
    expect((await readData()).subjects[0].name).toBe("Account B");
    expect((await readData()).sessions[0].notes).toBe("Account B notes");
    selectWorkspace(null);
    expect((await readData()).subjects).toEqual([subject]);
    expect((await readData()).sessions).toEqual([session]);
    expect((await readData()).slices).toEqual(slices);
  });

  it("never queues anonymous activity or active timer checkpoints", async () => {
    await initialize(undefined, null);
    await saveSubject(subject);
    await saveRunning(timer);
    expect((await readData()).running).toEqual(timer);
    await saveSession(session, slices);
    expect((await readData()).running).toEqual(timer);
    expect(await database.pendingOperations.count()).toBe(0);

    const account = await openAccount();
    await saveSubject(subject);
    const beforeTimer = await account.pendingOperations.count();
    await saveRunning(timer);
    expect((await readData()).running).toEqual(timer);
    await saveRunning(null);
    expect(await account.pendingOperations.count()).toBe(beforeTimer);
  });

  it("restores a version 1 JSON backup into the selected workspace", async () => {
    await initialize(undefined, null);
    await saveSubject({ ...subject, name: "Anonymous work" });
    const account = await openAccount();
    const previousSubject = {
      ...subject,
      id: "account-only",
      name: "Previous account work",
    };
    await saveSubject(previousSubject);
    const backup = parseBackup(
      JSON.stringify({
        format: "stride",
        version: 1,
        exportedAt: "2026-09-22T12:00:00.000Z",
        subjects: [subject],
        sessions: [session],
        slices,
        settings: defaults,
        running: null,
      }),
    );
    await restoreData(backup);
    expect((await readData()).subjects).toEqual([subject]);
    expect((await readData()).sessions).toEqual([session]);
    expect((await readData()).slices).toEqual(slices);
    const copies = await account.recoveryCopies.toArray();
    expect(copies).toHaveLength(1);
    expect(copies[0].reason).toBe("json_restore");
    expect(copies[0].snapshot).toMatchObject({
      subjects: [previousSubject],
      sessions: [],
      slices: [],
    });
    selectWorkspace(null);
    expect((await readData()).subjects[0].name).toBe("Anonymous work");
    expect((await readData()).sessions).toEqual([]);
  });

  it("queues one operation for each changed cloud-linked record, not repeated identical saves", async () => {
    const account = await openAccount();
    await saveSubject(subject);
    expect(await account.pendingOperations.count()).toBe(1);
    await saveSubject(subject);
    expect(await account.pendingOperations.count()).toBe(1);

    await saveSession(session, slices);
    expect(await account.pendingOperations.count()).toBe(2);
    await saveSession(session, slices);
    expect(await account.pendingOperations.count()).toBe(2);
    expect((await readData()).slices).toEqual(slices);
  });

  it("saves a completed account timer and two daily allocations as one session operation", async () => {
    const account = await openAccount();
    await saveSubject(subject);
    const id = "two-day-session";
    const start = new Date(2026, 8, 21, 23, 50).getTime();
    const end = new Date(2026, 8, 22, 0, 10).getTime();
    const segments = [{ start, end }];
    const completedSession: Session = {
      ...session,
      id,
      started_at: new Date(start).toISOString(),
      ended_at: new Date(end).toISOString(),
      duration_seconds: (end - start) / 1000,
    };
    const dailySlices = splitSegments(id, segments);
    expect(dailySlices).toHaveLength(2);
    await saveRunning({
      ...timer,
      id,
      startedAt: completedSession.started_at,
      segments,
    });
    const before = await account.pendingOperations.count();

    await saveSession(completedSession, dailySlices);

    const data = await readData();
    expect(data.running).toBeNull();
    expect(data.sessions).toEqual([completedSession]);
    expect(data.slices).toEqual(dailySlices);
    expect(data.slices.reduce((sum, slice) => sum + slice.seconds, 0)).toBe(
      completedSession.duration_seconds,
    );
    expect(await account.pendingOperations.count()).toBe(before + 1);
    expect(
      (await account.pendingOperations.toArray()).filter(
        (operation) => operation.entity === "session",
      ),
    ).toHaveLength(1);
  });

  it("keeps an in-flight operation immutable when the same subject changes again", async () => {
    const account = await openAccount();
    await saveSubject(subject);
    const [inFlight] = await account.pendingOperations.toArray();
    expect(inFlight.sequence).toBeDefined();
    expect(
      await account.pendingOperations.update(inFlight.sequence!, {
        status: "in_flight",
      }),
    ).toBe(1);

    const edited = { ...subject, name: "Revised Mathematics" };
    await saveSubject(edited);
    const operations = await account.pendingOperations.toArray();
    expect(operations).toHaveLength(2);
    const original = operations.find(
      (operation) => operation.id === inFlight.id,
    );
    const pending = operations.find(
      (operation) => operation.status === "pending",
    );
    expect(original?.status).toBe("in_flight");
    expect(original?.payload).toEqual(subject);
    expect(pending?.id).not.toBe(inFlight.id);
    expect(pending?.payload).toEqual(edited);

    await saveSubject(edited);
    expect(await account.pendingOperations.count()).toBe(2);
    expect((await readData()).subjects).toEqual([edited]);
  });

  it("rolls back session, allocations, and operation together when a transaction fails", async () => {
    const account = await openAccount();
    await saveSubject(subject);
    const beforeOperations = await account.pendingOperations.count();
    const fail = () => {
      throw new Error("Injected transaction failure");
    };

    account.slices.hook("creating", fail);
    try {
      await expect(saveSession(session, slices)).rejects.toThrow(
        "Injected transaction failure",
      );
    } finally {
      account.slices.hook("creating").unsubscribe(fail);
    }
    expect((await readData()).sessions).toEqual([]);
    expect((await readData()).slices).toEqual([]);
    expect(await account.pendingOperations.count()).toBe(beforeOperations);

    account.pendingOperations.hook("creating", fail);
    try {
      await expect(saveSession(session, slices)).rejects.toThrow(
        "Injected transaction failure",
      );
    } finally {
      account.pendingOperations.hook("creating").unsubscribe(fail);
    }
    expect((await readData()).sessions).toEqual([]);
    expect((await readData()).slices).toEqual([]);
    expect(await account.pendingOperations.count()).toBe(beforeOperations);

    await saveSession(session, slices);
    const data = await readData();
    expect(data.sessions).toEqual([session]);
    expect(data.slices).toEqual(slices);
    expect(data.slices.reduce((sum, slice) => sum + slice.seconds, 0)).toBe(
      session.duration_seconds,
    );
    expect(await account.pendingOperations.count()).toBe(beforeOperations + 1);
  });
});
