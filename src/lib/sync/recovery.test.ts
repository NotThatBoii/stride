import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  defaults,
  type Data,
  type Running,
  type Session,
  type Subject,
} from "../../models";
import {
  StrideDatabase,
  initialize,
  enqueueOperation,
  selectWorkspace,
  getActiveDatabase,
  saveSubject,
  saveSession,
  deleteSession,
  saveRunning,
  readData,
  type PendingOperation,
} from "../local-database";
import { stageImport, commitImport } from "./import";
import { preserveConflict, resolveConflict } from "./conflicts";
import {
  createRecoveryExport,
  inspectFailedOperation,
  inspectRecoveryCopy,
  readRecoveryState,
  previewRecovery,
  repairFailedOperation,
  retryFailedOperation,
} from "./recovery";
import { containsRecoveryBlob, serializeRecovery } from "./recovery-export";
import { pushPending } from "./push";
import { operationErrorKey } from "./failures";
import { SyncWorker } from "./worker";
import { SyncError, type SyncAdapter, type WireOperation } from "./types";

const subject: Subject = {
  id: "math",
  name: "Mathematics",
  description: "Original",
  color: "#123456",
  icon: "book",
  archived: 0,
  created_at: "2026-10-01T00:00:00.000Z",
};
const session: Session = {
  id: "study",
  subject_id: subject.id,
  session_title: "Across midnight",
  notes: "Exact recorded days",
  started_at: "2026-10-01T15:50:00.000Z",
  ended_at: "2026-10-01T16:10:00.000Z",
  duration_seconds: 1200,
  mode: "stopwatch",
  completed: 1,
};
const slices = [
  { session_id: session.id, day: "2026-10-01", seconds: 600 },
  { session_id: session.id, day: "2026-10-02", seconds: 600 },
];
const opened: StrideDatabase[] = [];
const workers: SyncWorker[] = [];
const guard = () => {};
async function account(active = false) {
  const id = crypto.randomUUID();
  if (active) selectWorkspace(id);
  const db = active
    ? getActiveDatabase()
    : new StrideDatabase(`recovery-${id}`, id);
  opened.push(db);
  await initialize(db, null);
  await db.subjects.put(subject);
  return db;
}
async function queue(
  db: StrideDatabase,
  entity: PendingOperation["entity"] = "subject",
  record = subject.id,
  payload: PendingOperation["payload"] = subject,
  base: string | null = "2",
) {
  await enqueueOperation(db, entity, record, "upsert", payload, base);
  return (await db.pendingOperations
    .where("[entity+record_id]")
    .equals([entity, record])
    .last())!;
}
async function fail(
  db: StrideDatabase,
  operation: PendingOperation,
  proof = false,
  category = "local_validation",
) {
  await db.syncMetadata.put({
    key: operationErrorKey(operation),
    value: JSON.stringify({
      kind: category === "invalid_response" ? "malformed" : "permanent",
      category,
      at: "2026-10-04T00:00:00.000Z",
      definitiveNoCommit: proof,
      ...(proof ? { rollbackProofVersion: 1 } : {}),
    }),
  });
}
async function freeze(db: StrideDatabase, operation: PendingOperation) {
  const wire: WireOperation = {
    id: operation.id,
    entity: operation.entity,
    record_id: operation.record_id,
    action: operation.action,
    payload: operation.payload,
    base_revision: operation.base_revision,
  };
  const frozen = {
    ...operation,
    status: "in_flight" as const,
    wire_request: wire,
  };
  await db.pendingOperations.put(frozen);
  return frozen;
}
function adapter(capture: WireOperation[] = []): SyncAdapter {
  return {
    changes: async (after) => ({ changes: [], cursor: after, has_more: false }),
    apply: async (wire) => {
      capture.push(wire);
      return {
        status: "applied",
        entity: wire.entity,
        record_id: wire.record_id,
        action: wire.action,
        revision: "10",
        cursor: "10",
      };
    },
  };
}
afterEach(async () => {
  for (const worker of workers.splice(0)) worker.stop();
  vi.restoreAllMocks();
  vi.useRealTimers();
  selectWorkspace(null);
  for (const db of opened.splice(0)) await db.delete();
});

describe("Recovery inspection and safe exports", () => {
  it("inspects oversized corrupt arrays and Sets without exceeding argument limits", () => {
    const values = Array.from({ length: 150000 }, (_, index) => index);
    expect(containsRecoveryBlob(values)).toBe(false);
    expect(
      containsRecoveryBlob(new Set([...values, new Blob(["retained bytes"])])),
    ).toBe(true);
  });
  it("exports the complete account workspace and all sidecars, including resolved copies, without unrelated metadata", async () => {
    const db = await account();
    const other = await account();
    await other.subjects.put({
      ...subject,
      name: "Other account private history",
    });
    const operation = await queue(db);
    await fail(db, operation);
    await db.recoveryCopies.add({
      id: "copy",
      entity: "subject",
      record_id: subject.id,
      reason: "conflict",
      snapshot: { ...subject, name: "Earlier preserved version" },
      created_at: subject.created_at,
    });
    await db.conflicts.put({
      id: "resolved",
      entity: "subject",
      record_id: subject.id,
      local_snapshot: subject,
      remote_snapshot: subject,
      base_revision: null,
      remote_revision: "1",
      created_at: subject.created_at,
      resolved_at: subject.created_at,
    });
    await db.syncMetadata.put({
      key: "access_token",
      value: "must-not-export",
    });
    await db.syncMetadata.put({
      key: "arbitrary_diagnostic",
      value: "must-not-export",
    });
    const text = await createRecoveryExport(db);
    const result = JSON.parse(text);
    expect(result.format).toBe("stride-recovery");
    expect(result.workspace.subjects).toEqual([subject]);
    expect(result.synchronization.pendingOperations).toHaveLength(1);
    expect(result.synchronization.recoveryCopies).toHaveLength(1);
    expect(result.synchronization.conflicts[0].resolved_at).toBe(
      subject.created_at,
    );
    expect(text).not.toContain("must-not-export");
    expect(text).not.toContain("Other account private history");
    expect(await db.recoveryCopies.count()).toBe(1);
  });
  it("exports corrupted BigInt, cycles, Maps, binary and Blob values while preserving the original requests", async () => {
    const db = await account();
    const corrupted: Record<string, unknown> = {
      count: 12345678901234567890n,
      nan: NaN,
      bytes: new Uint8Array([0, 127, 255]),
      blob: new Blob(["saved bytes"], { type: "text/plain" }),
    };
    corrupted.self = corrupted;
    corrupted.map = new Map([["key", corrupted]]);
    const operation = {
      ...(await queue(db)),
      payload: corrupted as unknown as PendingOperation["payload"],
    };
    await db.pendingOperations.put(operation);
    await pushPending(db, adapter(), guard);
    const exported = JSON.parse(await createRecoveryExport(db));
    const payload = exported.synchronization.pendingOperations[0].payload;
    expect(payload.count.$strideRecovery).toEqual({
      type: "bigint",
      value: "12345678901234567890",
    });
    expect(payload.self.$strideRecovery.type).toBe("reference");
    expect(payload.bytes.$strideRecovery.buffer.$strideRecovery.base64).toBe(
      "AH//",
    );
    expect(payload.blob.$strideRecovery.base64).toBe(btoa("saved bytes"));
    expect(payload.map.$strideRecovery.type).toBe("map");
    expect(
      (await db.pendingOperations.get(operation.sequence!))!.payload,
    ).toMatchObject({ count: 12345678901234567890n });
    expect(await db.recoveryCopies.count()).toBe(1);
  });
  it("retains damaged rows omitted by display indexes and every stored preference and timer row", async () => {
    const db = await account();
    await db.subjects.put({
      id: "damaged-subject",
      name: "Keep this subject",
    } as Subject);
    await db.sessions.put({
      id: "damaged-session",
      notes: "Keep these notes",
    } as Session);
    await db.preferences.put({
      id: 2,
      goal: "Damaged secondary preferences",
    } as any);
    await db.timers.put({
      id: 2,
      value: { title: "Damaged secondary timer" },
    } as any);
    await db.recoveryCopies.add({
      id: "damaged-copy",
      snapshot: { notes: "Keep this copy" },
    } as any);
    const visible = await readData(db);
    expect(visible.subjects.some((row) => row.id === "damaged-subject")).toBe(
      false,
    );
    expect(visible.sessions).toHaveLength(0);
    const exported = JSON.parse(await createRecoveryExport(db));
    expect(exported.workspace.subjects).toContainEqual({
      id: "damaged-subject",
      name: "Keep this subject",
    });
    expect(exported.workspace.sessions).toEqual([
      { id: "damaged-session", notes: "Keep these notes" },
    ]);
    expect(exported.workspace.storedPreferences).toContainEqual({
      id: 2,
      goal: "Damaged secondary preferences",
    });
    expect(exported.workspace.storedTimers).toEqual([
      { id: 2, value: { title: "Damaged secondary timer" } },
    ]);
    expect(exported.synchronization.recoveryCopies).toEqual([
      { id: "damaged-copy", snapshot: { notes: "Keep this copy" } },
    ]);
  });
  it("bounds cyclic preserved-copy previews while keeping the complete cyclic value exportable", async () => {
    const db = await account();
    const cyclic: any = { context: {} };
    cyclic.context.local_tree = cyclic;
    expect(previewRecovery(cyclic).title).toBe("Preserved study data");
    await db.recoveryCopies.add({
      id: "cycle",
      reason: "conflict",
      entity: null,
      record_id: null,
      snapshot: cyclic,
      created_at: subject.created_at,
    });
    expect((await readRecoveryState(db)).preserved[0].preview.title).toBe(
      "Preserved study data",
    );
    expect((await inspectRecoveryCopy(db, "cycle")).data).toBeNull();
    const exported = JSON.parse(await createRecoveryExport(db));
    expect(
      exported.synchronization.recoveryCopies[0].snapshot.context.local_tree
        .$strideRecovery.type,
    ).toBe("reference");
  });
  it("preserves Error details, custom properties and cyclic causes in diagnostic exports", async () => {
    const error = new Error("Retain the original damaged value");
    error.cause = error;
    Object.assign(error, { studyNote: "Retain custom properties" });
    const exported = JSON.parse(await serializeRecovery({ error }));
    expect(exported.error.$strideRecovery).toMatchObject({
      type: "error",
      name: "Error",
      message: error.message,
      stack: error.stack,
      cause: { $strideRecovery: { type: "reference", path: "#/error" } },
      properties: { studyNote: "Retain custom properties" },
    });
  });
  it("never sends, retries or rebuilds a frozen request containing Blob data", async () => {
    const db = await account();
    const original = await freeze(db, await queue(db));
    original.wire_request!.payload = {
      ...(original.wire_request!.payload as Subject),
      file: new Blob(["original file bytes"]),
    } as Subject;
    await db.pendingOperations.put(original);
    const sent: WireOperation[] = [];
    await pushPending(db, adapter(sent), guard);
    expect(sent).toHaveLength(0);
    const plan = await inspectFailedOperation(db, original.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.canRetry).toBe(false);
    await expect(repairFailedOperation(db, plan)).rejects.toThrow("file data");
    await expect(retryFailedOperation(db, plan)).rejects.toThrow(
      "cannot be retried safely",
    );
    const exported = JSON.parse(await createRecoveryExport(db));
    expect(
      exported.synchronization.pendingOperations[0].wire_request.payload.file
        .$strideRecovery.base64,
    ).toBe(btoa("original file bytes"));
    expect(await db.pendingOperations.get(original.sequence!)).toEqual(
      original,
    );
    expect(await db.subjects.get(subject.id)).toEqual(subject);
  });
  it("refuses a mismatched owner and aborts export when the account guard changes", async () => {
    const db = await account();
    await db.syncMetadata.put({
      key: "owner_account_id",
      value: crypto.randomUUID(),
    });
    await expect(createRecoveryExport(db)).rejects.toThrow("belong");
    await db.syncMetadata.put({
      key: "owner_account_id",
      value: db.accountId!,
    });
    let calls = 0;
    await expect(
      createRecoveryExport(db, () => {
        if (++calls === 3) throw new Error("Account changed");
      }),
    ).rejects.toThrow("Account changed");
    expect(await db.subjects.count()).toBe(1);
  });
  it("pages preserved copies and derives only validated importable history", async () => {
    const db = await account();
    for (let i = 0; i < 25; i++)
      await db.recoveryCopies.add({
        id: String(i),
        reason: "local_delete",
        entity: "session",
        record_id: session.id,
        created_at: `2026-10-${String(i + 1).padStart(2, "0")}T00:00:00.000Z`,
        snapshot: {
          subjects: [subject],
          sessions: [session],
          slices,
          settings: defaults,
          running: null,
        } satisfies Data,
      });
    const state = await readRecoveryState(db);
    expect(state.copies).toBe(25);
    expect(state.preserved).toHaveLength(20);
    const inspected = await inspectRecoveryCopy(db, "24");
    expect(inspected.data?.slices).toEqual(slices);
    await db.recoveryCopies.add({
      id: "invalid",
      reason: "conflict",
      entity: null,
      record_id: null,
      created_at: subject.created_at,
      snapshot: {
        subjects: [subject],
        sessions: [session],
        slices: [],
        settings: defaults,
        running: null,
      },
    });
    expect((await inspectRecoveryCopy(db, "invalid")).data).toBeNull();
    expect(await db.recoveryCopies.count()).toBe(26);
  });
});

describe("Guarded repair and exact submitted retries", () => {
  it("requires receipt confirmation for a legacy unversioned rollback flag before any replacement", async () => {
    const db = await account();
    const original = await freeze(db, await queue(db));
    await db.syncMetadata.put({
      key: operationErrorKey(original),
      value: JSON.stringify({ kind: "permanent", definitiveNoCommit: true }),
    });
    const plan = await inspectFailedOperation(db, original.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.canRetry).toBe(true);
    await expect(repairFailedOperation(db, plan)).rejects.toThrow(
      "not confirmed",
    );
    const conflict = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Cloud version" },
        },
        base_revision: "2",
        remote_revision: "3",
        source: "pull",
      }),
    );
    await expect(resolveConflict(db, conflict.id, "remote")).rejects.toThrow(
      "confirm",
    );
    expect(await db.pendingOperations.get(original.sequence!)).toEqual(
      original,
    );
    expect(await db.subjects.get(subject.id)).toEqual(subject);
    await retryFailedOperation(
      db,
      await inspectFailedOperation(db, original.sequence!),
    );
    const sent: WireOperation[] = [];
    await pushPending(db, adapter(sent), guard);
    expect(sent[0]).toEqual(original.wire_request);
    expect(await db.pendingOperations.count()).toBe(0);
    expect(
      (await db.recoveryCopies.toArray()).some((copy) =>
        JSON.stringify(copy.snapshot).includes(original.id),
      ),
    ).toBe(true);
  });
  it("retains an original frozen null base when a damaged separate base field differs", async () => {
    const db = await account();
    const original = await freeze(
      db,
      await queue(db, "subject", subject.id, subject, null),
    );
    original.base_revision = "9";
    await db.pendingOperations.put(original);
    await fail(db, original, true, "server_rejection");
    const plan = await inspectFailedOperation(db, original.sequence!);
    expect(plan.canRebuild).toBe(true);
    await repairFailedOperation(db, plan);
    expect((await db.pendingOperations.toArray())[0].base_revision).toBeNull();
    expect((await db.recoveryCopies.toArray())[0].snapshot).toMatchObject({
      operations: [original],
    });
  });
  it("rebuilds invalid unsent data from the latest record with a fresh UUID and the original base", async () => {
    const db = await account();
    const operation = await queue(db, "subject", subject.id, {
      ...subject,
      name: "",
    });
    await fail(db, operation);
    await db.subjects.put({ ...subject, name: "Latest valid edit" });
    await db.recordRevisions.put({
      entity: "subject",
      record_id: subject.id,
      server_revision: "9",
      updated_at: subject.created_at,
    });
    const plan = await inspectFailedOperation(db, operation.sequence!);
    expect(plan.canRebuild).toBe(true);
    await repairFailedOperation(db, plan);
    const replacement = (await db.pendingOperations.toArray())[0];
    expect(replacement.id).not.toBe(operation.id);
    expect(replacement.base_revision).toBe("2");
    expect(replacement.payload).toMatchObject({ name: "Latest valid edit" });
    expect(
      await db.syncMetadata.get(operationErrorKey(operation)),
    ).toBeUndefined();
    expect((await db.recoveryCopies.toArray())[0].snapshot).toMatchObject({
      operations: [operation],
    });
    const sent: WireOperation[] = [];
    await pushPending(db, adapter(sent), guard);
    expect(sent[0].base_revision).toBe("2");
  });
  it("preserves exact recorded days and current session notes during repair", async () => {
    const db = await account();
    await db.sessions.put(session);
    await db.slices.bulkPut(slices);
    const operation = await queue(db, "session", session.id, {
      session,
      slices: [],
    });
    await fail(db, operation);
    await db.sessions.put({ ...session, notes: "Latest notes after review" });
    await repairFailedOperation(
      db,
      await inspectFailedOperation(db, operation.sequence!),
    );
    const replacement = (await db.pendingOperations.toArray())[0];
    expect(replacement.payload).toEqual({
      session: { ...session, notes: "Latest notes after review" },
      slices,
    });
    expect((await readData(db)).slices).toEqual(slices);
  });
  it("supersedes a proven rollback and its unsent successor while retaining unrelated failure state", async () => {
    const db = await account();
    const original = await freeze(db, await queue(db));
    await fail(db, original, true, "server_rejection");
    await db.subjects.put({ ...subject, description: "Newest edit" });
    await queue(db, "subject", subject.id, {
      ...subject,
      description: "Newest edit",
    });
    const unrelated = await queue(db, "subject", "other", {
      ...subject,
      id: "other",
    });
    await fail(db, unrelated);
    const plan = await inspectFailedOperation(db, original.sequence!);
    expect(plan.canRebuild).toBe(true);
    expect(plan.canRetry).toBe(false);
    await repairFailedOperation(db, plan);
    const operations = await db.pendingOperations.toArray();
    expect(operations).toHaveLength(2);
    expect(operations.find((op) => op.record_id === subject.id)).toMatchObject({
      base_revision: "2",
      payload: { description: "Newest edit" },
      status: "pending",
    });
    expect((await db.recoveryCopies.toArray())[0].snapshot).toMatchObject({
      operations: [original, expect.objectContaining({ action: "upsert" })],
    });
    expect(
      await db.syncMetadata.get(operationErrorKey(unrelated)),
    ).toBeDefined();
  });
  it("retries an uncertain malformed response using the exact frozen UUID and body without rebuilding", async () => {
    const db = await account();
    const original = await freeze(db, await queue(db));
    await fail(db, original, false, "invalid_response");
    await db.subjects.put({ ...subject, description: "Later local edit" });
    await queue(db, "subject", subject.id, {
      ...subject,
      description: "Later local edit",
    });
    const plan = await inspectFailedOperation(db, original.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.canRetry).toBe(true);
    await expect(repairFailedOperation(db, plan)).rejects.toThrow(
      "not confirmed",
    );
    await retryFailedOperation(db, plan);
    expect(await db.pendingOperations.get(original.sequence!)).toEqual(
      original,
    );
    const sent: WireOperation[] = [];
    await pushPending(db, adapter(sent), guard);
    expect(sent[0]).toEqual(original.wire_request);
    expect(sent[1].id).not.toBe(original.id);
    expect(sent[1].payload).toMatchObject({ description: "Later local edit" });
    expect(await db.recoveryCopies.count()).toBe(1);
  });
  it("refuses to replace a successor while its predecessor has an uncertain receipt", async () => {
    const db = await account();
    const first = await freeze(db, await queue(db));
    const latest = await queue(db, "subject", subject.id, {
      ...subject,
      name: "",
    });
    await fail(db, latest);
    const plan = await inspectFailedOperation(db, latest.sequence!);
    expect(plan.canRebuild).toBe(false);
    await expect(repairFailedOperation(db, plan)).rejects.toThrow();
    expect(await db.pendingOperations.get(first.sequence!)).toEqual(first);
    expect(await db.pendingOperations.count()).toBe(2);
  });
  it("does not infer deletion from a missing failed upsert", async () => {
    const db = await account();
    const operation = await queue(db);
    await fail(db, operation);
    await db.subjects.delete(subject.id);
    const plan = await inspectFailedOperation(db, operation.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.message).toContain("missing");
    await expect(repairFailedOperation(db, plan)).rejects.toThrow("missing");
    expect(await db.pendingOperations.count()).toBe(1);
  });
  it("honors an explicit latest deletion after a rejected upsert", async () => {
    const db = await account();
    const operation = await freeze(db, await queue(db));
    await fail(db, operation, true, "server_rejection");
    await db.subjects.delete(subject.id);
    await enqueueOperation(db, "subject", subject.id, "delete", null);
    await repairFailedOperation(
      db,
      await inspectFailedOperation(db, operation.sequence!),
    );
    expect((await db.pendingOperations.toArray())[0]).toMatchObject({
      action: "delete",
      payload: null,
      base_revision: "2",
      status: "pending",
    });
  });
  it("requires conflict resolution before rebuilding and keeps all versions", async () => {
    const db = await account();
    const operation = await queue(db);
    await fail(db, operation);
    await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Cloud version" },
        },
        base_revision: "2",
        remote_revision: "3",
        source: "pull",
      }),
    );
    const plan = await inspectFailedOperation(db, operation.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.message).toContain("Resolve");
    await expect(repairFailedOperation(db, plan)).rejects.toThrow("Resolve");
    expect(await db.conflicts.count()).toBe(1);
    expect(await db.pendingOperations.count()).toBe(1);
  });
  it("rejects a changed review after export without touching either version", async () => {
    const db = await account();
    const operation = await queue(db);
    await fail(db, operation);
    const plan = await inspectFailedOperation(db, operation.sequence!);
    await createRecoveryExport(db);
    await db.subjects.put({ ...subject, name: "Edited during file dialog" });
    await expect(repairFailedOperation(db, plan)).rejects.toThrow("edited");
    expect(await db.pendingOperations.get(operation.sequence!)).toEqual(
      operation,
    );
    expect(await db.recoveryCopies.count()).toBe(0);
  });
  it("rolls back replacement, quarantine removal and recovery writes on sign-out during repair", async () => {
    const db = await account();
    const operation = await queue(db);
    await fail(db, operation);
    const plan = await inspectFailedOperation(db, operation.sequence!);
    let calls = 0;
    await expect(
      repairFailedOperation(db, plan, () => {
        if (++calls === 2) throw new Error("Signed out");
      }),
    ).rejects.toThrow("Signed out");
    expect(await db.pendingOperations.get(operation.sequence!)).toEqual(
      operation,
    );
    expect(
      await db.syncMetadata.get(operationErrorKey(operation)),
    ).toBeDefined();
    expect(await db.recoveryCopies.count()).toBe(0);
  });
});

describe("Deletion, timer discard and corrupted queue boundaries", () => {
  it("preserves deleted sessions with exact allocations and can import the preserved history additively", async () => {
    const db = await account(true);
    await saveSession(session, slices);
    await deleteSession(session.id);
    const copy = (await db.recoveryCopies.toArray())[0];
    expect(copy.reason).toBe("local_delete");
    const preserved = (await inspectRecoveryCopy(db, copy.id)).data!;
    expect(preserved.sessions).toEqual([session]);
    expect(preserved.slices).toEqual(slices);
    const stage = await stageImport(db, preserved, "backup");
    await commitImport(db, stage.id);
    const conflict = (await db.conflicts.toArray()).find(
      (c) => c.entity === "session",
    )!;
    await resolveConflict(db, conflict.id, "remote");
    expect((await readData(db)).sessions).toEqual([session]);
    expect((await readData(db)).slices).toEqual(slices);
    expect(await db.recoveryCopies.get(copy.id)).toBeDefined();
  });
  it("rolls back a session deletion if its recovery copy cannot be stored", async () => {
    const db = await account(true);
    await saveSession(session, slices);
    const before = await db.pendingOperations.toArray();
    const crash = () => {
      throw new Error("Storage full");
    };
    db.recoveryCopies.hook("creating", crash);
    await expect(deleteSession(session.id)).rejects.toThrow("Storage full");
    db.recoveryCopies.hook("creating").unsubscribe(crash);
    expect((await readData(db)).sessions).toEqual([session]);
    expect((await readData(db)).slices).toEqual(slices);
    expect(await db.pendingOperations.toArray()).toEqual(before);
  });
  it("stores a paused discarded timer at discard time and never adds a synced timer operation", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const at = Date.parse("2026-10-04T10:00:40.000Z");
    vi.setSystemTime(at);
    const db = await account(true);
    const timer: Running = {
      id: "timer",
      subjectId: subject.id,
      startedAt: "2026-10-04T10:00:00.000Z",
      title: "Unsaved progress",
      mode: "stopwatch",
      target: 1500,
      segments: [],
      runningSince: at - 40000,
      notified: false,
    };
    await saveRunning(timer);
    await saveRunning(null);
    const copy = (await db.recoveryCopies.toArray())[0];
    expect(copy.reason).toBe("timer_discard");
    vi.setSystemTime(at + 86400000);
    db.close();
    await db.open();
    const data = (await inspectRecoveryCopy(db, copy.id)).data!;
    expect(data.running?.runningSince).toBeNull();
    expect(data.running?.segments).toEqual([{ start: at - 40000, end: at }]);
    expect((copy.snapshot as any).discarded_timer).toEqual(timer);
    expect((await readData(db)).running).toBeNull();
    expect(await db.pendingOperations.count()).toBe(0);
    await saveRunning(null);
    expect(await db.recoveryCopies.count()).toBe(1);
  });
  it("completes the timer into a session without creating a duplicate discard copy", async () => {
    const db = await account(true);
    await saveRunning({
      id: session.id,
      subjectId: subject.id,
      startedAt: session.started_at,
      title: "",
      mode: "stopwatch",
      target: 1500,
      segments: [
        {
          start: Date.parse(session.started_at),
          end: Date.parse(session.ended_at),
        },
      ],
      runningSince: null,
      notified: false,
    });
    await saveSession(session, slices);
    await saveRunning(null);
    expect(await db.recoveryCopies.count()).toBe(0);
    expect((await readData(db)).sessions).toEqual([session]);
  });
  it("quarantines malformed headers before IndexedDB key queries and lets unrelated valid records sync", async () => {
    const db = await account();
    const invalid = {
      status: "pending",
      entity: undefined,
      record_id: null,
      action: "upsert",
      payload: 5n,
      base_revision: null,
      created_at: subject.created_at,
      updated_at: subject.created_at,
    } as unknown as PendingOperation;
    const sequence = await db.pendingOperations.add(invalid);
    await queue(db, "subject", "other", { ...subject, id: "other" });
    const sent: WireOperation[] = [];
    expect((await pushPending(db, adapter(sent), guard)).applied).toBe(1);
    expect(sent[0].record_id).toBe("other");
    const failed = (await db.pendingOperations.get(sequence))!;
    expect(await db.syncMetadata.get(operationErrorKey(failed))).toBeDefined();
    expect((await readRecoveryState(db)).failed).toBe(1);
    expect(await createRecoveryExport(db)).toContain('"value": "5"');
  });
  it("never rebuilds or retries a corrupt frozen request", async () => {
    const db = await account();
    const frozen = await freeze(db, await queue(db));
    frozen.wire_request!.entity = null as any;
    await db.pendingOperations.put(frozen);
    await pushPending(db, adapter(), guard);
    const plan = await inspectFailedOperation(db, frozen.sequence!);
    expect(plan.canRebuild).toBe(false);
    expect(plan.canRetry).toBe(false);
    expect(await db.pendingOperations.get(frozen.sequence!)).toEqual(frozen);
  });
  it("treats a pending status with a frozen request as submitted during conflict resolution", async () => {
    const db = await account();
    const frozen = await freeze(db, await queue(db));
    await db.pendingOperations.put({ ...frozen, status: "pending" });
    const conflict = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Cloud" },
        },
        base_revision: "2",
        remote_revision: "3",
        source: "pull",
      }),
    );
    await expect(resolveConflict(db, conflict.id, "remote")).rejects.toThrow(
      "confirm",
    );
    expect(await db.pendingOperations.count()).toBe(1);
  });
  it("keeps permanent validation failures quarantined across manual and automatic sync cycles", async () => {
    const db = await account();
    await db.syncMetadata.put({ key: "account_cache_linked", value: "1" });
    await queue(db, "subject", subject.id, { ...subject, name: "" });
    const sent: WireOperation[] = [];
    const worker = new SyncWorker(db, adapter(sent), guard);
    workers.push(worker);
    worker.start();
    expect(await worker.syncNow()).toBe(true);
    expect(await worker.syncNow()).toBe(true);
    expect(await worker.syncNow(false)).toBe(true);
    expect(sent).toHaveLength(0);
    expect((await readRecoveryState(db)).failed).toBe(1);
    expect(await db.recoveryCopies.count()).toBe(1);
  });
  it("persists a safe error summary across restart without retaining raw credentials from an error", async () => {
    const db = await account();
    const gateway = adapter();
    gateway.changes = async () => {
      throw new SyncError("Bearer private-test-value", "malformed");
    };
    const worker = new SyncWorker(db, gateway, guard);
    workers.push(worker);
    worker.start();
    expect(await worker.syncNow()).toBe(false);
    expect(worker.getSnapshot().error).not.toContain("private-test-value");
    worker.stop();
    expect((await readRecoveryState(db)).lastError).toContain("unreadable");
    expect(await createRecoveryExport(db)).not.toContain("private-test-value");
  });
});
