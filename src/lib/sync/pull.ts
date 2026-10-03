import {
  defaults,
  type Session,
  type Settings,
  type Slice,
  type Subject,
} from "../../models";
import type { PendingOperation, StrideDatabase } from "../local-database";
import {
  assertAccountDatabase,
  hasUnresolvedConflict,
  preserveConflict,
  protectRemoteSubjectDeletion,
  readLocalVersion,
} from "./conflicts";
import { parseChangePage } from "./client";
import { compareRevision, equivalentPayload } from "./normalization";
import {
  SyncError,
  type SharedSettings,
  type SyncAdapter,
  type SyncChange,
  type SyncGuard,
  type SyncVersion,
} from "./types";

export const SYNC_STREAM = "study";

async function retainBeforeApply(
  db: StrideDatabase,
  change: SyncChange,
  local: SyncVersion,
): Promise<void> {
  if (local.action === "delete") return;
  // Deterministic keys make cursor replay restartable without accumulating
  // duplicate copies. Ordered history also preserves newly seen children
  // deleted by a concurrent cloud parent deletion.
  const snapshot =
    change.entity === "subject"
      ? {
          version: local,
          sessions: await db.sessions
            .where("subject_id")
            .equals(change.record_id)
            .toArray(),
          slices: await db.slices
            .where("session_id")
            .anyOf(
              (
                await db.sessions
                  .where("subject_id")
                  .equals(change.record_id)
                  .toArray()
              ).map((s) => s.id),
            )
            .toArray(),
          running: (await db.timers.get(1))?.value ?? null,
        }
      : local;
  await db.recoveryCopies.put({
    id: `remote:${change.entity}:${change.record_id}:${change.revision}`,
    reason: "remote_apply",
    entity: change.entity,
    record_id: change.record_id,
    snapshot,
    created_at: new Date().toISOString(),
  });
}
export async function applyCloudVersion(
  db: StrideDatabase,
  change: Pick<SyncChange, "entity" | "record_id" | "action" | "payload">,
): Promise<void> {
  if (change.entity === "subject") {
    if (change.action === "upsert")
      await db.subjects.put(change.payload as Subject);
    else {
      const sessions = await db.sessions
        .where("subject_id")
        .equals(change.record_id)
        .toArray();
      if (sessions.length) {
        await db.slices
          .where("session_id")
          .anyOf(sessions.map((s) => s.id))
          .delete();
        await db.sessions.bulkDelete(sessions.map((s) => s.id));
      }
      await db.subjects.delete(change.record_id);
    }
  } else if (change.entity === "session") {
    await db.slices.where("session_id").equals(change.record_id).delete();
    if (change.action === "delete") await db.sessions.delete(change.record_id);
    else {
      const payload = change.payload as { session: Session; slices: Slice[] };
      await db.sessions.put(payload.session);
      await db.slices.bulkPut(payload.slices);
    }
  } else {
    const local: Settings = (await db.preferences.get(1)) ?? defaults;
    const shared: SharedSettings =
      change.action === "delete"
        ? defaults
        : (change.payload as SharedSettings);
    await db.preferences.put({ ...local, ...shared, id: 1 });
  }
}

async function acknowledgeOwnChange(
  db: StrideDatabase,
  change: SyncChange,
  operation: PendingOperation,
): Promise<void> {
  await db.pendingOperations.delete(operation.sequence!);
  await db.syncMetadata.delete(`op_error:${operation.id}`);
  const queued = await db.pendingOperations
    .where("[entity+record_id]")
    .equals([change.entity, change.record_id])
    .toArray();
  for (const next of queued)
    if (
      next.status === "pending" &&
      !next.wire_request &&
      next.base_revision === operation.base_revision
    )
      await db.pendingOperations.put({
        ...next,
        base_revision: change.revision,
        updated_at: new Date().toISOString(),
      });
}
async function applyChange(
  db: StrideDatabase,
  change: SyncChange,
): Promise<boolean> {
  const known = await db.recordRevisions.get([change.entity, change.record_id]);
  const pending = await db.pendingOperations
    .where("[entity+record_id]")
    .equals([change.entity, change.record_id])
    .toArray();
  const own = pending.find(
    (op) =>
      op.id === change.operation_id &&
      op.action === change.action &&
      equivalentPayload(
        change.entity,
        op.wire_request?.payload ?? op.payload,
        change.payload,
      ),
  );
  // A change echo proves the mutation exists, but an interrupted submitted
  // request still retries its original UUID to settle the durable RPC receipt.
  if (own && own.status !== "in_flight")
    await acknowledgeOwnChange(db, change, own);
  if (known && compareRevision(change.revision, known.server_revision) <= 0)
    return false;
  const local = await readLocalVersion(db, change.entity, change.record_id);
  const remote: SyncVersion = {
    action: change.action,
    payload: change.payload,
  };
  const remaining = pending.filter((op) => op.id !== own?.id);
  const equivalent =
    local.action === remote.action &&
    equivalentPayload(change.entity, local.payload, remote.payload);
  const existingConflict = await hasUnresolvedConflict(
    db,
    change.entity,
    change.record_id,
  );
  const parentProtected =
    change.entity === "subject" &&
    change.action === "delete" &&
    (await protectRemoteSubjectDeletion(db, change.record_id));
  let parentUnavailable = false;
  if (change.entity === "session" && change.action === "upsert") {
    const parentId = (change.payload as { session: Session }).session
      .subject_id;
    const parentOperations = await db.pendingOperations
      .where("[entity+record_id]")
      .equals(["subject", parentId])
      .toArray();
    parentUnavailable =
      !(await db.subjects.get(parentId)) ||
      parentOperations.some((op) => op.action === "delete");
  }
  // Unknown local versions (including old linked caches with no outbox) must
  // reconcile by identity and contents before adopting a cloud record.
  const untouchedDefaults =
    change.entity === "settings" &&
    !pending.length &&
    equivalentPayload("settings", local.payload, defaults);
  const unlinkedDivergence =
    !known &&
    !own &&
    !untouchedDefaults &&
    local.action === "upsert" &&
    !equivalent;
  const pendingDivergence = remaining.length > 0 && !equivalent && !own;
  const conflict =
    existingConflict ||
    parentProtected ||
    parentUnavailable ||
    unlinkedDivergence ||
    pendingDivergence;
  if (conflict) {
    const previous =
      change.entity === "session"
        ? await db.conflicts
            .where("[entity+record_id]")
            .equals([change.entity, change.record_id])
            .filter(
              (item) =>
                !item.resolved_at &&
                item.kind === "parent_deleted" &&
                item.source === "pull",
            )
            .first()
        : undefined;
    const previousLocal = previous?.local_snapshot as SyncVersion | undefined;
    const previousRemote = previous?.remote_snapshot as SyncVersion | undefined;
    const recoverCloudChild =
      previousLocal?.action === "delete" &&
      previousRemote?.action === "upsert" &&
      change.action === "delete";
    const recoveredLocal = recoverCloudChild
      ? previousRemote
      : previous?.context?.recovered_local && local.action === "delete"
        ? previousLocal
        : local;
    await preserveConflict(db, {
      entity: change.entity,
      record_id: change.record_id,
      local_snapshot: recoveredLocal ?? local,
      remote_snapshot: remote,
      base_revision:
        known?.server_revision ?? remaining[0]?.base_revision ?? null,
      remote_revision: change.revision,
      source: "pull",
      kind:
        parentProtected ||
        parentUnavailable ||
        previous?.kind === "parent_deleted"
          ? "parent_deleted"
          : "concurrent_edit",
      context:
        recoverCloudChild || previous?.context?.recovered_local
          ? { recovered_local: true }
          : undefined,
    });
  } else if (!own && remaining.length === 0) {
    if (!equivalent) await retainBeforeApply(db, change, local);
    await applyCloudVersion(db, change);
  } else if (!own && equivalent) {
    // Identity plus full normalized contents can safely link an unsent
    // duplicate. Already-submitted requests must still settle their receipt.
    for (const operation of remaining)
      if (operation.status === "pending" && !operation.wire_request)
        await db.pendingOperations.delete(operation.sequence!);
  }
  await db.recordRevisions.put({
    entity: change.entity,
    record_id: change.record_id,
    server_revision: change.revision,
    deleted: change.action === "delete",
    updated_at: new Date().toISOString(),
  });
  return conflict;
}

export async function pullChanges(
  db: StrideDatabase,
  adapter: SyncAdapter,
  guard: SyncGuard,
  options: { signal?: AbortSignal; pageSize?: number; maxPages?: number } = {},
): Promise<{
  pages: number;
  changes: number;
  conflicts: number;
  cursor: string;
  hasMore: boolean;
}> {
  guard();
  if (!db.accountId)
    throw new SyncError("Anonymous history cannot synchronize.", "auth");
  await assertAccountDatabase(db);
  guard();
  const limit = options.pageSize ?? 100;
  const maximumPages = options.maxPages ?? 100;
  let cursor = (await db.syncCursors.get(SYNC_STREAM))?.cursor ?? "0";
  const result = { pages: 0, changes: 0, conflicts: 0, cursor, hasMore: true };
  for (let count = 0; count < maximumPages; count++) {
    guard();
    if (options.signal?.aborted)
      throw new SyncError("Synchronization stopped.", "cancelled");
    // Validate fake/test gateways as well as the production adapter.
    const page = parseChangePage(
      await adapter.changes(cursor, limit, options.signal),
      cursor,
      limit,
    );
    guard();
    let pageConflicts = 0;
    await db.transaction("rw", db.tables, async () => {
      guard();
      const current = (await db.syncCursors.get(SYNC_STREAM))?.cursor ?? "0";
      if (current !== cursor)
        throw new SyncError(
          "Another synchronization advanced this workspace. Retry safely.",
          "transient",
        );
      for (const change of page.changes) {
        guard();
        if (await applyChange(db, change)) pageConflicts++;
      }
      guard();
      await db.syncCursors.put({
        stream: SYNC_STREAM,
        cursor: page.cursor,
        updated_at: new Date().toISOString(),
      });
      guard();
    });
    cursor = page.cursor;
    result.pages++;
    result.changes += page.changes.length;
    result.conflicts += pageConflicts;
    result.cursor = cursor;
    result.hasMore = page.has_more;
    if (!page.has_more) break;
  }
  return result;
}
