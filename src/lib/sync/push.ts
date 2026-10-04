import type { PendingOperation, StrideDatabase } from "../local-database";
import {
  assertAccountDatabase,
  hasUnresolvedConflict,
  preserveConflict,
  readLocalVersion,
} from "./conflicts";
import { compareRevision, normalizeOperation } from "./normalization";
import {
  SyncError,
  type SyncAdapter,
  type SyncGuard,
  type WireOperation,
} from "./types";

export async function clearOperationErrors(db: StrideDatabase): Promise<void> {
  await db.syncMetadata.where("key").startsWith("op_error:").delete();
}
async function canSend(
  db: StrideDatabase,
  operation: PendingOperation,
  all: PendingOperation[],
): Promise<boolean> {
  if (await db.syncMetadata.get(`op_error:${operation.id}`)) return false;
  if (
    all.some(
      (other) =>
        other.entity === operation.entity &&
        other.record_id === operation.record_id &&
        (other.sequence ?? 0) < (operation.sequence ?? 0),
    )
  )
    return false;
  // Unknown acknowledgements must be settled with their original request,
  // including when a subsequent pull has discovered a conflicting version.
  if (operation.status === "in_flight") return true;
  if (await hasUnresolvedConflict(db, operation.entity, operation.record_id))
    return false;
  if (operation.entity === "session" && operation.action === "upsert") {
    const id = (operation.payload as { session?: { subject_id?: string } })
      ?.session?.subject_id;
    if (!id) return true; // Validation quarantines the corrupted operation.
    if (await hasUnresolvedConflict(db, "subject", id)) return false;
    const revision = await db.recordRevisions.get(["subject", id]);
    if (
      !revision ||
      revision.deleted ||
      all.some(
        (other) =>
          other.entity === "subject" &&
          other.record_id === id &&
          other.action === "upsert",
      )
    )
      return false;
  }
  if (operation.entity === "subject" && operation.action === "delete") {
    const children = new Set(
      await db.sessions
        .where("subject_id")
        .equals(operation.record_id)
        .primaryKeys(),
    );
    const copies = await db.recoveryCopies
      .where("[entity+record_id]")
      .equals(["subject", operation.record_id])
      .toArray();
    for (const copy of copies) {
      const snapshot = copy.snapshot as {
        sessions?: { id: string; subject_id: string }[];
      };
      for (const child of snapshot.sessions ?? [])
        if (child.subject_id === operation.record_id) children.add(child.id);
    }
    if (
      all.some(
        (other) =>
          other.entity === "session" &&
          (children.has(other.record_id) ||
            (other.payload as { session?: { subject_id?: string } } | null)
              ?.session?.subject_id === operation.record_id),
      )
    )
      return false;
  }
  return true;
}
export async function pushPending(
  db: StrideDatabase,
  adapter: SyncAdapter,
  guard: SyncGuard,
  options: { signal?: AbortSignal; limit?: number } = {},
): Promise<{ applied: number; conflicts: number; blocked: number }> {
  guard();
  if (!db.accountId)
    throw new SyncError("Anonymous history cannot synchronize.", "auth");
  await assertAccountDatabase(db);
  guard();
  const result = { applied: 0, conflicts: 0, blocked: 0 };
  const limit = options.limit ?? 100;
  for (let count = 0; count < limit; count++) {
    guard();
    if (options.signal?.aborted)
      throw new SyncError("Synchronization stopped.", "cancelled");
    const all = await db.pendingOperations.orderBy("sequence").toArray();
    let candidate: PendingOperation | undefined;
    for (const operation of all)
      if (await canSend(db, operation, all)) {
        candidate = operation;
        break;
      }
    if (!candidate) {
      result.blocked = all.length;
      break;
    }
    let wire: WireOperation | undefined;
    try {
      wire = await db.transaction(
        "rw",
        db.pendingOperations,
        db.syncMetadata,
        async () => {
          guard();
          const current = await db.pendingOperations.get(candidate!.sequence!);
          if (!current || current.id !== candidate!.id) return undefined;
          const frozen = current.wire_request ?? normalizeOperation(current);
          // A claimed request remains exactly as stored, even after restart or
          // a timezone change. Later local edits create another operation.
          if (!current.wire_request)
            await db.pendingOperations.put({
              ...current,
              status: "in_flight",
              wire_request: frozen,
            });
          guard();
          return frozen;
        },
      );
      if (!wire) continue;
      const reply = await adapter.apply(wire, options.signal);
      guard();
      await db.transaction("rw", db.tables, async () => {
        guard();
        const current = await db.pendingOperations.get(candidate!.sequence!);
        if (!current || current.id !== wire!.id) return;
        const now = new Date().toISOString();
        if (reply.status === "conflict") {
          const known = await db.recordRevisions.get([
            wire!.entity,
            wire!.record_id,
          ]);
          const staleReceipt =
            known &&
            reply.current_revision &&
            compareRevision(reply.current_revision, known.server_revision) < 0;
          const local = await readLocalVersion(
            db,
            wire!.entity,
            wire!.record_id,
          );
          if (!staleReceipt)
            await preserveConflict(db, {
              entity: wire!.entity,
              record_id: wire!.record_id,
              local_snapshot: local,
              remote_snapshot: {
                action:
                  reply.deleted || reply.current_snapshot === null
                    ? "delete"
                    : "upsert",
                payload: reply.current_snapshot,
              },
              base_revision: wire!.base_revision,
              remote_revision: reply.current_revision,
              source: "push",
            });
          if (
            reply.current_revision &&
            (!known ||
              compareRevision(reply.current_revision, known.server_revision) >=
                0)
          )
            await db.recordRevisions.put({
              entity: wire!.entity,
              record_id: wire!.record_id,
              server_revision: reply.current_revision,
              deleted: reply.deleted,
              updated_at: now,
            });
          await db.recoveryCopies.put({
            id: `rejected-operation:${wire!.id}`,
            reason: "conflict",
            entity: wire!.entity,
            record_id: wire!.record_id,
            snapshot: current,
            created_at: now,
          });
          if (!staleReceipt) result.conflicts++;
        } else {
          const known = await db.recordRevisions.get([
            wire!.entity,
            wire!.record_id,
          ]);
          if (
            !known ||
            compareRevision(reply.revision, known.server_revision) >= 0
          ) {
            await db.recordRevisions.put({
              entity: wire!.entity,
              record_id: wire!.record_id,
              server_revision: reply.revision,
              deleted: wire!.action === "delete",
              updated_at: now,
            });
            // Rebase only never-submitted successors of our acknowledged
            // operation. Their UUID has not yet reached the receipt system.
            const successors = await db.pendingOperations
              .where("[entity+record_id]")
              .equals([wire!.entity, wire!.record_id])
              .toArray();
            for (const successor of successors)
              if (
                successor.status === "pending" &&
                !successor.wire_request &&
                successor.base_revision === wire!.base_revision &&
                successor.sequence !== current.sequence
              )
                await db.pendingOperations.put({
                  ...successor,
                  base_revision: reply.revision,
                  updated_at: now,
                });
          }
          result.applied++;
        }
        await db.pendingOperations.delete(current.sequence!);
        await db.syncMetadata.delete(`op_error:${wire!.id}`);
        // A push cursor is only an acknowledgement. It cannot replace a pull
        // cursor because earlier cloud changes may still be unseen locally.
        guard();
      });
    } catch (error) {
      if (
        error instanceof SyncError &&
        (error.kind === "permanent" || error.kind === "malformed")
      ) {
        guard();
        await db.transaction("rw", db.syncMetadata, async () => {
          guard();
          await db.syncMetadata.put({
            key: `op_error:${candidate!.id}`,
            value: JSON.stringify({
              kind: error.kind,
              message: error.message,
              at: new Date().toISOString(),
              definitiveNoCommit: error.definitiveNoCommit,
            }),
          });
          guard();
        });
        result.blocked++;
        continue;
      }
      throw error;
    }
  }
  const remaining = await db.pendingOperations.orderBy("sequence").toArray();
  result.blocked = 0;
  for (const operation of remaining)
    if (!(await canSend(db, operation, remaining))) result.blocked++;
  guard();
  return result;
}
