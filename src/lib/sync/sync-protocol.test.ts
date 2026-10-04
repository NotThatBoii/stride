import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { defaults, type Session, type Subject } from "../../models";
import {
  initialize,
  StrideDatabase,
  type PendingOperation,
} from "../local-database";
import {
  createSyncAdapter,
  parseApplyResult,
  parseChangePage,
  retryAfterMilliseconds,
  syncAwareFetch,
} from "./client";
import { resolveConflict } from "./conflicts";
import {
  compareRevision,
  equivalentPayload,
  normalizeOperation,
  normalizePayload,
  normalizeRevision,
} from "./normalization";
import { pullChanges, SYNC_STREAM } from "./pull";
import { pushPending } from "./push";
import {
  SyncError,
  type ApplyResult,
  type ChangePage,
  type SyncAdapter,
  type SyncChange,
  type WireOperation,
} from "./types";

const subject: Subject = {
  id: "math",
  name: "Mathematics",
  description: "",
  icon: "book",
  color: "#123456",
  created_at: "2026-09-21T10:00:00.000Z",
  archived: 0,
};
const session: Session = {
  id: "session-one",
  subject_id: subject.id,
  started_at: "2026-09-21T10:00:00.000Z",
  ended_at: "2026-09-21T10:20:00.000Z",
  duration_seconds: 1200,
  session_title: "Practice",
  notes: "",
  mode: "stopwatch",
  completed: 1,
};
const sessionPayload = {
  session,
  slices: [{ session_id: session.id, day: "2026-09-22", seconds: 1200 }],
};
const opened: StrideDatabase[] = [];
const guard = () => {};
async function device(account = "11111111-1111-4111-8111-111111111111") {
  const db = new StrideDatabase(`protocol-${crypto.randomUUID()}`, account);
  opened.push(db);
  await initialize(db, null);
  return db;
}
function operation(
  payload: WireOperation["payload"] = subject,
  entity: WireOperation["entity"] = "subject",
  id = subject.id,
): PendingOperation {
  return {
    id: crypto.randomUUID(),
    entity,
    record_id: id,
    action: payload === null ? "delete" : "upsert",
    payload: payload as PendingOperation["payload"],
    base_revision: null,
    status: "pending",
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };
}
async function queue(db: StrideDatabase, op: PendingOperation) {
  op.sequence = await db.pendingOperations.add(op);
  if (op.action === "upsert" && op.entity === "subject")
    await db.subjects.put(op.payload as Subject);
  if (op.action === "upsert" && op.entity === "session") {
    const payload = op.payload as typeof sessionPayload;
    await db.sessions.put(payload.session);
    await db.slices.bulkPut(payload.slices);
  }
  return op;
}
function change(
  revision = "1",
  payload: SyncChange["payload"] = subject,
  entity: SyncChange["entity"] = "subject",
  id = subject.id,
): SyncChange {
  return {
    sequence: revision,
    revision,
    entity,
    record_id: id,
    action: payload === null ? "delete" : "upsert",
    payload,
    operation_id: crypto.randomUUID(),
  };
}
function adapterFrom(
  changes: SyncChange[],
  apply?: SyncAdapter["apply"],
): SyncAdapter {
  return {
    apply:
      apply ??
      (async (op) => ({
        status: "applied",
        entity: op.entity,
        record_id: op.record_id,
        action: op.action,
        revision: "1",
        cursor: "1",
      })),
    async changes(after, limit) {
      const remaining = changes.filter(
        (c) => compareRevision(c.sequence, after) > 0,
      );
      const page = remaining.slice(0, limit);
      return {
        changes: page,
        cursor: page.at(-1)?.sequence ?? after,
        has_more: remaining.length > page.length,
      };
    },
  };
}
afterEach(async () => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  for (const db of opened.splice(0)) await db.delete();
});

describe("Phase 3 wire normalization and validation", () => {
  it("retains exact recorded calendar allocation days while canonicalizing timestamps", () => {
    const value = normalizePayload("session", {
      ...sessionPayload,
      session: {
        ...session,
        started_at: "2026-09-21T18:00:00+08:00",
        ended_at: "2026-09-21T18:20:00+08:00",
      },
    }) as typeof sessionPayload;
    expect(value.session.started_at).toBe(session.started_at);
    expect(value.slices).toEqual(sessionPayload.slices);
  });
  it("compares timestamp instants and slice ordering instead of raw strings", () => {
    expect(
      equivalentPayload("subject", subject, {
        ...subject,
        created_at: "2026-09-21T18:00:00+08:00",
      }),
    ).toBe(true);
    expect(
      equivalentPayload("subject", subject, { ...subject, name: "Physics" }),
    ).toBe(false);
  });
  it("normalizes legacy offset-less timestamps using the original local instant", () => {
    const legacy = { ...subject, created_at: "2026-09-21T10:00:00" };
    expect((normalizePayload("subject", legacy) as Subject).created_at).toBe(
      new Date(legacy.created_at).toISOString(),
    );
  });
  it("projects only shared preferences and canonicalizes locally valid numeric preset strings", () => {
    expect(
      normalizePayload("settings", { ...defaults, presets: "2.5e1, 045,60" }),
    ).toEqual({ minimum: 20, goal: 60, presets: "25,45,60", weekStart: 1 });
    expect(
      equivalentPayload("settings", defaults, {
        ...defaults,
        theme: "light",
        onboarded: true,
        notifications: true,
      }),
    ).toBe(true);
  });
  it("keeps PostgreSQL bigint revisions exact beyond JavaScript number precision", () => {
    expect(normalizeRevision("9007199254740993")).toBe("9007199254740993");
    expect(compareRevision("9007199254740993", "9007199254740992")).toBe(1);
    expect(() => normalizeRevision(9007199254740993)).toThrow();
    expect(() => normalizeRevision("9223372036854775808")).toThrow();
    expect(() => normalizeRevision("01")).toThrow();
  });
  it("rejects unsafe payload identity, duplicate allocation days, and malformed acknowledgements", () => {
    expect(() =>
      normalizeOperation({ ...operation(), record_id: "another" }),
    ).toThrow();
    expect(() =>
      normalizePayload("session", {
        ...sessionPayload,
        slices: [...sessionPayload.slices, ...sessionPayload.slices],
      }),
    ).toThrow();
    const op = normalizeOperation(operation());
    expect(() =>
      parseApplyResult(
        {
          status: "applied",
          entity: "subject",
          record_id: "another",
          action: "upsert",
          revision: "1",
          cursor: "1",
        },
        op,
      ),
    ).toThrow();
  });
  it("rejects unordered, oversized, empty-more, and cursor-skipping pages", () => {
    expect(() =>
      parseChangePage(
        { changes: [change("2"), change("1")], cursor: "1", has_more: false },
        "0",
        100,
      ),
    ).toThrow();
    expect(() =>
      parseChangePage(
        { changes: [change()], cursor: "2", has_more: false },
        "0",
        100,
      ),
    ).toThrow();
    expect(() =>
      parseChangePage(
        { changes: [change("2")], cursor: "2", has_more: false },
        "0",
        100,
      ),
    ).toThrow();
    expect(() =>
      parseChangePage({ changes: [], cursor: "0", has_more: true }, "0", 100),
    ).toThrow();
    expect(() =>
      parseChangePage(
        { changes: [change(), change("2")], cursor: "2", has_more: false },
        "0",
        1,
      ),
    ).toThrow();
  });
});

describe("Outbox and transactional pull integrity", () => {
  it("claims a normalized immutable request before dispatch and retries after lost acknowledgement with the same ID and contents", async () => {
    const db = await device();
    const op = await queue(
      db,
      operation({ ...subject, created_at: "2026-09-21T10:00:00" }),
    );
    const received: WireOperation[] = [];
    const adapter = adapterFrom([], async (wire) => {
      received.push(structuredClone(wire));
      if (received.length === 1)
        throw new SyncError("Acknowledgement lost", "transient");
      return {
        status: "applied",
        entity: wire.entity,
        record_id: wire.record_id,
        action: wire.action,
        revision: "1",
        cursor: "1",
      };
    });
    await expect(pushPending(db, adapter, guard)).rejects.toThrow(
      "Acknowledgement lost",
    );
    expect((await db.pendingOperations.get(op.sequence!))?.status).toBe(
      "in_flight",
    );
    await pushPending(db, adapter, guard);
    expect(received[0]).toEqual(received[1]);
    expect(received[0].id).toBe(op.id);
    expect(await db.pendingOperations.count()).toBe(0);
    expect(await db.syncCursors.get(SYNC_STREAM)).toBeUndefined();
  });
  it("rebases only unsent successors after acknowledgement without losing newer local edits", async () => {
    const db = await device();
    const first = await queue(db, operation());
    const adapter = adapterFrom([], async (wire) => {
      if (wire.id === first.id)
        await queue(db, operation({ ...subject, name: "Newer edit" }));
      return {
        status: "applied",
        entity: wire.entity,
        record_id: wire.record_id,
        action: wire.action,
        revision: wire.id === first.id ? "1" : "2",
        cursor: wire.id === first.id ? "1" : "2",
      };
    });
    await pushPending(db, adapter, guard, { limit: 1 });
    const [next] = await db.pendingOperations.toArray();
    expect(next.base_revision).toBe("1");
    expect(next.status).toBe("pending");
    expect((await db.subjects.get(subject.id))?.name).toBe("Newer edit");
  });
  it("sends parent creation before a dependent session even when enqueue order is reversed", async () => {
    const db = await device();
    await queue(db, operation(sessionPayload, "session", session.id));
    await queue(db, operation());
    const sent: string[] = [];
    await pushPending(
      db,
      adapterFrom([], async (wire) => {
        sent.push(wire.entity);
        return {
          status: "applied",
          entity: wire.entity,
          record_id: wire.record_id,
          action: wire.action,
          revision: "1",
          cursor: String(sent.length),
        };
      }),
      guard,
    );
    expect(sent).toEqual(["subject", "session"]);
  });
  it("rolls back outbox removal and revision update together on interrupted acknowledgement commit", async () => {
    const db = await device();
    await queue(db, operation());
    const fail = () => {
      throw new Error("Crash before ack commit");
    };
    db.recordRevisions.hook("creating", fail);
    await expect(pushPending(db, adapterFrom([]), guard)).rejects.toThrow(
      "Crash before ack commit",
    );
    db.recordRevisions.hook("creating").unsubscribe(fail);
    expect(await db.pendingOperations.count()).toBe(1);
    expect(await db.recordRevisions.count()).toBe(0);
    await pushPending(db, adapterFrom([]), guard);
    expect(await db.pendingOperations.count()).toBe(0);
  });
  it("quarantines corrupted operations without discarding them or blocking an unrelated valid subject", async () => {
    const db = await device();
    const invalid = await queue(db, operation({ ...subject, name: "" }));
    await queue(db, operation({ ...subject, id: "other" }, "subject", "other"));
    const result = await pushPending(db, adapterFrom([]), guard);
    expect(result.applied).toBe(1);
    expect(await db.pendingOperations.count()).toBe(1);
    expect(await db.syncMetadata.get(`op_error:${invalid.id}`)).toBeDefined();
    await pushPending(db, adapterFrom([]), guard);
    expect(await db.syncMetadata.get(`op_error:${invalid.id}`)).toBeDefined();
  });
  it("records a stale revision conflict before completing its rejected operation", async () => {
    const db = await device();
    await queue(db, operation());
    const result = await pushPending(
      db,
      adapterFrom([], async (wire) => ({
        status: "conflict",
        entity: wire.entity,
        record_id: wire.record_id,
        current_revision: "2",
        deleted: false,
        current_snapshot: { ...subject, name: "Cloud edit" },
      })),
      guard,
    );
    expect(result.conflicts).toBe(1);
    expect(await db.pendingOperations.count()).toBe(0);
    expect((await db.conflicts.toArray())[0]).toMatchObject({
      local_snapshot: { payload: subject },
      remote_snapshot: { payload: { name: "Cloud edit" } },
    });
  });
  it("pulls bounded pages and atomically lands complete session allocations with their original day", async () => {
    const db = await device();
    const result = await pullChanges(
      db,
      adapterFrom([
        change(),
        change("2", sessionPayload, "session", session.id),
      ]),
      guard,
      { pageSize: 1 },
    );
    expect(result.pages).toBe(2);
    expect(result.cursor).toBe("2");
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.slices.toArray()).toEqual(sessionPayload.slices);
  });
  it("rolls back page records and cursor together then safely replays after crash", async () => {
    const db = await device();
    const fail = () => {
      throw new Error("Crash before cursor commit");
    };
    db.syncCursors.hook("creating", fail);
    await expect(
      pullChanges(db, adapterFrom([change()]), guard),
    ).rejects.toThrow("Crash before cursor commit");
    db.syncCursors.hook("creating").unsubscribe(fail);
    expect(await db.subjects.count()).toBe(0);
    expect(await db.recordRevisions.count()).toBe(0);
    await pullChanges(db, adapterFrom([change()]), guard);
    expect(await db.subjects.count()).toBe(1);
    expect((await db.syncCursors.get(SYNC_STREAM))?.cursor).toBe("1");
  });
  it("preserves local pending edit and advances cursor with remote version captured as a conflict", async () => {
    const db = await device();
    await queue(db, operation({ ...subject, name: "Offline edit" }));
    await pullChanges(db, adapterFrom([change()]), guard);
    expect((await db.subjects.get(subject.id))?.name).toBe("Offline edit");
    expect(await db.conflicts.count()).toBe(1);
    expect(await db.pendingOperations.count()).toBe(1);
    expect((await db.syncCursors.get(SYNC_STREAM))?.cursor).toBe("1");
  });
  it("conflicts divergent unlinked same-ID caches while deduplicating equal local queued records", async () => {
    const db = await device();
    await db.subjects.put({ ...subject, name: "Unlinked history" });
    await pullChanges(db, adapterFrom([change()]), guard);
    expect((await db.subjects.get(subject.id))?.name).toBe("Unlinked history");
    expect(await db.conflicts.count()).toBe(1);
    const equal = await device();
    await queue(equal, operation());
    await pullChanges(equal, adapterFrom([change()]), guard);
    expect(await equal.pendingOperations.count()).toBe(0);
    expect(await equal.conflicts.count()).toBe(0);
  });
  it("retains a committed own create for same-UUID receipt retry without conflicting with its queued newer edit", async () => {
    const db = await device();
    const first = await queue(db, operation());
    await db.pendingOperations.update(first.sequence!, {
      status: "in_flight",
      wire_request: normalizeOperation(first),
    });
    await queue(db, operation({ ...subject, name: "New local version" }));
    await pullChanges(
      db,
      adapterFrom([{ ...change(), operation_id: first.id }]),
      guard,
    );
    expect(await db.conflicts.count()).toBe(0);
    expect(await db.pendingOperations.count()).toBe(2);
    const apply = vi.fn(adapterFrom([]).apply);
    await pushPending(db, adapterFrom([], apply), guard, { limit: 1 });
    expect(apply.mock.calls[0][0].id).toBe(first.id);
    expect((await db.pendingOperations.toArray())[0].base_revision).toBe("1");
    expect((await db.subjects.get(subject.id))?.name).toBe("New local version");
  });
  it("applies populated-cloud shared preferences to fresh defaults without changing device settings", async () => {
    const db = await device();
    await db.preferences.put({
      ...defaults,
      theme: "light",
      notifications: true,
      id: 1,
    });
    await pullChanges(
      db,
      adapterFrom([
        change(
          "1",
          { minimum: 30, goal: 90, presets: "30,90", weekStart: 0 },
          "settings",
          "settings",
        ),
      ]),
      guard,
    );
    expect(await db.preferences.get(1)).toMatchObject({
      minimum: 30,
      goal: 90,
      theme: "light",
      notifications: true,
      onboarded: false,
    });
    expect(await db.conflicts.count()).toBe(0);
  });
  it("retains remotely deleted session allocations and preserves a subject with an active timer", async () => {
    const db = await device();
    await pullChanges(
      db,
      adapterFrom([
        change(),
        change("2", sessionPayload, "session", session.id),
      ]),
      guard,
    );
    await db.timers.put({
      id: 1,
      value: {
        id: "timer",
        subjectId: subject.id,
        startedAt: session.started_at,
        title: "Active work",
        mode: "stopwatch",
        target: 1500,
        segments: [],
        runningSince: null,
        notified: false,
      },
    });
    await pullChanges(
      db,
      adapterFrom([
        change("3", null, "session", session.id),
        change("4", null),
      ]),
      guard,
    );
    expect(await db.subjects.get(subject.id)).toBeDefined();
    expect(await db.timers.get(1)).toBeDefined();
    expect(await db.conflicts.count()).toBe(1);
    expect(
      (await db.recoveryCopies.toArray()).some((copy) =>
        JSON.stringify(copy.snapshot).includes("2026-09-22"),
      ),
    ).toBe(true);
  });
  it("never advances records or cursor after an account guard changes during the request", async () => {
    const db = await device();
    let current = true;
    const guarded = () => {
      if (!current) throw new SyncError("Account changed", "cancelled");
    };
    const adapter = adapterFrom([change()]);
    const original = adapter.changes;
    adapter.changes = async (...args) => {
      const page = await original(...args);
      current = false;
      return page;
    };
    await expect(pullChanges(db, adapter, guarded)).rejects.toThrow(
      "Account changed",
    );
    expect(await db.subjects.count()).toBe(0);
    expect(await db.syncCursors.count()).toBe(0);
  });
  it("blocks a pending parent deletion when a new cloud child appears, preserving the unknown session as a conflict", async () => {
    const db = await device();
    await pullChanges(db, adapterFrom([change()]), guard);
    await db.subjects.delete(subject.id);
    await queue(db, { ...operation(null), base_revision: "1" });
    await pullChanges(
      db,
      adapterFrom([change("2", sessionPayload, "session", session.id)]),
      guard,
    );
    const [conflict] = await db.conflicts.toArray();
    expect(conflict).toMatchObject({
      entity: "session",
      record_id: session.id,
      local_snapshot: { action: "delete", payload: null },
      remote_snapshot: { action: "upsert", payload: sessionPayload },
    });
    const apply = vi.fn(adapterFrom([]).apply);
    const result = await pushPending(db, adapterFrom([], apply), guard);
    expect(apply).not.toHaveBeenCalled();
    expect(result.blocked).toBe(1);
  });
  it("reports safe unsent work as schedulable after a bounded push batch", async () => {
    const db = await device();
    await queue(db, operation());
    await queue(db, operation({ ...subject, id: "other" }, "subject", "other"));
    const result = await pushPending(db, adapterFrom([]), guard, { limit: 1 });
    expect(result.applied).toBe(1);
    expect(result.blocked).toBe(0);
    expect(await db.pendingOperations.count()).toBe(1);
  });
  it("preserves a selectable new-child version when a cloud create races with an acknowledged parent cascade", async () => {
    const db = await device();
    await pullChanges(db, adapterFrom([change()]), guard);
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: {
        subjects: [subject],
        sessions: [],
        slices: [],
        settings: defaults,
        running: null,
      },
      created_at: new Date().toISOString(),
    });
    await db.subjects.delete(subject.id);
    const deletion = await queue(db, {
      ...operation(null),
      base_revision: "1",
    });
    await pushPending(
      db,
      adapterFrom([], async (wire) => ({
        status: "applied",
        entity: wire.entity,
        record_id: wire.record_id,
        action: wire.action,
        revision: "2",
        cursor: "4",
      })),
      guard,
    );
    const events: SyncChange[] = [
      { ...change("2", sessionPayload, "session", session.id), revision: "1" },
      {
        ...change("3", null, "session", session.id),
        revision: "2",
        operation_id: deletion.id,
      },
      { ...change("4", null), revision: "2", operation_id: deletion.id },
    ];
    await pullChanges(db, adapterFrom(events), guard);
    const [conflict] = await db.conflicts.toArray();
    expect(conflict).toMatchObject({
      kind: "parent_deleted",
      context: { recovered_local: true },
      remote_revision: "2",
      local_snapshot: { action: "upsert", payload: sessionPayload },
      remote_snapshot: { action: "delete", payload: null },
    });
    await resolveConflict(db, conflict.id, "local");
    expect(await db.subjects.get(subject.id)).toEqual(subject);
    expect(await db.sessions.get(session.id)).toEqual(session);
    expect(await db.slices.toArray()).toEqual(sessionPayload.slices);
    expect(
      (await db.pendingOperations.toArray()).map((op) => [
        op.entity,
        op.base_revision,
      ]),
    ).toEqual([
      ["subject", "2"],
      ["session", "2"],
    ]);
  });
  it("orders known child deletes before a coalesced earlier parent delete without blocking unrelated quarantined work", async () => {
    const db = await device();
    const unrelated = await queue(
      db,
      operation(
        {
          ...sessionPayload,
          session: {
            ...session,
            id: "other-session",
            subject_id: "other-subject",
          },
          slices: [
            { session_id: "other-session", day: "2026-09-22", seconds: 1200 },
          ],
        },
        "session",
        "other-session",
      ),
    );
    await db.syncMetadata.put({ key: `op_error:${unrelated.id}`, value: "{}" });
    await queue(db, { ...operation(null), base_revision: "1" });
    await queue(db, {
      ...operation(null, "session", session.id),
      base_revision: "1",
    });
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      entity: "subject",
      record_id: subject.id,
      reason: "conflict",
      snapshot: {
        subjects: [subject],
        sessions: [session],
        slices: sessionPayload.slices,
        settings: defaults,
        running: null,
      },
      created_at: subject.created_at,
    });
    const sent: string[] = [];
    await pushPending(
      db,
      adapterFrom([], async (op) => {
        sent.push(op.entity);
        return {
          status: "applied",
          entity: op.entity,
          record_id: op.record_id,
          action: op.action,
          revision: "2",
          cursor: String(sent.length),
        };
      }),
      guard,
    );
    expect(sent).toEqual(["session", "subject"]);
    expect(await db.pendingOperations.count()).toBe(1);
  });
  it("lets an explicit resolution supersede a proven SQL rollback while retaining its frozen request and study data", async () => {
    const db = await device();
    await pullChanges(
      db,
      adapterFrom([
        change(),
        {
          ...change("2", sessionPayload, "session", session.id),
          revision: "1",
        },
      ]),
      guard,
    );
    const edited = {
      ...sessionPayload,
      session: { ...session, notes: "Offline work" },
    };
    const op = await queue(db, {
      ...operation(edited, "session", session.id),
      base_revision: "1",
    });
    await pushPending(
      db,
      adapterFrom([], async () => {
        throw new SyncError(
          "Subject was deleted",
          "permanent",
          undefined,
          true,
        );
      }),
      guard,
    );
    expect(
      JSON.parse((await db.syncMetadata.get(`op_error:${op.id}`))!.value)
        .definitiveNoCommit,
    ).toBe(true);
    await pullChanges(
      db,
      adapterFrom([
        { ...change("3", null, "session", session.id), revision: "2" },
        { ...change("4", null), revision: "2" },
      ]),
      guard,
    );
    const parent = (await db.conflicts.toArray()).find(
      (item) => item.entity === "subject",
    )!;
    await resolveConflict(db, parent.id, "local");
    expect(await db.pendingOperations.where("id").equals(op.id).count()).toBe(
      0,
    );
    expect(
      (await db.pendingOperations.toArray()).every(
        (item) => item.status === "pending",
      ),
    ).toBe(true);
    expect(await db.sessions.get(session.id)).toMatchObject({
      notes: "Offline work",
    });
    expect(
      (await db.recoveryCopies.toArray()).some((copy) =>
        JSON.stringify(copy.snapshot).includes(op.id),
      ),
    ).toBe(true);
  });
});

describe("Authenticated RPC lifecycle and safe errors", () => {
  function mockClient(
    sessionAccount = "11111111-1111-4111-8111-111111111111",
    response: unknown = null,
    status = 200,
  ) {
    let headers: Record<string, string> = {},
      signal: AbortSignal | undefined;
    const client = {
      auth: {
        getSession: vi.fn(async () => ({
          data: {
            session: {
              access_token: "test-token",
              user: { id: sessionAccount },
            },
          },
          error: null,
        })),
      },
      rpc: vi.fn(() => ({
        setHeader(name: string, value: string) {
          headers[name] = value;
          return this;
        },
        abortSignal(value: AbortSignal) {
          signal = value;
          return this;
        },
        retry: vi.fn(function (this: unknown) {
          return this;
        }),
        then(resolve: (value: unknown) => void) {
          resolve({
            data: response,
            status,
            error: status >= 400 ? { code: "test" } : null,
          });
        },
      })),
    };
    return {
      client: client as unknown as SupabaseClient,
      raw: client,
      headers: () => headers,
      signal: () => signal,
    };
  }
  it("checks the official session account before RPC and freezes bearer authorization", async () => {
    const op = normalizeOperation(operation());
    const mock = mockClient(undefined, {
      status: "applied",
      entity: "subject",
      record_id: subject.id,
      action: "upsert",
      revision: "1",
      cursor: "1",
    });
    const adapter = createSyncAdapter(
      mock.client,
      "11111111-1111-4111-8111-111111111111",
      guard,
    );
    await adapter.apply(op);
    expect(mock.headers().Authorization).toBe("Bearer test-token");
    expect(mock.signal()).toBeDefined();
    const other = mockClient("22222222-2222-4222-8222-222222222222");
    await expect(
      createSyncAdapter(
        other.client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ kind: "auth" });
    expect(other.raw.rpc).not.toHaveBeenCalled();
  });
  it("bounds a hanging SDK session refresh before RPC dispatch", async () => {
    vi.useFakeTimers();
    const mock = mockClient();
    mock.raw.auth.getSession.mockImplementation(() => new Promise(() => {}));
    const request = createSyncAdapter(
      mock.client,
      "11111111-1111-4111-8111-111111111111",
      guard,
      25,
    ).apply(normalizeOperation(operation()));
    const assertion = expect(request).rejects.toMatchObject({
      kind: "transient",
    });
    await vi.advanceTimersByTimeAsync(25);
    await assertion;
    expect(mock.raw.rpc).not.toHaveBeenCalled();
  });
  it("honors numeric and HTTP-date Retry-After while sanitizing server error responses", async () => {
    expect(retryAfterMilliseconds("7")).toBe(7000);
    expect(
      retryAfterMilliseconds(
        "Sat, 03 Oct 2026 00:00:07 GMT",
        Date.parse("2026-10-03T00:00:00Z"),
      ),
    ).toBe(7000);
    expect(retryAfterMilliseconds("invalid")).toBeUndefined();
    const op = normalizeOperation(operation());
    const mock = mockClient(undefined, null, 429);
    // The custom fetch captures Retry-After against the builder's same signal.
    mock.raw.rpc.mockImplementation(() => {
      const builder = {
        setHeader() {
          return builder;
        },
        abortSignal(signal: AbortSignal) {
          builder.signal = signal;
          return builder;
        },
        retry() {
          return builder;
        },
        signal: undefined as AbortSignal | undefined,
        async then(resolve: (value: unknown) => void) {
          await syncAwareFetch("https://example.test/rpc", {
            signal: builder.signal,
          });
          resolve({
            data: null,
            status: 429,
            error: { code: "anything", message: "secret server detail" },
          });
        },
      };
      return builder as never;
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response("{}", { status: 429, headers: { "Retry-After": "7" } }),
      ),
    );
    try {
      await expect(
        createSyncAdapter(
          mock.client,
          "11111111-1111-4111-8111-111111111111",
          guard,
        ).apply(op),
      ).rejects.toMatchObject({ kind: "transient", retryAfterMs: 7000 });
    } finally {
      vi.unstubAllGlobals();
    }
  });
  it("pauses safely for expired authentication and malformed results", async () => {
    const op = normalizeOperation(operation());
    await expect(
      createSyncAdapter(
        mockClient(undefined, null, 401).client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ kind: "auth" });
    await expect(
      createSyncAdapter(
        mockClient(undefined, {}).client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ kind: "malformed" });
  });
  it("marks only known PostgreSQL validation/constraint responses as definite transaction rollbacks", async () => {
    const op = normalizeOperation(operation());
    const rejected = mockClient();
    rejected.raw.rpc.mockImplementation(() => {
      const builder = {
        setHeader() {
          return builder;
        },
        abortSignal() {
          return builder;
        },
        retry() {
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          resolve({ status: 409, data: null, error: { code: "23503" } });
        },
      };
      return builder as never;
    });
    await expect(
      createSyncAdapter(
        rejected.client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ kind: "permanent", definitiveNoCommit: true });
    await expect(
      createSyncAdapter(
        mockClient(undefined, null, 500).client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ definitiveNoCommit: false });
    await expect(
      createSyncAdapter(
        mockClient(undefined, {}).client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(op),
    ).rejects.toMatchObject({ definitiveNoCommit: false });
  });
  it("keeps receipt uncertainty after a PostgreSQL UUID reuse rejection", async () => {
    const rejected = mockClient();
    rejected.raw.rpc.mockImplementation(() => {
      const builder = {
        setHeader() {
          return builder;
        },
        abortSignal() {
          return builder;
        },
        retry() {
          return builder;
        },
        then(resolve: (value: unknown) => void) {
          resolve({ status: 409, data: null, error: { code: "23505" } });
        },
      };
      return builder as never;
    });
    await expect(
      createSyncAdapter(
        rejected.client,
        "11111111-1111-4111-8111-111111111111",
        guard,
      ).apply(normalizeOperation(operation())),
    ).rejects.toMatchObject({
      kind: "permanent",
      definitiveNoCommit: false,
    });
  });
});
