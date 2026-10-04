import { defaults, type Data, type Session } from "../../models";
import {
  enqueueOperation,
  type PendingOperation,
  type RecoveryCopy,
  type StrideDatabase,
  type SyncPayload,
} from "../local-database";
import { activeSegments } from "../timer";
import { validateData } from "../validation";
import {
  assertAccountDatabase,
  hasUnresolvedConflict,
  readLocalVersion,
} from "./conflicts";
import {
  failureMessage,
  operationErrorKey,
  parseOperationFailure,
  publicSyncError,
} from "./failures";
import { normalizeOperation, normalizeRevision } from "./normalization";
import {
  containsRecoveryBlob,
  recoveryFingerprint,
  serializeRecovery,
} from "./recovery-export";
import type { SyncGuard, SyncVersion } from "./types";

export interface RecoveryPreview {
  title: string;
  lines: string[];
}
export interface OperationReview {
  sequence: number;
  title: string;
  status: "pending" | "confirmation" | "conflict" | "failed";
  message: string;
}
export interface RecoveryState {
  pending: number;
  failed: number;
  unresolved: number;
  copies: number;
  operations: OperationReview[];
  preserved: { copy: RecoveryCopy; preview: RecoveryPreview }[];
  lastSynced: string | null;
  lastError: string | null;
}
export interface RepairPlan {
  sequence: number;
  fingerprint: string;
  preview: RecoveryPreview;
  canRebuild: boolean;
  canRetry: boolean;
  message: string;
}
const object = (value: unknown): Record<string, any> | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, any>)
    : null;
const text = (value: unknown, fallback: string): string =>
  typeof value === "string" && value.length ? value : fallback;
const entityValid = (operation: PendingOperation) =>
  ["subject", "session", "settings"].includes(operation.entity) &&
  typeof operation.record_id === "string" &&
  operation.record_id.length > 0 &&
  operation.record_id.length <= 200;

export function previewRecovery(value: unknown, depth = 0): RecoveryPreview {
  if (depth > 3)
    return {
      title: "Preserved study data",
      lines: ["The original stored value is included in recovery exports."],
    };
  const raw = object(value);
  if (!raw)
    return {
      title: "Preserved study data",
      lines: ["The original stored value is included in recovery exports."],
    };
  const data =
    Array.isArray(raw.subjects) && Array.isArray(raw.sessions) ? raw : null;
  if (data)
    return {
      title:
        data.subjects.length === 1
          ? text(data.subjects[0]?.name, "Study history")
          : "Study history",
      lines: [
        `${data.subjects.length} subject${data.subjects.length === 1 ? "" : "s"} · ${data.sessions.length} session${data.sessions.length === 1 ? "" : "s"}`,
        ...(data.running ? ["Includes a paused timer recovery copy."] : []),
      ],
    };
  const candidate =
    object(raw.current) ??
    object(raw.version) ??
    object(raw.local_snapshot) ??
    object(raw.operation) ??
    raw;
  const payload = object(candidate.payload) ?? candidate;
  const session = object(payload.session);
  if (session)
    return {
      title: text(session.session_title, "Study session"),
      lines: [
        text(session.notes, "No notes"),
        ...(Array.isArray(payload.slices)
          ? [
              `Recorded days: ${payload.slices.map((s: unknown) => text(object(s)?.day, "Unreadable day")).join(", ")}`,
            ]
          : []),
      ],
    };
  if (typeof payload.name === "string")
    return {
      title: payload.name || "Subject",
      lines: [text(payload.description, "No description")],
    };
  if (typeof payload.goal === "number")
    return {
      title: "Study preferences",
      lines: [
        `Daily goal: ${payload.goal} min · Minimum day: ${payload.minimum} min`,
      ],
    };
  if (candidate.action === "delete")
    return {
      title: "Deleted study record",
      lines: ["The preserved request records a deletion."],
    };
  const nested = object(raw.conflict)?.context ?? raw.context;
  if (object(nested)?.local_tree)
    return previewRecovery(nested.local_tree, depth + 1);
  return {
    title: "Preserved study data",
    lines: ["Export recovery data to retain every stored field."],
  };
}

export async function readRecoveryState(
  db: StrideDatabase,
  limit = 20,
): Promise<RecoveryState> {
  return db.transaction("r", db.tables, async () => {
    await assertAccountDatabase(db);
    const [pending, metadata, preserved, copies, unresolved] =
      await Promise.all([
        db.pendingOperations.orderBy("sequence").toArray(),
        db.syncMetadata.toArray(),
        db.recoveryCopies
          .orderBy("created_at")
          .reverse()
          .limit(limit)
          .toArray(),
        db.recoveryCopies.count(),
        db.conflicts.filter((c) => !c.resolved_at).count(),
      ]);
    const values = new Map(metadata.map((row) => [row.key, row.value]));
    const failed = pending.filter((op) =>
      values.has(operationErrorKey(op)),
    ).length;
    const ordered = [...pending].sort(
      (a, b) =>
        Number(values.has(operationErrorKey(b))) -
          Number(values.has(operationErrorKey(a))) ||
        (a.sequence ?? 0) - (b.sequence ?? 0),
    );
    const operations: OperationReview[] = [];
    for (const operation of ordered.slice(0, limit)) {
      const saved = values.get(operationErrorKey(operation));
      const submitted =
        operation.status === "in_flight" || !!operation.wire_request;
      const conflict =
        !saved &&
        entityValid(operation) &&
        (await hasUnresolvedConflict(
          db,
          operation.entity,
          operation.record_id,
        ));
      operations.push({
        sequence: operation.sequence!,
        title: previewRecovery(operation).title,
        status: saved
          ? "failed"
          : conflict
            ? "conflict"
            : submitted
              ? "confirmation"
              : "pending",
        message: saved
          ? failureMessage(parseOperationFailure(saved), submitted)
          : conflict
            ? "Resolve the versions above before this change can sync."
            : submitted
              ? "Waiting for the cloud to confirm the original request."
              : "Saved on this device and waiting to sync.",
      });
    }
    let lastError: string | null = null;
    try {
      const error = JSON.parse(values.get("last_sync_error") ?? "null");
      if (error) lastError = publicSyncError(error.kind);
    } catch {
      lastError =
        "The last synchronization could not finish. Local records remain preserved.";
    }
    return {
      pending: pending.length,
      failed,
      unresolved,
      copies,
      operations,
      preserved: preserved.map((copy) => ({
        copy,
        preview: previewRecovery(copy.snapshot),
      })),
      lastSynced: values.get("last_successful_sync") ?? null,
      lastError,
    };
  });
}

export async function createRecoveryExport(
  db: StrideDatabase,
  guard: SyncGuard = () => {},
): Promise<string> {
  const snapshot = await db.transaction("r", db.tables, async () => {
    guard();
    await assertAccountDatabase(db);
    const metadata = (await db.syncMetadata.toArray()).filter(
      (row) =>
        /^(owner_account_id|account_cache_linked|initial_pull_complete|last_successful_sync|last_sync_error|legacy_import_handled|legacy_import_deferred)$/.test(
          row.key,
        ) ||
        row.key.startsWith("op_error:") ||
        row.key.startsWith("import_stage:"),
    );
    const envelope = {
      format: "stride-recovery",
      version: 1,
      exportedAt: new Date().toISOString(),
      accountId: db.accountId,
      // Display indexes omit records with damaged/missing index fields. A
      // recovery export must retain every stored row, including those records.
      workspace: {
        subjects: await db.subjects.toArray(),
        sessions: await db.sessions.toArray(),
        slices: await db.slices.toArray(),
        settings: (await db.preferences.get(1)) ?? { ...defaults },
        running: (await db.timers.get(1))?.value ?? null,
        storedPreferences: await db.preferences.toArray(),
        storedTimers: await db.timers.toArray(),
      },
      synchronization: {
        pendingOperations: await db.pendingOperations.toArray(),
        recordRevisions: await db.recordRevisions.toArray(),
        cursors: await db.syncCursors.toArray(),
        conflicts: await db.conflicts.toArray(),
        recoveryCopies: await db.recoveryCopies.toArray(),
        metadata,
      },
    };
    guard();
    return envelope;
  });
  return serializeRecovery(snapshot, guard);
}

async function planDetails(db: StrideDatabase, sequence: number) {
  const operation = await db.pendingOperations.get(sequence);
  if (!operation)
    throw new Error(
      "This change has already completed. Refresh the recovery review.",
    );
  const chain = entityValid(operation)
    ? await db.pendingOperations
        .where("[entity+record_id]")
        .equals([operation.entity, operation.record_id])
        .sortBy("sequence")
    : [operation];
  const errors = await Promise.all(
    chain.map(async (op) => ({
      key: operationErrorKey(op),
      value: (await db.syncMetadata.get(operationErrorKey(op)))?.value,
    })),
  );
  const failure = parseOperationFailure(
    errors.find((row) => row.key === operationErrorKey(operation))?.value,
  );
  const errorExists = errors.some(
    (row) =>
      row.key === operationErrorKey(operation) && row.value !== undefined,
  );
  const current = entityValid(operation)
    ? await readLocalVersion(db, operation.entity, operation.record_id)
    : null;
  const revision = entityValid(operation)
    ? await db.recordRevisions.get([operation.entity, operation.record_id])
    : undefined;
  let canRebuild = false,
    canRetry = false;
  let message = errorExists
    ? failureMessage(
        failure,
        operation.status === "in_flight" || !!operation.wire_request,
      )
    : "This change is waiting to sync. No repair is needed.";
  let base: string | null = null;
  const conflict =
    entityValid(operation) &&
    (await hasUnresolvedConflict(db, operation.entity, operation.record_id));
  try {
    if (
      operation.wire_request &&
      !failure?.definitiveNoCommit &&
      failure?.category !== "local_corruption"
    ) {
      const frozen = normalizeOperation(operation.wire_request);
      canRetry =
        errorExists &&
        frozen.id === operation.id &&
        frozen.entity === operation.entity &&
        frozen.record_id === operation.record_id &&
        frozen.action === operation.action;
    }
    const safeChain = chain.every(
      (op) =>
        (op.status === "pending" && !op.wire_request) ||
        parseOperationFailure(
          errors.find((row) => row.key === operationErrorKey(op))?.value,
        )?.definitiveNoCommit === true,
    );
    const knownUnsent =
      operation.status === "pending" &&
      !operation.wire_request &&
      failure?.kind === "permanent" &&
      (!failure.category || failure.category === "local_validation");
    if (
      errorExists &&
      (knownUnsent || failure?.definitiveNoCommit) &&
      entityValid(operation) &&
      safeChain &&
      current &&
      !conflict
    ) {
      if (current.action === "delete" && chain.at(-1)?.action !== "delete")
        throw new Error(
          "The local record is missing. Export its preserved request before recovering the history.",
        );
      base = chain[0].wire_request
        ? chain[0].wire_request.base_revision
        : chain[0].base_revision;
      if (base !== null) normalizeRevision(base);
      normalizeOperation({
        id: crypto.randomUUID(),
        entity: operation.entity,
        record_id: operation.record_id,
        ...current,
        base_revision: base,
      });
      if (operation.entity === "session" && current.action === "upsert") {
        const parent = (current.payload as { session: Session }).session
          .subject_id;
        if (!(await db.subjects.get(parent)))
          throw new Error(
            "Recover this session’s subject before rebuilding its change.",
          );
      }
      canRebuild = true;
    }
  } catch (error) {
    message =
      error instanceof Error && !(error.name === "SyncError")
        ? error.message
        : "The current record cannot be rebuilt safely. Export recovery data and inspect the preserved copy.";
  }
  if (conflict) {
    canRebuild = false;
    message =
      "Resolve the record or subject versions above first. Submitted requests must still be confirmed.";
  }
  if (containsRecoveryBlob({ operation, chain, current, revision })) {
    canRebuild = false;
    canRetry = false;
    message =
      "This stored change contains unreadable file data. Export recovery data to preserve its bytes; it cannot be replaced automatically.";
  }
  return {
    operation,
    chain,
    errors,
    current,
    base,
    plan: {
      sequence,
      fingerprint: recoveryFingerprint({
        operation,
        chain,
        errors,
        current,
        revision,
      }),
      preview: previewRecovery(current ?? operation),
      canRebuild,
      canRetry,
      message,
    } satisfies RepairPlan,
  };
}
export async function inspectFailedOperation(
  db: StrideDatabase,
  sequence: number,
  guard: SyncGuard = () => {},
): Promise<RepairPlan> {
  return db.transaction("r", db.tables, async () => {
    guard();
    await assertAccountDatabase(db);
    const { plan } = await planDetails(db, sequence);
    guard();
    return plan;
  });
}
async function checkedPlan(
  db: StrideDatabase,
  plan: RepairPlan,
  guard: SyncGuard,
) {
  guard();
  await assertAccountDatabase(db);
  const details = await planDetails(db, plan.sequence);
  if (details.plan.fingerprint !== plan.fingerprint)
    throw new Error(
      "This change was edited while its backup was being saved. Review it again before continuing.",
    );
  return details;
}
export async function repairFailedOperation(
  db: StrideDatabase,
  plan: RepairPlan,
  guard: SyncGuard = () => {},
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const details = await checkedPlan(db, plan, guard);
    if (!details.plan.canRebuild || !details.current)
      throw new Error(details.plan.message);
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "operation_repair",
      entity: details.operation.entity,
      record_id: details.operation.record_id,
      snapshot: {
        operations: details.chain,
        errors: details.errors,
        current: details.current,
      },
      created_at: new Date().toISOString(),
    });
    await db.pendingOperations.bulkDelete(
      details.chain.map((op) => op.sequence!),
    );
    for (const error of details.errors) await db.syncMetadata.delete(error.key);
    await enqueueOperation(
      db,
      details.operation.entity,
      details.operation.record_id,
      details.current.action,
      details.current.payload as SyncPayload,
      details.base,
    );
    guard();
  });
}
export async function retryFailedOperation(
  db: StrideDatabase,
  plan: RepairPlan,
  guard: SyncGuard = () => {},
): Promise<void> {
  await db.transaction("rw", db.tables, async () => {
    const details = await checkedPlan(db, plan, guard);
    if (!details.plan.canRetry)
      throw new Error(
        "This request cannot be retried safely. Its stored copy remains available for export.",
      );
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "operation_repair",
      entity: details.operation.entity,
      record_id: details.operation.record_id,
      snapshot: {
        operation: details.operation,
        errors: details.errors,
        current: details.current,
      },
      created_at: new Date().toISOString(),
    });
    await db.syncMetadata.delete(operationErrorKey(details.operation));
    guard();
  });
}

export async function inspectRecoveryCopy(
  db: StrideDatabase,
  id: string,
): Promise<{
  copy: RecoveryCopy;
  data: Data | null;
  preview: RecoveryPreview;
}> {
  return db.transaction("r", db.tables, async () => {
    await assertAccountDatabase(db);
    const copy = await db.recoveryCopies.get(id);
    if (!copy) throw new Error("The preserved copy was not found.");
    const raw = object(copy.snapshot);
    const context =
      object(raw?.context) ?? object(object(raw?.conflict)?.context);
    const candidates: unknown[] = [
      raw,
      context?.local_tree,
      context?.incoming_tree,
    ];
    const version =
      object(raw?.version) ??
      object(raw?.current) ??
      object(raw?.local_snapshot) ??
      object(raw?.operation) ??
      raw;
    const payload = object(version?.payload);
    const settings = (await db.preferences.get(1)) ?? { ...defaults };
    if (payload && copy.entity === "subject")
      candidates.push({
        subjects: [payload],
        sessions: raw?.sessions ?? [],
        slices: raw?.slices ?? [],
        settings,
        running:
          raw && raw.running?.subjectId === payload.id ? raw.running : null,
      });
    if (payload && copy.entity === "session" && payload.session) {
      const parent = await db.subjects.get(payload.session.subject_id);
      if (parent)
        candidates.push({
          subjects: [parent],
          sessions: [payload.session],
          slices: payload.slices,
          settings,
          running: null,
        });
    }
    let data: Data | null = null;
    for (const candidate of candidates) {
      try {
        const parsed = validateData(candidate);
        if (parsed.running)
          parsed.running = {
            ...parsed.running,
            segments: activeSegments(
              parsed.running,
              Date.parse(copy.created_at),
            ),
            runningSince: null,
          };
        data = validateData(parsed);
        break;
      } catch {
        /* Raw copies remain available even when no safe study subset can be inferred. */
      }
    }
    return { copy, data, preview: previewRecovery(data ?? copy.snapshot) };
  });
}

export function recoveryStudyBackup(data: Data): string {
  return JSON.stringify(
    {
      format: "stride",
      version: 1,
      exportedAt: new Date().toISOString(),
      ...validateData(data),
    },
    null,
    2,
  );
}
