import Dexie, { type Table } from "dexie";
import {
  defaults,
  type Data,
  type Running,
  type Session,
  type Settings,
  type Slice,
  type Subject,
} from "../models";
import { validateData } from "./validation";
export class StrideDatabase extends Dexie {
  subjects!: Table<Subject, string>;
  sessions!: Table<Session, string>;
  slices!: Table<Slice, [string, string]>;
  preferences!: Table<Settings & { id: number }, number>;
  timers!: Table<{ id: number; value: Running }, number>;
  meta!: Table<{ key: string; value: string }, string>;
  constructor(name = "stride") {
    super(name);
    this.version(1).stores({
      subjects: "id,archived,created_at",
      sessions: "id,subject_id,started_at",
      slices: "[session_id+day],session_id,day",
      preferences: "id",
      timers: "id",
      meta: "key",
    });
  }
}
export const database = new StrideDatabase();
export async function initialize(
  db = database,
  legacy = localStorage.getItem("stride-browser-preview-v1"),
) {
  // Records and migration marker commit together; retain the original backup.
  await db.transaction("rw", db.tables, async () => {
    if (await db.meta.get("initialized")) return;
    const data = legacy ? validateData(JSON.parse(legacy)) : null;
    if (data) {
      await db.subjects.bulkPut(data.subjects);
      await db.sessions.bulkPut(data.sessions);
      await db.slices.bulkPut(data.slices);
      if (data.running) await db.timers.put({ id: 1, value: data.running });
    }
    await db.preferences.put({ ...(data?.settings ?? defaults), id: 1 });
    await db.meta.put({ key: "initialized", value: new Date().toISOString() });
  });
}
export async function readData(db = database): Promise<Data> {
  return db.transaction("r", db.tables, async () => ({
    subjects: await db.subjects.orderBy("created_at").toArray(),
    sessions: await db.sessions.orderBy("started_at").reverse().toArray(),
    slices: await db.slices.toArray(),
    settings: (await db.preferences.get(1)) ?? { ...defaults },
    running: (await db.timers.get(1))?.value ?? null,
  }));
}
export async function saveSubject(s: Subject) {
  await database.subjects.put(s);
}
export async function deleteSubject(id: string) {
  await database.transaction(
    "rw",
    database.subjects,
    database.sessions,
    database.slices,
    database.timers,
    async () => {
      if ((await database.timers.get(1))?.value.subjectId === id)
        throw new Error(
          "Finish the active session before deleting its subject.",
        );
      const ids = await database.sessions
        .where("subject_id")
        .equals(id)
        .primaryKeys();
      await database.slices.where("session_id").anyOf(ids).delete();
      await database.sessions.bulkDelete(ids);
      await database.subjects.delete(id);
    },
  );
}
export async function saveSession(s: Session, slices: Slice[]) {
  await database.transaction(
    "rw",
    database.subjects,
    database.sessions,
    database.slices,
    database.timers,
    async () => {
      if (!(await database.subjects.get(s.subject_id)))
        throw new Error("This subject no longer exists.");
      await database.sessions.put(s);
      await database.slices.where("session_id").equals(s.id).delete();
      await database.slices.bulkPut(slices);
      if ((await database.timers.get(1))?.value.id === s.id)
        await database.timers.delete(1);
    },
  );
}
export async function deleteSession(id: string) {
  await database.transaction(
    "rw",
    database.sessions,
    database.slices,
    async () => {
      await database.slices.where("session_id").equals(id).delete();
      await database.sessions.delete(id);
    },
  );
}
export async function saveSettings(s: Settings) {
  await database.preferences.put({ ...s, id: 1 });
}
export async function saveRunning(r: Running | null) {
  await database.transaction(
    "rw",
    database.timers,
    database.sessions,
    database.subjects,
    async () => {
      if (!r) {
        await database.timers.delete(1);
        return;
      }
      const current = (await database.timers.get(1))?.value;
      if (current && current.id !== r.id)
        throw new Error("Another session is already running.");
      if (await database.sessions.get(r.id))
        throw new Error("This session has already been saved.");
      const subject = await database.subjects.get(r.subjectId);
      if (!subject || subject.archived)
        throw new Error("Choose an active subject.");
      await database.timers.put({ id: 1, value: r });
    },
  );
}
export async function restoreData(value: unknown, db = database) {
  const data = validateData(value);
  await db.transaction("rw", db.tables, async () => {
    if (await db.timers.get(1))
      throw new Error(
        "Finish or discard your current session before importing.",
      );
    await db.subjects.clear();
    await db.sessions.clear();
    await db.slices.clear();
    await db.timers.clear();
    await db.subjects.bulkPut(data.subjects);
    await db.sessions.bulkPut(data.sessions);
    await db.slices.bulkPut(data.slices);
    await db.preferences.put({ ...data.settings, id: 1 });
    if (data.running) await db.timers.put({ id: 1, value: data.running });
    await db.meta.put({ key: "initialized", value: new Date().toISOString() });
  });
}
