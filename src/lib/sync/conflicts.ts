import {
  defaults,
  type Data,
  type Settings,
  type Subject,
  type Session,
  type Slice,
  type Running,
} from "../../models";
import {
  enqueueOperation,
  type StrideDatabase,
  type SyncConflict,
  type SyncEntity,
  type SyncPayload,
  type PendingOperation,
} from "../local-database";
import {
  compareRevision,
  equivalentPayload,
  normalizePayload,
} from "./normalization";
import type { SyncGuard, SyncVersion } from "./types";
import { operationErrorKey, parseOperationFailure } from "./failures";

export type ConflictChoice = "local" | "remote" | "both";
export interface ConflictInput {
  entity: SyncEntity;
  record_id: string;
  local_snapshot: SyncVersion;
  remote_snapshot: SyncVersion;
  base_revision: string | null;
  remote_revision: string | null;
  kind?: SyncConflict["kind"];
  source?: SyncConflict["source"];
  context?: SyncConflict["context"];
}

export async function assertAccountDatabase(db: StrideDatabase): Promise<void> {
  if (!db.accountId)
    throw new Error("Synchronization requires an account workspace.");
  const owner = await db.syncMetadata.get("owner_account_id");
  if (owner?.value !== db.accountId)
    throw new Error("The workspace does not belong to this account.");
}

export async function readLocalVersion(
  db: StrideDatabase,
  entity: SyncEntity,
  recordId: string,
): Promise<SyncVersion> {
  if (entity === "subject") {
    const subject = await db.subjects.get(recordId);
    return subject
      ? { action: "upsert", payload: subject }
      : { action: "delete", payload: null };
  }
  if (entity === "session") {
    const session = await db.sessions.get(recordId);
    return session
      ? {
          action: "upsert",
          payload: {
            session,
            slices: await db.slices
              .where("session_id")
              .equals(recordId)
              .sortBy("day"),
          },
        }
      : { action: "delete", payload: null };
  }
  const settings = await db.preferences.get(1);
  return { action: "upsert", payload: settings ?? { ...defaults } };
}

export function versionsEqual(
  entity: SyncEntity,
  a: SyncVersion,
  b: SyncVersion,
): boolean {
  if (a.action !== b.action) return false;
  return (
    a.action === "delete" || equivalentPayload(entity, a.payload, b.payload)
  );
}

export function conflictVersion(value: unknown): SyncVersion {
  if (!value || typeof value !== "object")
    throw new Error("The saved conflict version is invalid.");
  const version = value as SyncVersion;
  if (version.action !== "delete" && version.action !== "upsert")
    throw new Error("The saved conflict action is invalid.");
  if (version.action === "delete" && version.payload !== null)
    throw new Error("The saved conflict deletion is invalid.");
  if (version.action === "upsert" && version.payload === null)
    throw new Error("The saved conflict version has no study data.");
  return version;
}

export async function listUnresolvedConflicts(
  db: StrideDatabase,
): Promise<SyncConflict[]> {
  return db.conflicts
    .filter((conflict) => !conflict.resolved_at)
    .sortBy("created_at");
}

function parentId(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const version = value as { payload?: { session?: { subject_id?: unknown } } };
  return typeof version.payload?.session?.subject_id === "string"
    ? version.payload.session.subject_id
    : null;
}

export function conflictReferencesSubject(
  conflict: SyncConflict,
  subjectId: string,
): boolean {
  return (
    (conflict.entity === "subject" && conflict.record_id === subjectId) ||
    (conflict.entity === "session" &&
      (parentId(conflict.local_snapshot) === subjectId ||
        parentId(conflict.remote_snapshot) === subjectId))
  );
}

export async function hasUnresolvedConflict(
  db: StrideDatabase,
  entity: SyncEntity,
  recordId: string,
): Promise<boolean> {
  const conflicts = await listUnresolvedConflicts(db);
  if (
    conflicts.some(
      (item) => item.entity === entity && item.record_id === recordId,
    )
  )
    return true;
  if (entity === "subject")
    return conflicts.some((item) => conflictReferencesSubject(item, recordId));
  if (entity === "session") {
    const session = await db.sessions.get(recordId);
    const operations = await db.pendingOperations
      .where("[entity+record_id]")
      .equals([entity, recordId])
      .toArray();
    let subjectId =
      session?.subject_id ??
      operations
        .map((operation) => parentId({ payload: operation.payload }))
        .find(Boolean);
    if (!subjectId) {
      const related = conflicts.find(
        (item) =>
          item.entity === "subject" &&
          (item.context?.local_tree?.sessions.some(
            (child) => child.id === recordId,
          ) ||
            item.context?.incoming_tree?.sessions.some(
              (child) => child.id === recordId,
            )),
      );
      subjectId = related?.record_id;
    }
    if (!subjectId && conflicts.some((item) => item.entity === "subject")) {
      // Local parent deletion deliberately clears rows. Its recovery tree keeps
      // relationships available while a later cloud version awaits a decision.
      const copies = await db.recoveryCopies
        .orderBy("created_at")
        .reverse()
        .toArray();
      for (const copy of copies) {
        const data = copy.snapshot as Partial<Data>;
        const recovered = data.sessions?.find((child) => child.id === recordId);
        if (recovered) {
          subjectId = recovered.subject_id;
          break;
        }
      }
    }
    return (
      !!subjectId &&
      conflicts.some(
        (item) => item.entity === "subject" && item.record_id === subjectId,
      )
    );
  }
  return false;
}

export async function protectRemoteSubjectDeletion(
  db: StrideDatabase,
  subjectId: string,
): Promise<boolean> {
  if ((await db.timers.get(1))?.value.subjectId === subjectId) return true;
  const operations = await db.pendingOperations
    .filter((operation) => operation.entity === "session")
    .toArray();
  if (
    operations.some(
      (operation) =>
        operation.action === "upsert" &&
        parentId({ payload: operation.payload }) === subjectId,
    )
  )
    return true;
  return (await listUnresolvedConflicts(db)).some(
    (item) =>
      item.entity === "session" && conflictReferencesSubject(item, subjectId),
  );
}

async function readTree(db: StrideDatabase, subjectId: string): Promise<Data> {
  const subject = await db.subjects.get(subjectId);
  const sessions = await db.sessions
    .where("subject_id")
    .equals(subjectId)
    .toArray();
  const ids = sessions.map((session) => session.id);
  return {
    subjects: subject ? [subject] : [],
    sessions,
    slices: ids.length
      ? await db.slices.where("session_id").anyOf(ids).toArray()
      : [],
    settings: (await db.preferences.get(1)) ?? { ...defaults },
    running:
      (await db.timers.get(1))?.value.subjectId === subjectId
        ? (await db.timers.get(1))!.value
        : null,
  };
}

async function recoveryTree(
  db: StrideDatabase,
  subjectId: string,
): Promise<Data | undefined> {
  const copies = await db.recoveryCopies
    .where("[entity+record_id]")
    .equals(["subject", subjectId])
    .sortBy("created_at");
  for (const copy of copies.reverse()) {
    const snapshot = copy.snapshot as Partial<Data> & {
      context?: SyncConflict["context"];
      conflict?: SyncConflict;
    };
    const candidates = [
      snapshot,
      snapshot.context?.local_tree,
      snapshot.conflict?.context?.local_tree,
    ];
    const data = candidates.find((item) =>
      item?.subjects?.some((subject) => subject.id === subjectId),
    );
    if (data?.subjects && data.sessions && data.slices && data.settings)
      return data as Data;
  }
  return undefined;
}

/** Called inside the pull/ack transaction, so disagreement and cursor/receipt commit together. */
export async function preserveConflict(
  db: StrideDatabase,
  input: ConflictInput,
): Promise<SyncConflict> {
  await assertAccountDatabase(db);
  const isImport = (source: SyncConflict["source"]) =>
    source === "legacy" || source === "backup";
  const previous = await db.conflicts
    .where("[entity+record_id]")
    .equals([input.entity, input.record_id])
    .filter(
      (item) =>
        !item.resolved_at && isImport(item.source) === isImport(input.source),
    )
    .first();
  if (
    previous?.remote_revision &&
    input.remote_revision &&
    compareRevision(previous.remote_revision, input.remote_revision) > 0
  ) {
    // A durable receipt can describe an older cloud version than an already
    // applied pull. Preserve the receipt without replacing the latest choice.
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: input.entity,
      record_id: input.record_id,
      snapshot: input,
      created_at: new Date().toISOString(),
    });
    input = {
      ...input,
      remote_snapshot: conflictVersion(previous.remote_snapshot),
      remote_revision: previous.remote_revision,
    };
  }
  if (
    previous &&
    previous.remote_revision === input.remote_revision &&
    versionsEqual(
      input.entity,
      conflictVersion(previous.local_snapshot),
      input.local_snapshot,
    ) &&
    versionsEqual(
      input.entity,
      conflictVersion(previous.remote_snapshot),
      input.remote_snapshot,
    )
  )
    return previous;
  const now = new Date().toISOString();
  const currentTree =
    input.entity === "subject"
      ? await readTree(db, input.record_id)
      : undefined;
  const context = {
    ...previous?.context,
    ...input.context,
    ...(input.entity === "subject" && !input.context?.local_tree
      ? {
          local_tree: currentTree?.subjects.length
            ? currentTree
            : ((await recoveryTree(db, input.record_id)) ?? currentTree),
        }
      : {}),
  };
  await db.recoveryCopies.add({
    id: crypto.randomUUID(),
    reason: "conflict",
    entity: input.entity,
    record_id: input.record_id,
    snapshot: previous ?? { ...input, context },
    created_at: now,
  });
  const conflict: SyncConflict = {
    ...previous,
    ...input,
    context,
    id: previous?.id ?? crypto.randomUUID(),
    created_at: previous?.created_at ?? now,
    resolved_at: null,
  };
  await db.conflicts.put(conflict);
  return conflict;
}

export const recordConflict = preserveConflict;

export function canKeepBoth(conflict: SyncConflict): boolean {
  if (conflict.entity === "settings") return false;
  try {
    return (
      conflictVersion(conflict.local_snapshot).action === "upsert" &&
      conflictVersion(conflict.remote_snapshot).action === "upsert"
    );
  } catch {
    return false;
  }
}

async function preserveResolution(
  db: StrideDatabase,
  conflict: SyncConflict,
): Promise<void> {
  await db.recoveryCopies.add({
    id: crypto.randomUUID(),
    reason: "conflict",
    entity: conflict.entity,
    record_id: conflict.record_id,
    snapshot: {
      conflict,
      current: await readLocalVersion(db, conflict.entity, conflict.record_id),
      pending: await db.pendingOperations.toArray(),
    },
    created_at: new Date().toISOString(),
  });
}

async function removeOperations(
  db: StrideDatabase,
  entity: SyncEntity,
  recordId: string,
): Promise<void> {
  const operations = await db.pendingOperations
    .where("[entity+record_id]")
    .equals([entity, recordId])
    .toArray();
  for (const operation of operations) {
    if (operation.status === "in_flight" || operation.wire_request) {
      if (!(await definitiveRejection(db, operation)))
        throw new Error(
          "Sync must confirm the submitted change before resolving this conflict. Try Sync now first.",
        );
      await db.recoveryCopies.put({
        id: `superseded-operation:${operation.id}`,
        reason: "conflict",
        entity,
        record_id: recordId,
        snapshot: {
          operation,
          rejection: (await db.syncMetadata.get(`op_error:${operation.id}`))
            ?.value,
        },
        created_at: new Date().toISOString(),
      });
    }
    await db.syncMetadata.delete(`op_error:${operation.id}`);
  }
  await db.pendingOperations.bulkDelete(
    operations.map((operation) => operation.sequence!),
  );
}

async function definitiveRejection(
  db: StrideDatabase,
  operation: PendingOperation,
): Promise<boolean> {
  const metadata = await db.syncMetadata.get(operationErrorKey(operation));
  return parseOperationFailure(metadata?.value)?.definitiveNoCommit === true;
}

async function childMovedOutsideSubject(
  db: StrideDatabase,
  recordId: string,
  subjectId: string,
  pending: PendingOperation[],
  conflicts: SyncConflict[],
): Promise<boolean> {
  const current = await db.sessions.get(recordId);
  if (current) return current.subject_id !== subjectId;
  const latestParent = [...pending]
    .reverse()
    .filter(
      (operation) =>
        operation.entity === "session" &&
        operation.record_id === recordId &&
        operation.action === "upsert",
    )
    .map((operation) => parentId({ payload: operation.payload }))
    .find(Boolean);
  if (latestParent) return latestParent !== subjectId;
  return conflicts.some(
    (conflict) =>
      conflict.entity === "session" &&
      conflict.record_id === recordId &&
      parentId(conflict.local_snapshot) !== null &&
      parentId(conflict.local_snapshot) !== subjectId,
  );
}

async function recoveredSubject(
  db: StrideDatabase,
  id: string,
  conflict?: SyncConflict,
): Promise<Subject | undefined> {
  const contextual =
    conflict?.context?.local_tree?.subjects.find(
      (subject) => subject.id === id,
    ) ??
    conflict?.context?.incoming_tree?.subjects.find(
      (subject) => subject.id === id,
    );
  if (contextual) return contextual;
  const copies = await db.recoveryCopies
    .orderBy("created_at")
    .reverse()
    .toArray();
  for (const copy of copies) {
    const data = copy.snapshot as Partial<Data> & {
      context?: SyncConflict["context"];
      conflict?: SyncConflict;
    };
    const subject =
      data.subjects?.find((item) => item.id === id) ??
      data.context?.local_tree?.subjects.find((item) => item.id === id) ??
      data.conflict?.context?.local_tree?.subjects.find(
        (item) => item.id === id,
      );
    if (subject) return subject;
  }
  return undefined;
}

async function ensureParent(
  db: StrideDatabase,
  id: string,
  conflict?: SyncConflict,
): Promise<void> {
  if (await db.subjects.get(id)) return;
  const subject = await recoveredSubject(db, id, conflict);
  if (!subject)
    throw new Error(
      "Resolve the subject conflict before restoring this session.",
    );
  const revision = await db.recordRevisions.get(["subject", id]);
  await db.subjects.put(subject);
  await removeOperations(db, "subject", id);
  await enqueueOperation(
    db,
    "subject",
    id,
    "upsert",
    subject,
    revision?.server_revision ?? null,
  );
}

async function writeVersion(
  db: StrideDatabase,
  entity: SyncEntity,
  id: string,
  version: SyncVersion,
  conflict?: SyncConflict,
): Promise<SyncPayload> {
  if (version.action === "delete") {
    if (entity === "subject") {
      const sessions = await db.sessions
        .where("subject_id")
        .equals(id)
        .toArray();
      if (sessions.length) {
        await db.slices
          .where("session_id")
          .anyOf(sessions.map((session) => session.id))
          .delete();
        await db.sessions.bulkDelete(sessions.map((session) => session.id));
      }
      await db.subjects.delete(id);
    } else if (entity === "session") {
      await db.slices.where("session_id").equals(id).delete();
      await db.sessions.delete(id);
    } else {
      const previous = (await db.preferences.get(1)) ?? { ...defaults };
      await db.preferences.put({
        ...previous,
        minimum: defaults.minimum,
        goal: defaults.goal,
        presets: defaults.presets,
        weekStart: defaults.weekStart,
        id: 1,
      });
    }
    return null;
  }
  const normalized = normalizePayload(entity, version.payload);
  if (entity === "subject") {
    const subject = normalized as Subject;
    if (subject.id !== id)
      throw new Error("The conflict subject identity is invalid.");
    await db.subjects.put(subject);
    return subject;
  }
  if (entity === "session") {
    const payload = normalized as { session: Session; slices: Slice[] };
    if (payload.session.id !== id)
      throw new Error("The conflict session identity is invalid.");
    await ensureParent(db, payload.session.subject_id, conflict);
    await db.sessions.put(payload.session);
    await db.slices.where("session_id").equals(id).delete();
    await db.slices.bulkPut(payload.slices);
    return payload;
  }
  const settings = {
    ...((await db.preferences.get(1)) ?? defaults),
    ...normalized,
  } as Settings;
  await db.preferences.put({ ...settings, id: 1 });
  return settings;
}

async function cloneSession(
  db: StrideDatabase,
  payload: { session: Session; slices: Slice[] },
  subjectId = payload.session.subject_id,
): Promise<void> {
  const id = crypto.randomUUID();
  const session = { ...payload.session, id, subject_id: subjectId };
  const slices = payload.slices.map((slice) => ({ ...slice, session_id: id }));
  await ensureParent(db, subjectId);
  await db.sessions.put(session);
  await db.slices.bulkPut(slices);
  await enqueueOperation(
    db,
    "session",
    id,
    "upsert",
    { session, slices },
    null,
  );
}

async function cloneSubject(
  db: StrideDatabase,
  subject: Subject,
  tree?: Data,
  remapTimer = false,
): Promise<string> {
  const id = crypto.randomUUID();
  const clone = { ...subject, id };
  await db.subjects.put(clone);
  await enqueueOperation(db, "subject", id, "upsert", clone, null);
  for (const session of tree?.sessions ?? []) {
    if (session.subject_id !== subject.id) continue;
    await cloneSession(
      db,
      {
        session,
        slices: tree!.slices.filter((slice) => slice.session_id === session.id),
      },
      id,
    );
  }
  if (remapTimer) {
    const timer = await db.timers.get(1);
    if (timer?.value.subjectId === subject.id)
      await db.timers.put({ id: 1, value: { ...timer.value, subjectId: id } });
  }
  if (tree?.running) await restoreImportedTimer(db, tree.running, id);
  return id;
}

/** Imports restore paused work locally and never replace another device-local timer. */
export async function restoreImportedTimer(
  db: StrideDatabase,
  running: Running,
  subjectId = running.subjectId,
): Promise<boolean> {
  if (await db.timers.get(1)) return false;
  const subject = await db.subjects.get(subjectId);
  if (!subject || subject.archived) return false;
  const id = (await db.sessions.get(running.id))
    ? crypto.randomUUID()
    : running.id;
  await db.timers.put({
    id: 1,
    value: { ...running, id, subjectId, runningSince: null },
  });
  return true;
}

/** Call under the worker's exclusive lock; unknown submitted requests cannot be replaced. */
export async function resolveConflict(
  db: StrideDatabase,
  conflictId: string,
  choice: ConflictChoice,
  guard: SyncGuard = () => {},
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    guard();
    await assertAccountDatabase(db);
    const conflict = await db.conflicts.get(conflictId);
    if (!conflict || conflict.resolved_at) return;
    const local = conflictVersion(conflict.local_snapshot);
    const remote = conflictVersion(conflict.remote_snapshot);
    const imported =
      conflict.source === "legacy" || conflict.source === "backup";
    const currentLocal = await readLocalVersion(
      db,
      conflict.entity,
      conflict.record_id,
    );
    const latestLocal =
      conflict.context?.recovered_local &&
      currentLocal.action === "delete" &&
      local.action === "upsert"
        ? local
        : currentLocal;
    if (choice === "both" && !canKeepBoth(conflict))
      throw new Error("These versions cannot be kept as two separate records.");
    // A parent choice also covers children deleted by the cloud cascade.
    const unresolved = await listUnresolvedConflicts(db);
    const children =
      conflict.entity === "subject"
        ? unresolved.filter(
            (item) =>
              item.entity === "session" &&
              conflictReferencesSubject(item, conflict.record_id) &&
              item.source !== "legacy" &&
              item.source !== "backup",
          )
        : [];
    const localTree =
      conflict.entity === "subject"
        ? await readTree(db, conflict.record_id)
        : null;
    const deletedTree =
      conflict.entity === "subject"
        ? await recoveryTree(db, conflict.record_id)
        : undefined;
    const childIds = new Set([
      ...children.map((child) => child.record_id),
      ...(localTree?.sessions.map((session) => session.id) ?? []),
      ...(conflict.context?.local_tree?.sessions.map((session) => session.id) ??
        []),
      ...(deletedTree?.sessions.map((session) => session.id) ?? []),
    ]);
    const pending = await db.pendingOperations.toArray();
    for (const operation of pending) {
      if (
        operation.entity === "session" &&
        parentId({ payload: operation.payload }) === conflict.record_id
      )
        childIds.add(operation.record_id);
    }
    const movedChildIds = new Set<string>();
    if (conflict.entity === "subject") {
      for (const id of childIds) {
        if (
          await childMovedOutsideSubject(
            db,
            id,
            conflict.record_id,
            pending,
            unresolved,
          )
        )
          movedChildIds.add(id);
      }
    }
    const scopedChildren = children.filter(
      (child) => !movedChildIds.has(child.record_id),
    );
    for (const operation of pending) {
      const related =
        (operation.entity === conflict.entity &&
          operation.record_id === conflict.record_id) ||
        (conflict.entity === "subject" &&
          operation.entity === "session" &&
          (childIds.has(operation.record_id) ||
            parentId({ payload: operation.payload }) === conflict.record_id));
      if (
        related &&
        (operation.status === "in_flight" || operation.wire_request) &&
        !(await definitiveRejection(db, operation))
      )
        throw new Error(
          "Sync must confirm the submitted change before resolving this conflict. Try Sync now first.",
        );
    }
    await preserveResolution(db, conflict);
    if (!imported && conflict.remote_revision) {
      const revision = await db.recordRevisions.get([
        conflict.entity,
        conflict.record_id,
      ]);
      if (
        !revision ||
        compareRevision(conflict.remote_revision, revision.server_revision) >= 0
      )
        await db.recordRevisions.put({
          entity: conflict.entity,
          record_id: conflict.record_id,
          server_revision: conflict.remote_revision,
          deleted: remote.action === "delete",
          updated_at: new Date().toISOString(),
        });
    }
    if (conflict.entity === "subject" && !imported && choice !== "local") {
      for (const operation of pending) {
        if (
          operation.entity === "session" &&
          !movedChildIds.has(operation.record_id) &&
          (childIds.has(operation.record_id) ||
            parentId({ payload: operation.payload }) === conflict.record_id)
        )
          await removeOperations(db, "session", operation.record_id);
      }
    }

    if (choice === "both") {
      const copy = imported
        ? remote
        : latestLocal.action === "upsert"
          ? latestLocal
          : local;
      if (conflict.entity === "subject") {
        let tree = imported
          ? conflict.context?.incoming_tree
          : localTree?.subjects.length
            ? localTree
            : (conflict.context?.local_tree ?? deletedTree);
        if (!imported && tree && movedChildIds.size) {
          const scopedSessions = tree.sessions.filter(
            (session) => !movedChildIds.has(session.id),
          );
          const scopedIds = new Set(
            scopedSessions.map((session) => session.id),
          );
          tree = {
            ...tree,
            sessions: scopedSessions,
            slices: tree.slices.filter((slice) =>
              scopedIds.has(slice.session_id),
            ),
          };
        }
        await cloneSubject(
          db,
          normalizePayload("subject", copy.payload) as Subject,
          tree,
          !imported,
        );
      } else
        await cloneSession(
          db,
          normalizePayload("session", copy.payload) as {
            session: Session;
            slices: Slice[];
          },
        );
      if (!imported) {
        await removeOperations(db, conflict.entity, conflict.record_id);
        await writeVersion(
          db,
          conflict.entity,
          conflict.record_id,
          remote,
          conflict,
        );
      }
    } else if (!(imported && choice === "local")) {
      const chosen = choice === "local" ? latestLocal : remote;
      await removeOperations(db, conflict.entity, conflict.record_id);
      if (conflict.entity === "subject" && chosen.action === "delete") {
        const timer = await db.timers.get(1);
        if (timer?.value.subjectId === conflict.record_id) {
          const subject =
            (await db.subjects.get(conflict.record_id)) ??
            (await recoveredSubject(db, conflict.record_id, conflict));
          if (!subject)
            throw new Error(
              "The active timer's subject must be recovered before resolving this deletion.",
            );
          await cloneSubject(db, subject, undefined, true);
        }
      }
      const payload = await writeVersion(
        db,
        conflict.entity,
        conflict.record_id,
        chosen,
        conflict,
      );
      if (choice === "local" || imported)
        await enqueueOperation(
          db,
          conflict.entity,
          conflict.record_id,
          chosen.action,
          payload,
          imported
            ? ((
                await db.recordRevisions.get([
                  conflict.entity,
                  conflict.record_id,
                ])
              )?.server_revision ?? null)
            : conflict.remote_revision,
        );
    }

    if (conflict.entity === "subject" && !imported) {
      const keepChildren =
        choice === "local" && latestLocal.action === "upsert";
      for (const child of scopedChildren) {
        await removeOperations(db, "session", child.record_id);
        if (keepChildren) {
          const version = await readLocalVersion(
            db,
            "session",
            child.record_id,
          );
          const chosen =
            version.action === "upsert"
              ? version
              : conflictVersion(child.local_snapshot);
          const payload = await writeVersion(
            db,
            "session",
            child.record_id,
            chosen,
            child,
          );
          await enqueueOperation(
            db,
            "session",
            child.record_id,
            chosen.action,
            payload,
            child.remote_revision,
          );
        } else
          await writeVersion(
            db,
            "session",
            child.record_id,
            conflictVersion(child.remote_snapshot),
            child,
          );
        await db.conflicts.update(child.id, {
          resolved_at: new Date().toISOString(),
        });
      }
      if (choice === "local" || movedChildIds.size) {
        const resolvedIds = new Set(
          scopedChildren.map((child) => child.record_id),
        );
        for (const operation of pending) {
          const related =
            operation.entity === "session" &&
            (childIds.has(operation.record_id) ||
              parentId({ payload: operation.payload }) === conflict.record_id);
          if (
            !related ||
            (choice !== "local" && !movedChildIds.has(operation.record_id)) ||
            resolvedIds.has(operation.record_id) ||
            operation.status !== "in_flight" ||
            !(await definitiveRejection(db, operation))
          )
            continue;
          // A child created locally after the cloud parent disappeared may
          // have a proven FK rollback but no cloud child/change-feed conflict.
          // The explicit parent choice includes that live local branch too.
          const current = await readLocalVersion(
            db,
            "session",
            operation.record_id,
          );
          await removeOperations(db, "session", operation.record_id);
          const movedToAnotherParent =
            current.action === "upsert" &&
            (current.payload as { session: Session }).session.subject_id !==
              conflict.record_id;
          if (
            keepChildren ||
            movedToAnotherParent ||
            movedChildIds.has(operation.record_id)
          ) {
            const payload = await writeVersion(
              db,
              "session",
              operation.record_id,
              current,
              conflict,
            );
            const revision = await db.recordRevisions.get([
              "session",
              operation.record_id,
            ]);
            await enqueueOperation(
              db,
              "session",
              operation.record_id,
              current.action,
              payload,
              revision?.server_revision ?? null,
            );
          }
          resolvedIds.add(operation.record_id);
        }
      }
      if (
        choice === "remote" &&
        remote.action === "upsert" &&
        local.action === "delete"
      ) {
        // Reversing a pending parent deletion must also reverse its local-only
        // child deletions. Changed cloud children were resolved above; known
        // cloud tombstones remain deleted.
        const resolvedIds = new Set(
          scopedChildren.map((child) => child.record_id),
        );
        for (const session of deletedTree?.sessions ??
          conflict.context?.local_tree?.sessions ??
          []) {
          if (
            resolvedIds.has(session.id) ||
            movedChildIds.has(session.id) ||
            (await db.sessions.get(session.id))
          )
            continue;
          const revision = await db.recordRevisions.get([
            "session",
            session.id,
          ]);
          if (revision?.deleted) continue;
          const tree = deletedTree ?? conflict.context!.local_tree!;
          await writeVersion(
            db,
            "session",
            session.id,
            {
              action: "upsert",
              payload: {
                session,
                slices: tree.slices.filter(
                  (slice) => slice.session_id === session.id,
                ),
              },
            },
            conflict,
          );
        }
      }
    }
    if (conflict.entity === "subject" && imported && choice === "remote") {
      // The incoming tree was staged because assigning its sessions to a divergent subject was unsafe.
      for (const session of conflict.context?.incoming_tree?.sessions ?? []) {
        if (session.subject_id !== conflict.record_id) continue;
        const slices = conflict.context!.incoming_tree!.slices.filter(
          (slice) => slice.session_id === session.id,
        );
        const incoming: SyncVersion = {
          action: "upsert",
          payload: { session, slices },
        };
        const current = await readLocalVersion(db, "session", session.id);
        const revision = await db.recordRevisions.get(["session", session.id]);
        if (current.action === "delete" && !revision) {
          await writeVersion(db, "session", session.id, incoming, conflict);
          await enqueueOperation(
            db,
            "session",
            session.id,
            "upsert",
            { session, slices },
            null,
          );
        } else if (!versionsEqual("session", current, incoming)) {
          await preserveConflict(db, {
            entity: "session",
            record_id: session.id,
            local_snapshot: current,
            remote_snapshot: incoming,
            base_revision: revision?.server_revision ?? null,
            remote_revision: revision?.server_revision ?? null,
            source: conflict.source,
            kind: "import",
            context: conflict.context,
          });
        }
      }
      if (conflict.context?.incoming_tree?.running)
        await restoreImportedTimer(db, conflict.context.incoming_tree.running);
    }
    await db.conflicts.update(conflict.id, {
      resolved_at: new Date().toISOString(),
    });
    guard();
  });
}
