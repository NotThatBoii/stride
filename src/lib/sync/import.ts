import { defaults, type Data, type Slice } from "../../models";
import {
  database,
  enqueueOperation,
  initialize,
  readData,
  type StrideDatabase,
} from "../local-database";
import { validateData } from "../validation";
import {
  assertAccountDatabase,
  preserveConflict,
  readLocalVersion,
  restoreImportedTimer,
  versionsEqual,
} from "./conflicts";
import { sharedSettings } from "./normalization";
import { activeSegments } from "../timer";
import type { SyncGuard, SyncVersion } from "./types";

export type ImportKind = "legacy" | "backup";
export interface ImportResult {
  subjects: number;
  sessions: number;
  deduplicated: number;
  conflicts: number;
}
export interface ImportStage {
  id: string;
  kind: ImportKind;
  status: "staged" | "complete";
  created_at: string;
  completed_at?: string;
  source: Data;
  result?: ImportResult;
}

const stageKey = (kind: ImportKind) => `import_stage:${kind}`;

export async function getLegacyHistory(): Promise<Data | null> {
  await initialize(database);
  const data = await readData(database);
  return data.subjects.length || data.sessions.length || data.running
    ? data
    : null;
}

export async function getImportState(
  db: StrideDatabase,
  kind: ImportKind = "legacy",
): Promise<ImportStage | null> {
  await assertAccountDatabase(db);
  const saved = await db.syncMetadata.get(stageKey(kind));
  if (!saved) return null;
  try {
    const stage = JSON.parse(saved.value) as ImportStage;
    if (
      stage.kind !== kind ||
      typeof stage.id !== "string" ||
      !["staged", "complete"].includes(stage.status)
    )
      throw new Error("Invalid import stage.");
    return { ...stage, source: validateData(stage.source) };
  } catch {
    throw new Error(
      "The saved import could not be read. Its backup remains stored on this device.",
    );
  }
}

export async function deferLegacyImport(
  db: StrideDatabase,
  guard: SyncGuard = () => {},
): Promise<void> {
  await db.transaction("rw", db.syncMetadata, async () => {
    guard();
    await assertAccountDatabase(db);
    await db.syncMetadata.put({
      key: "legacy_import_deferred",
      value: new Date().toISOString(),
    });
    guard();
  });
}

export async function shouldOfferLegacyImport(
  db: StrideDatabase,
): Promise<boolean> {
  await assertAccountDatabase(db);
  if (
    (await db.syncMetadata.get("legacy_import_handled")) ||
    (await db.syncMetadata.get("legacy_import_deferred"))
  )
    return false;
  return !!(await getLegacyHistory());
}

function sameSource(a: Data, b: Data): boolean {
  // Staging identity is exact, while record reconciliation compares normalized instants.
  return JSON.stringify(a) === JSON.stringify(b);
}

/** Creates an immutable, recoverable snapshot before touching any account study record. */
export async function stageImport(
  db: StrideDatabase,
  value: unknown,
  kind: ImportKind = "legacy",
  guard: SyncGuard = () => {},
): Promise<ImportStage> {
  const source = validateData(value);
  await assertAccountDatabase(db);
  return db.transaction("rw", db.syncMetadata, db.recoveryCopies, async () => {
    guard();
    const existing = await getImportState(db, kind);
    if (existing && sameSource(existing.source, source)) return existing;
    // Selecting another source replaces only the review pointer. Every staged
    // source already has its own immutable recovery copy, so Cancel can remain
    // non-destructive without forcing an unwanted import later.
    const stage: ImportStage = {
      id: crypto.randomUUID(),
      kind,
      status: "staged",
      source,
      created_at: new Date().toISOString(),
    };
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "json_restore",
      entity: null,
      record_id: null,
      snapshot: { ...source, import_id: stage.id, import_kind: kind },
      created_at: stage.created_at,
    });
    await db.syncMetadata.put({
      key: stageKey(kind),
      value: JSON.stringify(stage),
    });
    guard();
    return stage;
  });
}

function subjectTree(data: Data, subjectId: string): Data {
  const sessions = data.sessions.filter(
    (session) => session.subject_id === subjectId,
  );
  const ids = new Set(sessions.map((session) => session.id));
  return {
    subjects: data.subjects.filter((subject) => subject.id === subjectId),
    sessions,
    slices: data.slices.filter((slice) => ids.has(slice.session_id)),
    settings: data.settings,
    running: data.running?.subjectId === subjectId ? data.running : null,
  };
}

async function stageCollision(
  db: StrideDatabase,
  stage: ImportStage,
  entity: "subject" | "session" | "settings",
  recordId: string,
  incoming: SyncVersion,
  local: SyncVersion,
  result: ImportResult,
): Promise<void> {
  const revision = await db.recordRevisions.get([entity, recordId]);
  await preserveConflict(db, {
    entity,
    record_id: recordId,
    local_snapshot: local,
    remote_snapshot: incoming,
    base_revision: revision?.server_revision ?? null,
    remote_revision: revision?.server_revision ?? null,
    source: stage.kind,
    kind: "import",
    context: {
      import_id: stage.id,
      ...(entity === "subject"
        ? { incoming_tree: subjectTree(pausedStageData(stage), recordId) }
        : {}),
    },
  });
  result.conflicts++;
}

function pausedStageData(stage: ImportStage): Data {
  return {
    ...stage.source,
    running: stage.source.running
      ? {
          ...stage.source.running,
          segments: activeSegments(
            stage.source.running,
            Date.parse(stage.created_at),
          ),
          runningSince: null,
        }
      : null,
  };
}

/** Call after the worker reconciles cloud history, under its exclusive account lock. */
export async function commitImport(
  db: StrideDatabase,
  stageId: string,
  guard: SyncGuard = () => {},
): Promise<ImportResult> {
  return db.transaction("rw", db.tables, async () => {
    guard();
    await assertAccountDatabase(db);
    const stages = await Promise.all([
      getImportState(db, "legacy"),
      getImportState(db, "backup"),
    ]);
    const stage = stages.find((item) => item?.id === stageId);
    if (!stage)
      throw new Error("The staged import was not found in this account.");
    if (stage.status === "complete") return stage.result!;
    const result: ImportResult = {
      subjects: 0,
      sessions: 0,
      deduplicated: 0,
      conflicts: 0,
    };
    const blockedParents = new Set<string>();
    const source = stage.source;
    // IDs, never names, determine whether records may refer to the same subject.
    for (const subject of source.subjects) {
      const local = await readLocalVersion(db, "subject", subject.id);
      const incoming: SyncVersion = { action: "upsert", payload: subject };
      const revision = await db.recordRevisions.get(["subject", subject.id]);
      const pending = await db.pendingOperations
        .where("[entity+record_id]")
        .equals(["subject", subject.id])
        .count();
      if (local.action === "delete" && !revision && !pending) {
        await db.subjects.put(subject);
        await enqueueOperation(db, "subject", subject.id, "upsert", subject);
        result.subjects++;
      } else if (versionsEqual("subject", local, incoming))
        result.deduplicated++;
      else {
        blockedParents.add(subject.id);
        await stageCollision(
          db,
          stage,
          "subject",
          subject.id,
          incoming,
          local,
          result,
        );
      }
    }
    const allocations = new Map<string, Slice[]>();
    for (const slice of source.slices) {
      const existing = allocations.get(slice.session_id) ?? [];
      existing.push(slice);
      allocations.set(slice.session_id, existing);
    }
    for (const session of source.sessions) {
      if (blockedParents.has(session.subject_id)) continue;
      const slices = (allocations.get(session.id) ?? []).sort((a, b) =>
        a.day.localeCompare(b.day),
      );
      const payload = { session, slices };
      const incoming: SyncVersion = { action: "upsert", payload };
      const local = await readLocalVersion(db, "session", session.id);
      const revision = await db.recordRevisions.get(["session", session.id]);
      const pending = await db.pendingOperations
        .where("[entity+record_id]")
        .equals(["session", session.id])
        .count();
      if (local.action === "delete" && !revision && !pending) {
        await db.sessions.put(session);
        await db.slices.bulkPut(slices);
        await enqueueOperation(db, "session", session.id, "upsert", payload);
        result.sessions++;
      } else if (versionsEqual("session", local, incoming))
        result.deduplicated++;
      else
        await stageCollision(
          db,
          stage,
          "session",
          session.id,
          incoming,
          local,
          result,
        );
    }
    const localSettings = await readLocalVersion(db, "settings", "settings");
    const incomingSettings: SyncVersion = {
      action: "upsert",
      payload: sharedSettings(source.settings),
    };
    if (!versionsEqual("settings", localSettings, incomingSettings)) {
      const hasVersion = await db.recordRevisions.get(["settings", "settings"]);
      const hasPending = await db.pendingOperations
        .where("[entity+record_id]")
        .equals(["settings", "settings"])
        .count();
      if (
        !hasVersion &&
        !hasPending &&
        versionsEqual("settings", localSettings, {
          action: "upsert",
          payload: defaults,
        })
      ) {
        const current = (await db.preferences.get(1)) ?? { ...defaults };
        const settings = { ...current, ...sharedSettings(source.settings) };
        await db.preferences.put({ ...settings, id: 1 });
        await enqueueOperation(db, "settings", "settings", "upsert", settings);
      } else
        await stageCollision(
          db,
          stage,
          "settings",
          "settings",
          incomingSettings,
          localSettings,
          result,
        );
    }
    const paused = pausedStageData(stage).running;
    if (paused && !blockedParents.has(paused.subjectId))
      await restoreImportedTimer(db, paused);
    const completed: ImportStage = {
      ...stage,
      status: "complete",
      completed_at: new Date().toISOString(),
      result,
    };
    await db.syncMetadata.put({
      key: stageKey(stage.kind),
      value: JSON.stringify(completed),
    });
    if (stage.kind === "legacy") {
      await db.syncMetadata.put({
        key: "legacy_import_handled",
        value: completed.completed_at!,
      });
      await db.syncMetadata.delete("legacy_import_deferred");
    }
    guard();
    return result;
  });
}

/** Version-1 export remains usable independently of cloud synchronization. */
export function importBackup(stage: ImportStage): string {
  return JSON.stringify(
    {
      format: "stride",
      version: 1,
      exportedAt: stage.created_at,
      ...stage.source,
    },
    null,
    2,
  );
}

// These aliases make the explicit legacy flow discoverable without a second import engine.
export async function stageLegacyImport(
  db: StrideDatabase,
): Promise<ImportStage | null> {
  const data = await getLegacyHistory();
  return data ? stageImport(db, data, "legacy") : null;
}
