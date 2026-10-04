import type { PendingOperation, StrideDatabase } from "../local-database";
import type { SyncError } from "./types";

export type FailureCategory =
  | "local_validation"
  | "local_corruption"
  | "server_rejection"
  | "invalid_response";
export interface OperationFailure {
  kind: "permanent" | "malformed";
  category?: FailureCategory;
  at: string;
  definitiveNoCommit: boolean;
  rollbackProofVersion?: 1;
}

export function operationErrorKey(operation: PendingOperation): string {
  return typeof operation.id === "string" && operation.id.length
    ? `op_error:${operation.id}`
    : `op_error:sequence:${operation.sequence}`;
}
export function parseOperationFailure(
  value: string | undefined,
): OperationFailure | null {
  if (!value) return null;
  try {
    const failure = JSON.parse(value);
    if (!failure || !["permanent", "malformed"].includes(failure.kind))
      return null;
    return {
      kind: failure.kind,
      category: [
        "local_validation",
        "local_corruption",
        "server_rejection",
        "invalid_response",
      ].includes(failure.category)
        ? failure.category
        : undefined,
      at: typeof failure.at === "string" ? failure.at : "",
      // Phase 5 also treated a reused operation UUID (23505) as proof. Old
      // persisted flags must settle the original receipt before replacement.
      definitiveNoCommit:
        failure.definitiveNoCommit === true &&
        failure.rollbackProofVersion === 1,
      ...(failure.rollbackProofVersion === 1
        ? { rollbackProofVersion: 1 }
        : {}),
    };
  } catch {
    return null;
  }
}
export function failureMessage(
  failure: OperationFailure | null,
  submitted: boolean,
): string {
  if (failure?.category === "local_corruption")
    return "A stored change cannot be read safely. Its record and stored request are preserved for recovery.";
  if (!submitted || failure?.category === "local_validation")
    return "A saved change is invalid and has not been sent. Its local record is preserved.";
  if (failure?.definitiveNoCommit)
    return "The cloud rejected this change without saving it. Its local record and original request are preserved.";
  if (failure?.category === "server_rejection")
    return "The cloud rejected this request, but its receipt still needs confirmation. The original request is preserved.";
  return "The cloud has not confirmed this request. Retry its original request before replacing it.";
}
export async function preserveOperationFailure(
  db: StrideDatabase,
  operation: PendingOperation,
  error: SyncError,
  category: FailureCategory,
): Promise<void> {
  const failure: OperationFailure = {
    kind: error.kind === "malformed" ? "malformed" : "permanent",
    category,
    at: new Date().toISOString(),
    definitiveNoCommit: error.definitiveNoCommit,
    ...(error.definitiveNoCommit ? { rollbackProofVersion: 1 } : {}),
  };
  const key = operationErrorKey(operation);
  const copyId = `operation-failure:${key.slice("op_error:".length)}`;
  if (!(await db.recoveryCopies.get(copyId)))
    await db.recoveryCopies.add({
      id: copyId,
      reason: "operation_repair",
      entity: ["subject", "session", "settings"].includes(operation.entity)
        ? operation.entity
        : null,
      record_id:
        typeof operation.record_id === "string" ? operation.record_id : null,
      snapshot: { operation, failure },
      created_at: failure.at,
    });
  await db.syncMetadata.put({ key, value: JSON.stringify(failure) });
}
export function publicSyncError(kind: string): string {
  if (kind === "auth")
    return "Your account session needs attention. Local changes are preserved.";
  if (kind === "transient")
    return "Synchronization could not connect. Local changes remain saved and will retry.";
  if (kind === "malformed")
    return "The cloud returned an unreadable response. Local records and pending requests are preserved.";
  return "Synchronization needs review. Local records and pending changes are preserved.";
}
