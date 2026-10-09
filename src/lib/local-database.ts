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
import { activeSegments, assertTimerOrder } from "./timer";
import type { WireOperation } from "./sync/types";

export type SyncEntity = "subject" | "session" | "settings";
export type SyncPayload =
  | Subject
  | { session: Session; slices: Slice[] }
  | Settings
  | null;

export interface PendingOperation {
  sequence?: number;
  id: string;
  entity: SyncEntity;
  record_id: string;
  action: "upsert" | "delete";
  payload: SyncPayload;
  base_revision: string | null;
  status: "pending" | "in_flight";
  created_at: string;
  updated_at: string;
  // Frozen at the first dispatch. Retries must send this exact request.
  wire_request?: WireOperation;
}

export interface RecordRevision {
  entity: SyncEntity;
  record_id: string;
  server_revision: string;
  updated_at: string;
  deleted?: boolean;
}

export interface SyncCursor {
  stream: string;
  cursor: string;
  updated_at: string;
}

export interface SyncConflict {
  id: string;
  entity: SyncEntity;
  record_id: string;
  local_snapshot: unknown;
  remote_snapshot: unknown;
  base_revision: string | null;
  remote_revision: string | null;
  created_at: string;
  resolved_at: string | null;
  kind?: "concurrent_edit" | "parent_deleted" | "import";
  source?: "push" | "pull" | "legacy" | "backup";
  context?: {
    local_tree?: Data;
    incoming_tree?: Data;
    import_id?: string;
    recovered_local?: boolean;
  };
}

export interface RecoveryCopy {
  id: string;
  reason:
    | "json_restore"
    | "conflict"
    | "remote_apply"
    | "local_delete"
    | "timer_discard"
    | "operation_repair";
  entity: SyncEntity | null;
  record_id: string | null;
  snapshot: unknown;
  created_at: string;
}

export interface SyncMetadata {
  key: string;
  value: string;
}

export class StrideDatabase extends Dexie {
  subjects!: Table<Subject, string>;
  sessions!: Table<Session, string>;
  slices!: Table<Slice, [string, string]>;
  preferences!: Table<Settings & { id: number }, number>;
  timers!: Table<{ id: number; value: Running }, number>;
  meta!: Table<{ key: string; value: string }, string>;
  pendingOperations!: Table<PendingOperation, number>;
  recordRevisions!: Table<RecordRevision, [SyncEntity, string]>;
  syncCursors!: Table<SyncCursor, string>;
  conflicts!: Table<SyncConflict, string>;
  recoveryCopies!: Table<RecoveryCopy, string>;
  syncMetadata!: Table<SyncMetadata, string>;

  constructor(
    name = "stride",
    readonly accountId: string | null = null,
  ) {
    super(name);
    this.version(1).stores({
      subjects: "id,archived,created_at",
      sessions: "id,subject_id,started_at",
      slices: "[session_id+day],session_id,day",
      preferences: "id",
      timers: "id",
      meta: "key",
    });
    // Existing V1 stores and keys are unchanged. IndexedDB adds only sidecars.
    this.version(2).stores({
      subjects: "id,archived,created_at",
      sessions: "id,subject_id,started_at",
      slices: "[session_id+day],session_id,day",
      preferences: "id",
      timers: "id",
      meta: "key",
      pendingOperations: "++sequence,&id,[entity+record_id],status,created_at",
      recordRevisions: "[entity+record_id],entity,record_id",
      syncCursors: "stream",
      conflicts: "id,[entity+record_id],created_at,resolved_at",
      recoveryCopies: "id,[entity+record_id],created_at",
      syncMetadata: "key",
    });
  }
}

// The original database remains the anonymous workspace permanently.
export const database = new StrideDatabase();
const accountDatabases = new Map<string, StrideDatabase>();
export interface WorkspaceSelection {
  kind: "anonymous" | "account";
  accountId: string | null;
  generation: number;
}
let activeDatabase = database;
let selection: WorkspaceSelection = {
  kind: "anonymous",
  accountId: null,
  generation: 0,
};
const workspaceListeners = new Set<() => void>();
const accountIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function getActiveWorkspace(): WorkspaceSelection {
  return selection;
}

export function getActiveDatabase(): StrideDatabase {
  return activeDatabase;
}

export function subscribeWorkspace(listener: () => void): () => void {
  workspaceListeners.add(listener);
  return () => workspaceListeners.delete(listener);
}

export function selectWorkspace(accountId: string | null): void {
  const nextId = accountId?.toLowerCase() ?? null;
  if (nextId !== null && !accountIdPattern.test(nextId))
    throw new Error("A workspace requires an account UUID.");
  if (nextId === selection.accountId) return;
  if (nextId === null) {
    activeDatabase = database;
  } else {
    let next = accountDatabases.get(nextId);
    if (!next) {
      next = new StrideDatabase(`stride-account-${nextId}`, nextId);
      accountDatabases.set(nextId, next);
    }
    activeDatabase = next;
  }
  selection = {
    kind: nextId === null ? "anonymous" : "account",
    accountId: nextId,
    generation: selection.generation + 1,
  };
  workspaceListeners.forEach((listener) => listener());
}

export async function initialize(
  db = activeDatabase,
  legacy?: string | null,
): Promise<void> {
  const source =
    legacy === undefined && db === database
      ? localStorage.getItem("stride-browser-preview-v1")
      : (legacy ?? null);
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.preferences,
      db.timers,
      db.meta,
      db.syncMetadata,
    ],
    async () => {
      if (db.accountId) {
        const owner = await db.syncMetadata.get("owner_account_id");
        if (owner && owner.value !== db.accountId)
          throw new Error("Workspace owner does not match this account.");
        if (!owner)
          await db.syncMetadata.put({
            key: "owner_account_id",
            value: db.accountId,
          });
      }
      if (await db.meta.get("initialized")) return;
      const data = source ? validateData(JSON.parse(source)) : null;
      if (data) {
        await db.subjects.bulkPut(data.subjects);
        await db.sessions.bulkPut(data.sessions);
        await db.slices.bulkPut(data.slices);
        if (data.running) await db.timers.put({ id: 1, value: data.running });
      }
      await db.preferences.put({ ...(data?.settings ?? defaults), id: 1 });
      await db.meta.put({
        key: "initialized",
        value: new Date().toISOString(),
      });
    },
  );
}

export async function readData(db = activeDatabase): Promise<Data> {
  return db.transaction(
    "r",
    db.subjects,
    db.sessions,
    db.slices,
    db.preferences,
    db.timers,
    async () => ({
      subjects: await db.subjects.orderBy("created_at").toArray(),
      sessions: await db.sessions.orderBy("started_at").reverse().toArray(),
      slices: await db.slices.toArray(),
      settings: (await db.preferences.get(1)) ?? { ...defaults },
      running: (await db.timers.get(1))?.value ?? null,
    }),
  );
}

function same(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function sortedSlices(slices: Slice[]): Slice[] {
  return [...slices].sort((a, b) => a.day.localeCompare(b.day));
}

export interface EditSnapshot {
  entity: "subject" | "session";
  recordId: string;
  payload: Subject | { session: Session; slices: Slice[] };
  revision: string | null;
  workspaceGeneration: number;
}

const staleDraftMessage =
  "This record changed on another device or window. Your draft is still here. Copy any edits you want to keep, close this editor, and reopen the latest version.";

async function editPayload(
  db: StrideDatabase,
  entity: EditSnapshot["entity"],
  id: string,
) {
  if (entity === "subject") return db.subjects.get(id);
  const session = await db.sessions.get(id);
  return session
    ? {
        session,
        slices: sortedSlices(
          await db.slices.where("session_id").equals(id).toArray(),
        ),
      }
    : undefined;
}

function normalizeEditPayload(payload: EditSnapshot["payload"]) {
  return "session" in payload
    ? { session: payload.session, slices: sortedSlices(payload.slices) }
    : payload;
}

// Capture the displayed record and revision together. Never attach the latest
// revision to a draft whose fields came from an older record.
export async function captureEditSnapshot(
  entity: EditSnapshot["entity"],
  recordId: string,
  displayed: EditSnapshot["payload"],
): Promise<EditSnapshot> {
  const db = activeDatabase,
    workspaceGeneration = selection.generation;
  return db.transaction(
    "r",
    [db.subjects, db.sessions, db.slices, db.recordRevisions],
    async () => {
      const payload = await editPayload(db, entity, recordId);
      const revision =
        (await db.recordRevisions.get([entity, recordId]))?.server_revision ??
        null;
      if (
        selection.generation !== workspaceGeneration ||
        !payload ||
        !same(payload, normalizeEditPayload(displayed))
      )
        throw new Error(staleDraftMessage);
      return { entity, recordId, payload, revision, workspaceGeneration };
    },
  );
}

async function assertEditSnapshot(
  db: StrideDatabase,
  entity: EditSnapshot["entity"],
  id: string,
  expected?: EditSnapshot,
) {
  if (!expected) return;
  const payload = await editPayload(db, entity, id);
  const revision =
    (await db.recordRevisions.get([entity, id]))?.server_revision ?? null;
  if (
    expected.entity !== entity ||
    expected.recordId !== id ||
    expected.workspaceGeneration !== selection.generation ||
    !same(payload, expected.payload) ||
    revision !== expected.revision
  )
    throw new Error(staleDraftMessage);
}

export async function enqueueOperation(
  db: StrideDatabase,
  entity: SyncEntity,
  recordId: string,
  action: PendingOperation["action"],
  payload: SyncPayload,
  baseRevisionOverride?: string | null,
): Promise<void> {
  if (!db.accountId) return;
  const pending = await db.pendingOperations
    .where("[entity+record_id]")
    .equals([entity, recordId])
    .filter(
      (operation) => operation.status === "pending" && !operation.wire_request,
    )
    .first();
  const now = new Date().toISOString();
  if (pending) {
    await db.pendingOperations.put({
      ...pending,
      action,
      payload,
      updated_at: now,
    });
    return;
  }
  const revision = await db.recordRevisions.get([entity, recordId]);
  await db.pendingOperations.add({
    id: crypto.randomUUID(),
    entity,
    record_id: recordId,
    action,
    payload,
    base_revision:
      baseRevisionOverride === undefined
        ? (revision?.server_revision ?? null)
        : baseRevisionOverride,
    status: "pending",
    created_at: now,
    updated_at: now,
  });
}

const enqueue = enqueueOperation;

function sharedSettings(settings: Settings) {
  return {
    minimum: settings.minimum,
    goal: settings.goal,
    presets: settings.presets.split(",").map(Number).join(","),
    weekStart: settings.weekStart,
  };
}

export async function saveSubject(
  subject: Subject,
  expected?: EditSnapshot,
): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    db.subjects,
    db.pendingOperations,
    db.recordRevisions,
    async () => {
      await assertEditSnapshot(db, "subject", subject.id, expected);
      if (same(await db.subjects.get(subject.id), subject)) return;
      await db.subjects.put(subject);
      await enqueue(db, "subject", subject.id, "upsert", subject);
    },
  );
}

export async function deleteSubject(
  id: string,
  expected?: EditSnapshot,
): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.timers,
      db.pendingOperations,
      db.recordRevisions,
      db.recoveryCopies,
      db.preferences,
    ],
    async () => {
      await assertEditSnapshot(db, "subject", id, expected);
      if ((await db.timers.get(1))?.value.subjectId === id)
        throw new Error(
          "Finish the active session before deleting its subject.",
        );
      if (!(await db.subjects.get(id))) return;
      const sessions = await db.sessions
        .where("subject_id")
        .equals(id)
        .toArray();
      const ids = sessions.map((session) => session.id);
      if (db.accountId) {
        const parent = await db.subjects.get(id);
        await db.recoveryCopies.add({
          id: crypto.randomUUID(),
          reason: "conflict",
          entity: "subject",
          record_id: id,
          snapshot: {
            subjects: parent ? [parent] : [],
            sessions,
            slices: ids.length
              ? await db.slices.where("session_id").anyOf(ids).toArray()
              : [],
            settings: (await db.preferences.get(1)) ?? { ...defaults },
            running: null,
          } satisfies Data,
          created_at: new Date().toISOString(),
        });
      }
      if (ids.length) {
        await db.slices.where("session_id").anyOf(ids).delete();
        await db.sessions.bulkDelete(ids);
      }
      await db.subjects.delete(id);
      for (const session of sessions)
        await enqueue(db, "session", session.id, "delete", null);
      await enqueue(db, "subject", id, "delete", null);
    },
  );
}

export async function saveSession(
  session: Session,
  slices: Slice[],
  expected?: EditSnapshot,
): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.timers,
      db.pendingOperations,
      db.recordRevisions,
    ],
    async () => {
      await assertEditSnapshot(db, "session", session.id, expected);
      const subject = await db.subjects.get(session.subject_id);
      if (!subject) throw new Error("This subject no longer exists.");
      validateData({
        subjects: [subject],
        sessions: [session],
        slices,
        settings: defaults,
        running: null,
      });
      const previous = await db.sessions.get(session.id);
      const oldSlices = await db.slices
        .where("session_id")
        .equals(session.id)
        .toArray();
      const changed =
        !same(previous, session) ||
        !same(sortedSlices(oldSlices), sortedSlices(slices));
      if (changed) {
        await db.sessions.put(session);
        await db.slices.where("session_id").equals(session.id).delete();
        await db.slices.bulkPut(slices);
        await enqueue(db, "session", session.id, "upsert", {
          session,
          slices: sortedSlices(slices),
        });
      }
      if ((await db.timers.get(1))?.value.id === session.id)
        await db.timers.delete(1);
    },
  );
}

export async function deleteSession(id: string): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.preferences,
      db.recoveryCopies,
      db.pendingOperations,
      db.recordRevisions,
    ],
    async () => {
      const session = await db.sessions.get(id);
      if (!session) return;
      const subject = await db.subjects.get(session.subject_id);
      await db.recoveryCopies.add({
        id: crypto.randomUUID(),
        reason: "local_delete",
        entity: "session",
        record_id: id,
        snapshot: {
          subjects: subject ? [subject] : [],
          sessions: [session],
          slices: await db.slices.where("session_id").equals(id).toArray(),
          settings: (await db.preferences.get(1)) ?? { ...defaults },
          running: null,
        } satisfies Data,
        created_at: new Date().toISOString(),
      });
      await db.slices.where("session_id").equals(id).delete();
      await db.sessions.delete(id);
      await enqueue(db, "session", id, "delete", null);
    },
  );
}

export async function saveSettings(settings: Settings): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    db.preferences,
    db.pendingOperations,
    db.recordRevisions,
    async () => {
      const previous = await db.preferences.get(1);
      if (same(previous && { ...previous, id: undefined }, settings)) return;
      await db.preferences.put({ ...settings, id: 1 });
      if (
        !previous ||
        !same(sharedSettings(previous), sharedSettings(settings))
      )
        await enqueue(db, "settings", "settings", "upsert", settings);
    },
  );
}

export async function saveRunning(running: Running | null): Promise<void> {
  const db = activeDatabase;
  await db.transaction(
    "rw",
    [db.timers, db.sessions, db.subjects, db.preferences, db.recoveryCopies],
    async () => {
      if (!running) {
        const discarded = (await db.timers.get(1))?.value;
        if (discarded) {
          const now = new Date().toISOString();
          const subject = await db.subjects.get(discarded.subjectId);
          await db.recoveryCopies.add({
            id: crypto.randomUUID(),
            reason: "timer_discard",
            entity: "session",
            record_id: discarded.id,
            snapshot: {
              subjects: subject ? [subject] : [],
              sessions: [],
              slices: [],
              settings: (await db.preferences.get(1)) ?? { ...defaults },
              running: {
                ...discarded,
                segments: activeSegments(discarded, Date.parse(now)),
                runningSince: null,
              },
              discarded_timer: discarded,
            },
            created_at: now,
          });
        }
        await db.timers.delete(1);
        return;
      }
      const current = (await db.timers.get(1))?.value;
      if (current && current.id !== running.id)
        throw new Error("Another session is already running.");
      if (await db.sessions.get(running.id))
        throw new Error("This session has already been saved.");
      const subject = await db.subjects.get(running.subjectId);
      if (
        !subject ||
        (subject.archived &&
          !(
            current?.id === running.id &&
            current.subjectId === running.subjectId
          ))
      )
        throw new Error("Choose an active subject.");
      assertTimerOrder(running);
      await db.timers.put({ id: 1, value: running });
    },
  );
}

export async function restoreData(
  value: unknown,
  db = activeDatabase,
): Promise<void> {
  if (db.accountId)
    throw new Error(
      "Account history must use the reviewed, additive import flow. Existing history was preserved.",
    );
  const data = validateData(value);
  await db.transaction(
    "rw",
    [
      db.subjects,
      db.sessions,
      db.slices,
      db.preferences,
      db.timers,
      db.meta,
      db.pendingOperations,
      db.recordRevisions,
      db.recoveryCopies,
    ],
    async () => {
      if (await db.timers.get(1))
        throw new Error(
          "Finish or discard your current session before importing.",
        );
      const previous: Data = {
        subjects: await db.subjects.toArray(),
        sessions: await db.sessions.toArray(),
        slices: await db.slices.toArray(),
        settings: (await db.preferences.get(1)) ?? { ...defaults },
        running: null,
      };
      if (
        previous.subjects.length ||
        previous.sessions.length ||
        previous.slices.length ||
        !same(previous.settings, data.settings)
      )
        await db.recoveryCopies.add({
          id: crypto.randomUUID(),
          reason: "json_restore",
          entity: null,
          record_id: null,
          snapshot: previous,
          created_at: new Date().toISOString(),
        });
      await db.subjects.clear();
      await db.sessions.clear();
      await db.slices.clear();
      await db.timers.clear();
      await db.subjects.bulkPut(data.subjects);
      await db.sessions.bulkPut(data.sessions);
      await db.slices.bulkPut(data.slices);
      await db.preferences.put({ ...data.settings, id: 1 });
      if (data.running) await db.timers.put({ id: 1, value: data.running });
      await db.meta.put({
        key: "initialized",
        value: new Date().toISOString(),
      });
    },
  );
}
