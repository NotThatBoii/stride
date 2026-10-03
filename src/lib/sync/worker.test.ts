import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  initialize,
  StrideDatabase,
  type PendingOperation,
} from "../local-database";
import { defaults, type Subject } from "../../models";
import {
  SyncError,
  type ApplyResult,
  type ChangePage,
  type SyncAdapter,
  type WireOperation,
} from "./types";
import { retryDelay, SyncWorker } from "./worker";

const databases: StrideDatabase[] = [];
const workers: SyncWorker[] = [];
const accountId = "11111111-1111-4111-8111-111111111111";
const subject: Subject = {
  id: "math",
  name: "Mathematics",
  description: "",
  icon: "book",
  color: "#123456",
  created_at: "2026-10-03T00:00:00.000Z",
  archived: 0,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
async function setup(adapter: SyncAdapter, guard = () => {}) {
  const db = new StrideDatabase(`worker-${crypto.randomUUID()}`, accountId);
  databases.push(db);
  await initialize(db, null);
  const worker = new SyncWorker(db, adapter, guard);
  workers.push(worker);
  worker.start();
  return { db, worker };
}
const emptyPage: ChangePage = { changes: [], cursor: "0", has_more: false };
function emptyAdapter(): SyncAdapter {
  return {
    changes: vi.fn(async () => emptyPage),
    apply: vi.fn(
      async (op: WireOperation): Promise<ApplyResult> => ({
        status: "applied",
        entity: op.entity,
        record_id: op.record_id,
        action: op.action,
        revision: "1",
        cursor: "1",
      }),
    ),
  };
}
async function waitFor(predicate: () => boolean) {
  await vi.waitFor(() => expect(predicate()).toBe(true), {
    timeout: 1000,
    interval: 10,
  });
}
afterEach(async () => {
  for (const worker of workers.splice(0)) worker.stop();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  for (const db of databases.splice(0)) await db.delete();
});

describe("Synchronization scheduler and lifecycle", () => {
  it("backs off exponentially with bounded jitter and honors server Retry-After", () => {
    expect(retryDelay(0, () => 0)).toBe(1000);
    expect(retryDelay(1, () => 1)).toBe(4000);
    expect(retryDelay(100, () => 1)).toBe(300000);
    expect(retryDelay(0, () => 0, 7000)).toBe(7000);
  });
  it("retries a transient failure only after its scheduled delay then returns to synced", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    vi.spyOn(Math, "random").mockReturnValue(0);
    const adapter = emptyAdapter();
    vi.mocked(adapter.changes).mockRejectedValueOnce(
      new SyncError("Offline", "transient"),
    );
    const { worker } = await setup(adapter);
    expect(await worker.syncNow()).toBe(false);
    expect(worker.getSnapshot()).toMatchObject({
      phase: "offline",
      nextRetryAt: Date.now() + 1000,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(adapter.changes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => worker.getSnapshot().phase === "synced");
    expect(adapter.changes).toHaveBeenCalledTimes(3);
  });
  it("does not let manual retry or timer triggers bypass a server rate-limit deadline", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
    const adapter = emptyAdapter();
    vi.mocked(adapter.changes).mockRejectedValueOnce(
      new SyncError("Rate limited", "transient", 5000),
    );
    const { worker } = await setup(adapter);
    expect(await worker.syncNow()).toBe(false);
    expect(await worker.syncNow()).toBe(false);
    expect(adapter.changes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(4999);
    expect(adapter.changes).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    await waitFor(() => worker.getSnapshot().phase === "synced");
    expect(adapter.changes).toHaveBeenCalledTimes(3);
  });
  it.each(["auth", "malformed"] as const)(
    "pauses %s failures until an explicit retry",
    async (kind) => {
      vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] });
      const adapter = emptyAdapter();
      vi.mocked(adapter.changes).mockRejectedValueOnce(
        new SyncError("Needs attention", kind),
      );
      const { worker } = await setup(adapter);
      expect(await worker.syncNow()).toBe(false);
      await vi.advanceTimersByTimeAsync(60000);
      expect(adapter.changes).toHaveBeenCalledTimes(1);
      expect(worker.getSnapshot().phase).toBe(
        kind === "auth" ? "auth" : "error",
      );
      expect(await worker.syncNow()).toBe(true);
      expect(worker.getSnapshot().phase).toBe("synced");
    },
  );
  it("coalesces simultaneous sync triggers into one run", async () => {
    const response = deferred<ChangePage>();
    const adapter = emptyAdapter();
    vi.mocked(adapter.changes).mockImplementationOnce(() => response.promise);
    const { worker } = await setup(adapter);
    const first = worker.syncNow();
    const second = worker.syncNow();
    expect(first).toBe(second);
    await waitFor(() => vi.mocked(adapter.changes).mock.calls.length === 1);
    response.resolve(emptyPage);
    expect(await first).toBe(true);
    expect(adapter.changes).toHaveBeenCalledTimes(2);
  });
  it("aborts an in-progress pull on stop without committing records, cursors, or success metadata", async () => {
    let receivedSignal: AbortSignal | undefined;
    const adapter = emptyAdapter();
    vi.mocked(adapter.changes).mockImplementation((_after, _limit, signal) => {
      receivedSignal = signal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener(
          "abort",
          () => reject(new SyncError("Stopped", "cancelled")),
          { once: true },
        ),
      );
    });
    const { db, worker } = await setup(adapter);
    const request = worker.syncNow();
    await waitFor(() => receivedSignal !== undefined);
    worker.stop();
    expect(receivedSignal!.aborted).toBe(true);
    expect(await request).toBe(false);
    expect(await db.syncCursors.count()).toBe(0);
    expect(await db.subjects.count()).toBe(0);
    expect(await db.syncMetadata.get("last_successful_sync")).toBeUndefined();
  });
  it("retains a frozen operation when sign-out happens after dispatch and a server acknowledgement arrives late", async () => {
    const response = deferred<ApplyResult>();
    let submitted: WireOperation | undefined;
    let current = true;
    const adapter = emptyAdapter();
    vi.mocked(adapter.apply).mockImplementationOnce((op) => {
      submitted = op;
      return response.promise;
    });
    const { db, worker } = await setup(adapter, () => {
      if (!current) throw new SyncError("Signed out", "cancelled");
    });
    await db.subjects.put(subject);
    const operation: PendingOperation = {
      id: crypto.randomUUID(),
      entity: "subject",
      record_id: subject.id,
      action: "upsert",
      payload: subject,
      base_revision: null,
      status: "pending",
      created_at: subject.created_at,
      updated_at: subject.created_at,
    };
    await db.pendingOperations.add(operation);
    const request = worker.syncNow();
    await waitFor(() => submitted !== undefined);
    current = false;
    worker.stop();
    response.resolve({
      status: "applied",
      entity: "subject",
      record_id: subject.id,
      action: "upsert",
      revision: "1",
      cursor: "1",
    });
    expect(await request).toBe(false);
    const pending = await db.pendingOperations
      .where("id")
      .equals(operation.id)
      .first();
    expect(pending).toMatchObject({
      status: "in_flight",
      wire_request: submitted,
    });
    expect(
      await db.recordRevisions.get(["subject", subject.id]),
    ).toBeUndefined();
    expect(await db.syncMetadata.get("last_successful_sync")).toBeUndefined();
  });
  it("cancels a queued cross-window Web Lock wait on sign-out", async () => {
    let lockSignal: AbortSignal | undefined;
    vi.stubGlobal("navigator", {
      onLine: true,
      locks: {
        request: vi.fn((_name: string, options: LockOptions) => {
          lockSignal = options.signal;
          return new Promise((_resolve, reject) =>
            options.signal?.addEventListener(
              "abort",
              () => reject(new DOMException("Lock wait aborted", "AbortError")),
              { once: true },
            ),
          );
        }),
      },
    });
    const { worker } = await setup(emptyAdapter());
    const exclusive = worker.runExclusive(async () => "unreachable");
    const assertion = expect(exclusive).rejects.toThrow("Lock wait aborted");
    await waitFor(() => lockSignal !== undefined);
    worker.stop();
    expect(lockSignal!.aborted).toBe(true);
    await assertion;
  });
  it("serializes import/resolution work with sync work and rejects stopped lifecycle tasks", async () => {
    const { worker } = await setup(emptyAdapter());
    const release = deferred<void>();
    const entered: string[] = [];
    const first = worker.runExclusive(async (_db, guard) => {
      entered.push("first");
      await release.promise;
      guard();
    });
    const second = worker.runExclusive(async () => {
      entered.push("second");
    });
    await waitFor(() => entered.length === 1);
    worker.stop();
    release.resolve();
    const settled = await Promise.allSettled([first, second]);
    expect(entered).toEqual(["first"]);
    expect(settled.every((result) => result.status === "rejected")).toBe(true);
  });
  it("seeds an existing V2 account cache only after the initial pull without changing IDs or shared/device preferences", async () => {
    const adapter = emptyAdapter();
    const { db, worker } = await setup(adapter);
    await db.subjects.put(subject);
    await db.preferences.put({
      ...defaults,
      theme: "light",
      notifications: true,
      onboarded: true,
      id: 1,
    });
    expect(db.verno).toBe(2);
    expect(await db.pendingOperations.count()).toBe(0);
    expect(await worker.syncNow()).toBe(true);
    const submissions = vi
      .mocked(adapter.apply)
      .mock.calls.map((call) => call[0]);
    expect(submissions[0]).toMatchObject({
      entity: "subject",
      record_id: subject.id,
      payload: subject,
    });
    expect(submissions.find((op) => op.entity === "settings")?.payload).toEqual(
      { minimum: 20, goal: 60, presets: "25,45,60", weekStart: 1 },
    );
    expect(await db.preferences.get(1)).toMatchObject({
      theme: "light",
      notifications: true,
      onboarded: true,
    });
    expect((await db.syncMetadata.get("account_cache_linked"))?.value).toBe(
      "1",
    );
  });
});
