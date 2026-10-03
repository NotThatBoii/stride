import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import {
  defaults,
  type Data,
  type Running,
  type Session,
  type Slice,
  type Subject,
} from "../../models";
import {
  enqueueOperation,
  initialize,
  readData,
  StrideDatabase,
} from "../local-database";
import {
  canKeepBoth,
  hasUnresolvedConflict,
  listUnresolvedConflicts,
  preserveConflict,
  protectRemoteSubjectDeletion,
  readLocalVersion,
  resolveConflict,
} from "./conflicts";
import {
  commitImport,
  deferLegacyImport,
  getImportState,
  importBackup,
  stageImport,
} from "./import";
import { parseBackup } from "../validation";
import { pullChanges } from "./pull";
import type { SyncAdapter } from "./types";

const subject: Subject = {
  id: "subject-one",
  name: "Mathematics",
  description: "Original",
  color: "#123456",
  icon: "book",
  archived: 0,
  created_at: "2026-10-01T00:00:00.000Z",
};
const session: Session = {
  id: "session-one",
  subject_id: subject.id,
  started_at: "2026-10-01T15:50:00.000Z",
  ended_at: "2026-10-01T16:10:00.000Z",
  duration_seconds: 1200,
  session_title: "Practice",
  notes: "Original notes",
  mode: "stopwatch",
  completed: 1,
};
// These recorded local days deliberately differ from the UTC date.
const slices: Slice[] = [
  { session_id: session.id, day: "2026-10-01", seconds: 600 },
  { session_id: session.id, day: "2026-10-02", seconds: 600 },
];
const source = (): Data => ({
  subjects: [subject],
  sessions: [session],
  slices,
  settings: { ...defaults },
  running: null,
});
const opened: StrideDatabase[] = [];

async function account() {
  const db = new StrideDatabase(
    `sync-conflict-test-${crypto.randomUUID()}`,
    crypto.randomUUID(),
  );
  opened.push(db);
  await initialize(db, null);
  return db;
}
async function seed(db: StrideDatabase, data = source()) {
  await db.subjects.bulkPut(data.subjects);
  await db.sessions.bulkPut(data.sessions);
  await db.slices.bulkPut(data.slices);
  await db.preferences.put({ ...data.settings, id: 1 });
}
async function conflict(
  db: StrideDatabase,
  remote = { ...subject, name: "Cloud mathematics" },
) {
  await db.subjects.put({ ...subject, name: "Device mathematics" });
  await enqueueOperation(
    db,
    "subject",
    subject.id,
    "upsert",
    (await db.subjects.get(subject.id))!,
  );
  return db.transaction("rw", db.tables, () =>
    preserveConflict(db, {
      entity: "subject",
      record_id: subject.id,
      local_snapshot: {
        action: "upsert",
        payload: { ...subject, name: "Device mathematics" },
      },
      remote_snapshot: { action: "upsert", payload: remote },
      base_revision: "1",
      remote_revision: "2",
      source: "pull",
      kind: "concurrent_edit",
    }),
  );
}
function runningTimer(subjectId = subject.id): Running {
  return {
    id: "imported-timer",
    subjectId,
    startedAt: new Date(Date.now() - 120000).toISOString(),
    title: "Unfinished work",
    mode: "stopwatch",
    target: 1500,
    segments: [],
    runningSince: Date.now() - 60000,
    notified: false,
  };
}
afterEach(async () => {
  for (const db of opened.splice(0)) await db.delete();
});

describe("safe staged history imports", () => {
  it("stages a usable JSON backup and commits/replays one immutable import without duplicating history", async () => {
    const db = await account();
    const data = source();
    const stage = await stageImport(db, data);
    expect(await db.subjects.count()).toBe(0);
    expect(parseBackup(importBackup(stage))).toEqual(data);
    expect((await stageImport(db, data)).id).toBe(stage.id);
    const result = await commitImport(db, stage.id);
    expect(result).toEqual({
      subjects: 1,
      sessions: 1,
      deduplicated: 0,
      conflicts: 0,
    });
    expect(await commitImport(db, stage.id)).toEqual(result);
    db.close();
    await db.open();
    expect(await commitImport(db, stage.id)).toEqual(result);
    expect(await db.subjects.toArray()).toEqual([subject]);
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.slices.toArray()).toEqual(slices);
    expect(await db.pendingOperations.count()).toBe(2);
    expect((await getImportState(db))?.status).toBe("complete");
    expect(await db.syncMetadata.get("legacy_import_handled")).toBeDefined();
    expect(await db.recoveryCopies.count()).toBe(1);
  });

  it("rolls back records, outbox, and completion marker on an interrupted import, then restarts safely", async () => {
    const db = await account();
    const stage = await stageImport(db, source());
    const fail = () => {
      throw new Error("Interrupted import");
    };
    db.slices.hook("creating", fail);
    try {
      await expect(commitImport(db, stage.id)).rejects.toThrow(
        "Interrupted import",
      );
    } finally {
      db.slices.hook("creating").unsubscribe(fail);
    }
    expect(await db.subjects.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(await db.pendingOperations.count()).toBe(0);
    expect((await getImportState(db))?.status).toBe("staged");
    expect(await db.syncMetadata.get("legacy_import_handled")).toBeUndefined();
    expect((await commitImport(db, stage.id)).sessions).toBe(1);
  });

  it("can review a different backup after canceling while retaining the prior staged source", async () => {
    const db = await account();
    const previous = await stageImport(db, source(), "backup");
    const replacement = await stageImport(
      db,
      { ...source(), subjects: [{ ...subject, name: "Chosen replacement" }] },
      "backup",
    );
    expect(replacement.id).not.toBe(previous.id);
    expect((await getImportState(db, "backup"))?.id).toBe(replacement.id);
    expect(await db.subjects.count()).toBe(0);
    expect(await db.pendingOperations.count()).toBe(0);
    expect(await db.recoveryCopies.count()).toBe(2);
    await expect(commitImport(db, previous.id)).rejects.toThrow("not found");
    await commitImport(db, replacement.id);
    expect((await db.subjects.get(subject.id))?.name).toBe(
      "Chosen replacement",
    );
  });

  it("deduplicates exact ID/content matches using timestamp instants and retains allocation days", async () => {
    const db = await account();
    await seed(db, {
      ...source(),
      subjects: [{ ...subject, created_at: "2026-10-01T08:00:00+08:00" }],
      sessions: [
        {
          ...session,
          started_at: "2026-10-01T23:50:00+08:00",
          ended_at: "2026-10-02T00:10:00+08:00",
        },
      ],
    });
    const stage = await stageImport(db, source());
    expect(await commitImport(db, stage.id)).toEqual({
      subjects: 0,
      sessions: 0,
      deduplicated: 2,
      conflicts: 0,
    });
    expect(await db.pendingOperations.count()).toBe(0);
    expect(await db.slices.toArray()).toEqual(slices);
  });

  it("keeps identically named subjects with different IDs as separate subjects", async () => {
    const db = await account();
    await db.subjects.put({ ...subject, id: "another-math" });
    const stage = await stageImport(db, source());
    expect((await commitImport(db, stage.id)).subjects).toBe(1);
    expect(await db.subjects.count()).toBe(2);
  });

  it("preserves same-ID divergence and stages its child tree instead of assigning sessions to another version", async () => {
    const db = await account();
    await db.subjects.put({ ...subject, name: "Current account subject" });
    const stage = await stageImport(db, source());
    expect(await commitImport(db, stage.id)).toEqual({
      subjects: 0,
      sessions: 0,
      deduplicated: 0,
      conflicts: 1,
    });
    expect((await db.subjects.get(subject.id))?.name).toBe(
      "Current account subject",
    );
    expect(await db.sessions.count()).toBe(0);
    const [collision] = await listUnresolvedConflicts(db);
    expect(collision.source).toBe("legacy");
    expect(collision.context?.incoming_tree?.sessions).toEqual([session]);
    await resolveConflict(db, collision.id, "both");
    const data = await readData(db);
    expect(data.subjects).toHaveLength(2);
    const imported = data.subjects.find((item) => item.id !== subject.id)!;
    expect(imported.name).toBe(subject.name);
    expect(data.sessions).toHaveLength(1);
    expect(data.sessions[0].subject_id).toBe(imported.id);
    expect(data.sessions[0].id).not.toBe(session.id);
    expect(data.slices.map((slice) => slice.day)).toEqual(
      slices.map((slice) => slice.day),
    );
    expect(
      data.slices.every((slice) => slice.session_id === data.sessions[0].id),
    ).toBe(true);
    await resolveConflict(db, collision.id, "both");
    expect(await db.sessions.count()).toBe(1);
  });

  it("uses the incoming subject only after explicit selection and then imports its child allocations", async () => {
    const db = await account();
    await db.subjects.put({ ...subject, name: "Another version" });
    await db.recordRevisions.put({
      entity: "subject",
      record_id: subject.id,
      server_revision: "17",
      updated_at: subject.created_at,
    });
    const stage = await stageImport(db, source());
    await commitImport(db, stage.id);
    await resolveConflict(
      db,
      (await listUnresolvedConflicts(db))[0].id,
      "remote",
    );
    expect(await db.subjects.get(subject.id)).toEqual(subject);
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.slices.toArray()).toEqual(slices);
    const operation = await db.pendingOperations
      .where("[entity+record_id]")
      .equals(["subject", subject.id])
      .first();
    expect(operation?.base_revision).toBe("17");
  });

  it("does not silently resurrect a known cloud tombstone during import", async () => {
    const db = await account();
    await db.recordRevisions.put({
      entity: "subject",
      record_id: subject.id,
      server_revision: "8",
      deleted: true,
      updated_at: subject.created_at,
    });
    const stage = await stageImport(db, source());
    await commitImport(db, stage.id);
    expect(await db.subjects.count()).toBe(0);
    expect((await listUnresolvedConflicts(db))[0].local_snapshot).toEqual({
      action: "delete",
      payload: null,
    });
    expect(await db.pendingOperations.count()).toBe(0);
  });

  it("adds JSON backup records without deleting account history or copying device settings/timers", async () => {
    const db = await account();
    await db.subjects.put({ ...subject, id: "account-only" });
    await db.preferences.put({
      ...defaults,
      theme: "light",
      notifications: true,
      onboarded: true,
      id: 1,
    });
    const stage = await stageImport(
      db,
      {
        ...source(),
        settings: {
          ...defaults,
          goal: 90,
          theme: "dark",
          notifications: false,
          onboarded: false,
        },
      },
      "backup",
    );
    await commitImport(db, stage.id);
    expect(await db.subjects.count()).toBe(2);
    expect(await db.preferences.get(1)).toMatchObject({
      goal: 90,
      theme: "light",
      notifications: true,
      onboarded: true,
    });
    expect(await db.timers.count()).toBe(0);
    expect(await db.syncMetadata.get("legacy_import_handled")).toBeUndefined();
  });

  it("restores an explicitly imported legacy timer paused at staging without syncing its state", async () => {
    const db = await account();
    const running = runningTimer();
    const data = { ...source(), running };
    const stage = await stageImport(db, data);
    expect(stage.source.running).toEqual(running);
    const backup = parseBackup(importBackup(stage));
    await commitImport(db, stage.id);
    const restored = (await db.timers.get(1))!.value;
    expect(restored).toEqual(backup.running);
    expect(restored.runningSince).toBeNull();
    expect(restored.segments[0]).toEqual({
      start: running.runningSince,
      end: Date.parse(stage.created_at),
    });
    expect(
      (await db.pendingOperations.toArray()).every(
        (operation) =>
          operation.entity === "subject" || operation.entity === "session",
      ),
    ).toBe(true);
    expect(data.running).toEqual(running);
  });

  it("does not replace an existing local timer with a staged timer", async () => {
    const db = await account();
    const existingSubject = { ...subject, id: "current-timer-subject" };
    await db.subjects.put(existingSubject);
    const existing = {
      ...runningTimer(existingSubject.id),
      id: "current-timer",
    };
    await db.timers.put({ id: 1, value: existing });
    const stage = await stageImport(db, {
      ...source(),
      running: runningTimer(),
    });
    await commitImport(db, stage.id);
    expect((await db.timers.get(1))?.value).toEqual(existing);
    expect((await getImportState(db))?.source.running?.id).toBe(
      "imported-timer",
    );
  });

  it("remaps a preserved staged timer when both divergent subject versions are kept", async () => {
    const db = await account();
    await db.subjects.put({ ...subject, name: "Account version" });
    const stage = await stageImport(db, {
      ...source(),
      running: runningTimer(),
    });
    await commitImport(db, stage.id);
    expect(await db.timers.count()).toBe(0);
    await resolveConflict(
      db,
      (await listUnresolvedConflicts(db))[0].id,
      "both",
    );
    const restored = (await db.timers.get(1))!.value;
    expect(restored.subjectId).not.toBe(subject.id);
    expect(restored.runningSince).toBeNull();
    expect(await db.subjects.get(restored.subjectId)).toMatchObject({
      name: subject.name,
    });
  });

  it("rolls back staged/committed imports when the account guard detects sign-out before transaction completion", async () => {
    const db = await account();
    let checks = 0;
    const guard = () => {
      if (++checks === 2) throw new Error("Account changed");
    };
    await expect(stageImport(db, source(), "legacy", guard)).rejects.toThrow(
      "Account changed",
    );
    expect(await getImportState(db)).toBeNull();
    expect(await db.recoveryCopies.count()).toBe(0);
    const stage = await stageImport(db, source());
    checks = 0;
    await expect(commitImport(db, stage.id, guard)).rejects.toThrow(
      "Account changed",
    );
    expect(await db.subjects.count()).toBe(0);
    expect(await db.pendingOperations.count()).toBe(0);
    expect((await getImportState(db))?.status).toBe("staged");
  });

  it("rolls back a deferred legacy decision if the account changes during its transaction", async () => {
    const db = await account();
    let checks = 0;
    await expect(
      deferLegacyImport(db, () => {
        if (++checks === 2) throw new Error("Account changed");
      }),
    ).rejects.toThrow("Account changed");
    expect(await db.syncMetadata.get("legacy_import_deferred")).toBeUndefined();
  });

  it("keeps deferred decisions and staged data isolated between accounts", async () => {
    const a = await account(),
      b = await account();
    await deferLegacyImport(a);
    const stage = await stageImport(a, source());
    expect(await b.syncMetadata.get("legacy_import_deferred")).toBeUndefined();
    expect(await getImportState(b)).toBeNull();
    await expect(commitImport(b, stage.id)).rejects.toThrow("not found");
    expect(await a.subjects.count()).toBe(0);
  });

  it("imports a thousand completed sessions with intact recorded allocations and no replay duplicates", async () => {
    const db = await account();
    const sessions = Array.from({ length: 1000 }, (_, i) => ({
      ...session,
      id: `history-${i}`,
    }));
    const data = {
      ...source(),
      sessions,
      slices: sessions.flatMap((item) =>
        slices.map((slice) => ({ ...slice, session_id: item.id })),
      ),
    };
    const stage = await stageImport(db, data);
    await commitImport(db, stage.id);
    await commitImport(db, stage.id);
    expect(await db.sessions.count()).toBe(1000);
    expect(await db.slices.count()).toBe(2000);
    expect(await db.pendingOperations.count()).toBe(1001);
  }, 20000);
});

describe("conflict preservation and deliberate resolution", () => {
  for (const choice of ["remote", "both"] as const) {
    it(`keeps an unsent moved child and its exact operation outside a ${choice} parent choice`, async () => {
      const db = await account();
      await seed(db);
      const destination = { ...subject, id: "destination-subject" };
      await db.subjects.put(destination);
      await db.recordRevisions.put({
        entity: "session",
        record_id: session.id,
        server_revision: "1",
        updated_at: subject.created_at,
      });
      const parent = await conflict(db);
      const moved = {
        ...session,
        subject_id: destination.id,
        notes: "Moved after parent conflict capture",
      };
      await db.sessions.put(moved);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session: moved,
        slices,
      });
      const queued = (
        await db.pendingOperations
          .where("[entity+record_id]")
          .equals(["session", session.id])
          .toArray()
      )[0];
      await resolveConflict(db, parent.id, choice);
      expect(await db.sessions.toArray()).toEqual([moved]);
      expect(await db.slices.toArray()).toEqual(slices);
      expect(await db.pendingOperations.get(queued.sequence!)).toEqual(queued);
      expect(await db.sessions.count()).toBe(1);
      expect(await db.subjects.count()).toBe(choice === "both" ? 3 : 2);
    });

    it(`preserves a moved child's separate conflict and queue after a ${choice} parent choice`, async () => {
      const db = await account();
      await seed(db);
      const destination = { ...subject, id: "destination-subject" };
      await db.subjects.put(destination);
      const parent = await conflict(db);
      const childConflict = await db.transaction("rw", db.tables, () =>
        preserveConflict(db, {
          entity: "session",
          record_id: session.id,
          local_snapshot: { action: "upsert", payload: { session, slices } },
          remote_snapshot: {
            action: "upsert",
            payload: {
              session: { ...session, notes: "Cloud child edit" },
              slices,
            },
          },
          base_revision: "1",
          remote_revision: "2",
          source: "pull",
        }),
      );
      await db.recordRevisions.put({
        entity: "session",
        record_id: session.id,
        server_revision: "2",
        updated_at: subject.created_at,
      });
      const moved = {
        ...session,
        subject_id: destination.id,
        notes: "Moved after both conflicts were captured",
      };
      await db.sessions.put(moved);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session: moved,
        slices,
      });
      const queued = (
        await db.pendingOperations
          .where("[entity+record_id]")
          .equals(["session", session.id])
          .toArray()
      )[0];
      await resolveConflict(db, parent.id, choice);
      expect(await db.sessions.toArray()).toEqual([moved]);
      expect(await db.slices.toArray()).toEqual(slices);
      expect(await db.pendingOperations.get(queued.sequence!)).toEqual(queued);
      expect(
        (await listUnresolvedConflicts(db)).map((item) => item.id),
      ).toEqual([childConflict.id]);
      await resolveConflict(db, childConflict.id, "local");
      const replacement = (
        await db.pendingOperations
          .where("[entity+record_id]")
          .equals(["session", session.id])
          .toArray()
      )[0];
      expect(replacement.payload).toEqual({ session: moved, slices });
      expect(replacement.base_revision).toBe("2");
      expect(await listUnresolvedConflicts(db)).toEqual([]);
    });

    it(`recovers a definitively rejected moved child without quarantine after a ${choice} parent choice`, async () => {
      const db = await account();
      await seed(db);
      const destination = { ...subject, id: "destination-subject" };
      await db.subjects.put(destination);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session,
        slices,
      });
      const [rejected] = await db.pendingOperations.toArray();
      const frozen = {
        id: rejected.id,
        entity: "session" as const,
        record_id: session.id,
        action: "upsert" as const,
        payload: { session, slices },
        base_revision: null,
      };
      await db.pendingOperations.update(rejected.sequence!, {
        status: "in_flight",
        wire_request: frozen,
      });
      await db.syncMetadata.put({
        key: `op_error:${rejected.id}`,
        value: JSON.stringify({ kind: "permanent", definitiveNoCommit: true }),
      });
      const parent = await conflict(db);
      const moved = {
        ...session,
        subject_id: destination.id,
        notes: "Latest moved child after proven FK rollback",
      };
      await db.sessions.put(moved);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session: moved,
        slices,
      });
      await resolveConflict(db, parent.id, choice);
      expect(await db.sessions.toArray()).toEqual([moved]);
      expect(await db.slices.toArray()).toEqual(slices);
      const queued = await db.pendingOperations
        .where("[entity+record_id]")
        .equals(["session", session.id])
        .toArray();
      expect(queued).toHaveLength(1);
      expect(queued[0].id).not.toBe(rejected.id);
      expect(queued[0]).toMatchObject({
        status: "pending",
        payload: { session: moved, slices },
        base_revision: null,
      });
      expect(queued[0].wire_request).toBeUndefined();
      expect(
        await db.syncMetadata.get(`op_error:${rejected.id}`),
      ).toBeUndefined();
      expect(
        (await db.recoveryCopies.get(`superseded-operation:${rejected.id}`))
          ?.snapshot,
      ).toMatchObject({ operation: { wire_request: frozen } });
    });

    it(`keeps an uncertain moved-child request frozen and blocks a ${choice} parent choice`, async () => {
      const db = await account();
      await seed(db);
      const destination = { ...subject, id: "destination-subject" };
      await db.subjects.put(destination);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session,
        slices,
      });
      const [submitted] = await db.pendingOperations.toArray();
      const frozen = {
        id: submitted.id,
        entity: "session" as const,
        record_id: session.id,
        action: "upsert" as const,
        payload: { session, slices },
        base_revision: null,
      };
      await db.pendingOperations.update(submitted.sequence!, {
        status: "in_flight",
        wire_request: frozen,
      });
      const parent = await conflict(db);
      const moved = { ...session, subject_id: destination.id };
      await db.sessions.put(moved);
      await enqueueOperation(db, "session", session.id, "upsert", {
        session: moved,
        slices,
      });
      const before = await db.pendingOperations.toArray();
      await expect(resolveConflict(db, parent.id, choice)).rejects.toThrow(
        "confirm the submitted",
      );
      expect(await db.pendingOperations.toArray()).toEqual(before);
      expect(await db.sessions.get(session.id)).toEqual(moved);
      expect(
        (await db.pendingOperations.get(submitted.sequence!))?.wire_request,
      ).toEqual(frozen);
    });
  }

  it("preserves a live moved child and its queue when the cloud's old-parent tombstone is selected", async () => {
    const db = await account();
    await seed(db);
    const destination = { ...subject, id: "destination-subject" };
    await db.subjects.put(destination);
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    const moved = { ...session, subject_id: destination.id };
    await db.sessions.put(moved);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session: moved,
      slices,
    });
    const queued = (await db.pendingOperations.toArray())[0];
    await resolveConflict(db, parent.id, "remote");
    expect(await db.subjects.get(subject.id)).toBeUndefined();
    expect(await db.subjects.get(destination.id)).toEqual(destination);
    expect(await db.sessions.get(session.id)).toEqual(moved);
    expect(await db.slices.toArray()).toEqual(slices);
    expect(await db.pendingOperations.get(queued.sequence!)).toEqual(queued);
  });

  it("requeues a proven rejected new child with no child conflict after keeping its local parent branch", async () => {
    const db = await account();
    const child = { ...session, id: "never-committed-child" };
    const childSlices = slices.map((slice) => ({
      ...slice,
      session_id: child.id,
    }));
    await seed(db, { ...source(), sessions: [child], slices: childSlices });
    await enqueueOperation(db, "session", child.id, "upsert", {
      session: child,
      slices: childSlices,
    });
    const [rejected] = await db.pendingOperations.toArray();
    const frozen = {
      id: rejected.id,
      entity: "session" as const,
      record_id: child.id,
      action: "upsert" as const,
      payload: { session: child, slices: childSlices },
      base_revision: null,
    };
    await db.pendingOperations.update(rejected.sequence!, {
      status: "in_flight",
      wire_request: frozen,
    });
    await db.syncMetadata.put({
      key: `op_error:${rejected.id}`,
      value: JSON.stringify({ kind: "permanent", definitiveNoCommit: true }),
    });
    const edited = {
      ...child,
      notes: "Edited again while its parent needs review",
    };
    await db.sessions.put(edited);
    await enqueueOperation(db, "session", child.id, "upsert", {
      session: edited,
      slices: childSlices,
    });
    await db.recordRevisions.put({
      entity: "subject",
      record_id: subject.id,
      server_revision: "2",
      deleted: true,
      updated_at: subject.created_at,
    });
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    expect(await listUnresolvedConflicts(db)).toHaveLength(1);
    await resolveConflict(db, parent.id, "local");
    const operations = await db.pendingOperations.toArray();
    expect(operations).toHaveLength(2);
    const replacement = operations.find(
      (operation) => operation.entity === "session",
    )!;
    expect(replacement.id).not.toBe(rejected.id);
    expect(replacement.status).toBe("pending");
    expect(replacement.base_revision).toBeNull();
    expect(replacement.wire_request).toBeUndefined();
    expect(replacement.payload).toEqual({
      session: edited,
      slices: childSlices,
    });
    expect(
      (await db.recoveryCopies.get(`superseded-operation:${rejected.id}`))
        ?.snapshot,
    ).toMatchObject({ operation: { wire_request: frozen } });
    expect(
      await db.syncMetadata.get(`op_error:${rejected.id}`),
    ).toBeUndefined();
    expect(await listUnresolvedConflicts(db)).toEqual([]);
  });

  it("clears a proven rejected child after an explicit local-parent deletion choice without restoring its removed branch", async () => {
    const db = await account();
    await seed(db);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    const [rejected] = await db.pendingOperations.toArray();
    await db.pendingOperations.update(rejected.sequence!, {
      status: "in_flight",
      wire_request: {
        id: rejected.id,
        entity: "session",
        record_id: session.id,
        action: "upsert",
        payload: { session, slices },
        base_revision: null,
      },
    });
    await db.syncMetadata.put({
      key: `op_error:${rejected.id}`,
      value: JSON.stringify({ kind: "permanent", definitiveNoCommit: true }),
    });
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    await db.subjects.clear();
    await db.sessions.clear();
    await db.slices.clear();
    await enqueueOperation(db, "session", session.id, "delete", null);
    await enqueueOperation(db, "subject", subject.id, "delete", null);
    await resolveConflict(db, parent.id, "local");
    const operations = await db.pendingOperations.toArray();
    expect(operations).toHaveLength(1);
    expect(operations[0]).toMatchObject({
      entity: "subject",
      action: "delete",
      base_revision: "2",
    });
    expect(await db.subjects.count()).toBe(0);
    expect(await db.sessions.count()).toBe(0);
    expect(
      await db.recoveryCopies.get(`superseded-operation:${rejected.id}`),
    ).toBeDefined();
    expect(
      await db.syncMetadata.get(`op_error:${rejected.id}`),
    ).toBeUndefined();
    expect(await listUnresolvedConflicts(db)).toEqual([]);
  });

  it("preserves a child moved to another subject while clearing its old parent's proven rejected request", async () => {
    const db = await account();
    await seed(db);
    const destination = { ...subject, id: "another-live-subject" };
    await db.subjects.put(destination);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    const [rejected] = await db.pendingOperations.toArray();
    await db.pendingOperations.update(rejected.sequence!, {
      status: "in_flight",
      wire_request: {
        id: rejected.id,
        entity: "session",
        record_id: session.id,
        action: "upsert",
        payload: { session, slices },
        base_revision: null,
      },
    });
    await db.syncMetadata.put({
      key: `op_error:${rejected.id}`,
      value: JSON.stringify({ kind: "permanent", definitiveNoCommit: true }),
    });
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    const moved = { ...session, subject_id: destination.id };
    await db.sessions.put(moved);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session: moved,
      slices,
    });
    await db.subjects.delete(subject.id);
    await enqueueOperation(db, "subject", subject.id, "delete", null);
    await resolveConflict(db, parent.id, "local");
    expect(await db.subjects.get(subject.id)).toBeUndefined();
    expect(await db.subjects.get(destination.id)).toEqual(destination);
    expect(await db.sessions.get(session.id)).toEqual(moved);
    expect(await db.slices.toArray()).toEqual(slices);
    const queued = await db.pendingOperations
      .where("[entity+record_id]")
      .equals(["session", session.id])
      .toArray();
    expect(queued).toHaveLength(1);
    expect(queued[0].id).not.toBe(rejected.id);
    expect(queued[0].payload).toEqual({ session: moved, slices });
    expect(queued[0].base_revision).toBeNull();
    expect(
      await db.syncMetadata.get(`op_error:${rejected.id}`),
    ).toBeUndefined();
  });

  it("replays conflicts without duplicating them and preserves changed remote versions", async () => {
    const db = await account();
    const first = await conflict(db);
    const repeated = await conflict(db);
    expect(repeated.id).toBe(first.id);
    expect(await db.conflicts.count()).toBe(1);
    expect(await db.recoveryCopies.count()).toBe(1);
    await conflict(db, { ...subject, name: "Newer cloud version" });
    expect(await db.conflicts.count()).toBe(1);
    expect(await db.recoveryCopies.count()).toBe(2);
    expect(await hasUnresolvedConflict(db, "subject", subject.id)).toBe(true);
    expect(await hasUnresolvedConflict(db, "subject", "unrelated")).toBe(false);
  });

  it("keeps this device's version with a new UUID at the latest cloud revision", async () => {
    const db = await account();
    const disagreement = await conflict(db);
    const old = (await db.pendingOperations.toArray())[0];
    await resolveConflict(db, disagreement.id, "local");
    const [operation] = await db.pendingOperations.toArray();
    expect(operation.id).not.toBe(old.id);
    expect(operation.base_revision).toBe("2");
    expect((await db.subjects.get(subject.id))?.name).toBe(
      "Device mathematics",
    );
    expect(await listUnresolvedConflicts(db)).toEqual([]);
    expect(await db.recoveryCopies.count()).toBe(2);
  });

  it("uses the cloud version only after a choice while keeping recovery copies", async () => {
    const db = await account();
    const disagreement = await conflict(db);
    await resolveConflict(db, disagreement.id, "remote");
    expect((await db.subjects.get(subject.id))?.name).toBe("Cloud mathematics");
    expect(await db.pendingOperations.count()).toBe(0);
    expect(await db.recoveryCopies.count()).toBe(2);
  });

  it("refuses to replace an uncertain submitted operation", async () => {
    const db = await account();
    const disagreement = await conflict(db);
    const [operation] = await db.pendingOperations.toArray();
    await db.pendingOperations.update(operation.sequence!, {
      status: "in_flight",
    });
    await expect(
      resolveConflict(db, disagreement.id, "remote"),
    ).rejects.toThrow("confirm the submitted");
    expect(await listUnresolvedConflicts(db)).toHaveLength(1);
    expect(await db.recoveryCopies.count()).toBe(1);
    expect((await db.subjects.get(subject.id))?.name).toBe(
      "Device mathematics",
    );
  });

  it("keeps both complete session versions with new IDs and correctly remapped allocations", async () => {
    const db = await account();
    await seed(db);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    const remote = { session: { ...session, notes: "Cloud notes" }, slices };
    const disagreement = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "session",
        record_id: session.id,
        local_snapshot: { action: "upsert", payload: { session, slices } },
        remote_snapshot: { action: "upsert", payload: remote },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    expect(canKeepBoth(disagreement)).toBe(true);
    await resolveConflict(db, disagreement.id, "both");
    const data = await readData(db);
    expect(data.sessions).toHaveLength(2);
    expect(data.sessions.find((item) => item.id === session.id)?.notes).toBe(
      "Cloud notes",
    );
    const clone = data.sessions.find((item) => item.id !== session.id)!;
    expect(clone.notes).toBe(session.notes);
    expect(
      data.slices
        .filter((slice) => slice.session_id === clone.id)
        .map((slice) => slice.day),
    ).toEqual(slices.map((slice) => slice.day));
    expect((await db.pendingOperations.toArray())[0].record_id).toBe(clone.id);
  });

  it("keeps both subject versions and remaps the entire local session/allocation tree", async () => {
    const db = await account();
    await seed(db);
    const disagreement = await conflict(db);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    await resolveConflict(db, disagreement.id, "both");
    const data = await readData(db);
    const clone = data.subjects.find((item) => item.id !== subject.id)!;
    expect(clone.name).toBe("Device mathematics");
    expect(data.subjects.find((item) => item.id === subject.id)?.name).toBe(
      "Cloud mathematics",
    );
    expect(data.sessions).toHaveLength(2);
    const clonedSession = data.sessions.find(
      (item) => item.subject_id === clone.id,
    )!;
    expect(clonedSession.id).not.toBe(session.id);
    expect(
      data.slices
        .filter((slice) => slice.session_id === clonedSession.id)
        .map((slice) => slice.day),
    ).toEqual(slices.map((slice) => slice.day));
    expect(
      (await db.pendingOperations.toArray()).map(
        (operation) => operation.record_id,
      ),
    ).toEqual([clone.id, clonedSession.id]);
  });

  it("protects a remote subject deletion when a local child or active timer needs it", async () => {
    const db = await account();
    await seed(db);
    expect(await protectRemoteSubjectDeletion(db, subject.id)).toBe(false);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    expect(await protectRemoteSubjectDeletion(db, subject.id)).toBe(true);
    expect(await protectRemoteSubjectDeletion(db, "another-subject")).toBe(
      false,
    );
  });

  it("preserves an active timer under a new recoverable subject when cloud deletion is selected", async () => {
    const db = await account();
    await seed(db);
    const timer: Running = {
      id: "running",
      subjectId: subject.id,
      startedAt: "2026-10-03T00:00:00.000Z",
      title: "In progress",
      mode: "stopwatch",
      target: 1500,
      segments: [],
      runningSince: 1790985600000,
      notified: false,
    };
    await db.timers.put({ id: 1, value: timer });
    const disagreement = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    expect(await protectRemoteSubjectDeletion(db, subject.id)).toBe(true);
    await resolveConflict(db, disagreement.id, "remote");
    const recovered = (await db.timers.get(1))!.value;
    expect(recovered).toEqual({ ...timer, subjectId: recovered.subjectId });
    expect(recovered.subjectId).not.toBe(subject.id);
    expect(await db.subjects.get(subject.id)).toBeUndefined();
    expect(await db.subjects.get(recovered.subjectId)).toMatchObject({
      name: subject.name,
    });
    expect(
      (await db.pendingOperations.toArray()).map(
        (operation) => operation.entity,
      ),
    ).toEqual(["subject"]);
    expect(await db.recoveryCopies.count()).toBe(2);
  });

  it("pauses a parent deletion for a remote child edit even after the local child was deleted", async () => {
    const db = await account();
    const disagreement = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "session",
        record_id: session.id,
        local_snapshot: { action: "delete", payload: null },
        remote_snapshot: { action: "upsert", payload: { session, slices } },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    expect(await hasUnresolvedConflict(db, "subject", subject.id)).toBe(true);
    expect(await protectRemoteSubjectDeletion(db, subject.id)).toBe(true);
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: source(),
      created_at: new Date().toISOString(),
    });
    await enqueueOperation(db, "subject", subject.id, "delete", null);
    await resolveConflict(db, disagreement.id, "remote");
    expect(await db.subjects.get(subject.id)).toEqual(subject);
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(
      (await db.pendingOperations.toArray()).map(
        (operation) => operation.action,
      ),
    ).toEqual(["upsert"]);
  });

  it("pauses child delete operations whose rows were cleared by a conflicting parent deletion", async () => {
    const db = await account();
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: source(),
      created_at: new Date().toISOString(),
    });
    await enqueueOperation(db, "session", session.id, "delete", null);
    await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "delete", payload: null },
        remote_snapshot: { action: "upsert", payload: subject },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    expect(await hasUnresolvedConflict(db, "session", session.id)).toBe(true);
    expect(
      await hasUnresolvedConflict(db, "session", "unrelated-session"),
    ).toBe(false);
  });

  it("restores locally cascaded children when the cloud's edited parent version is selected", async () => {
    const db = await account();
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: source(),
      created_at: new Date().toISOString(),
    });
    await db.recordRevisions.put({
      entity: "session",
      record_id: session.id,
      server_revision: "1",
      deleted: false,
      updated_at: subject.created_at,
    });
    await enqueueOperation(db, "subject", subject.id, "delete", null);
    await enqueueOperation(db, "session", session.id, "delete", null);
    const disagreement = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "delete", payload: null },
        remote_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Cloud parent edit" },
        },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    await resolveConflict(db, disagreement.id, "remote");
    expect(await db.sessions.toArray()).toEqual([session]);
    expect(await db.slices.toArray()).toEqual(slices);
    expect(await db.pendingOperations.count()).toBe(0);
    expect((await db.subjects.get(subject.id))?.name).toBe("Cloud parent edit");
  });

  it("does not supersede an uncertain child deletion when resolving its parent", async () => {
    const db = await account();
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: source(),
      created_at: new Date().toISOString(),
    });
    await enqueueOperation(db, "session", session.id, "delete", null);
    const [pending] = await db.pendingOperations.toArray();
    await db.pendingOperations.update(pending.sequence!, {
      status: "in_flight",
    });
    const disagreement = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "delete", payload: null },
        remote_snapshot: { action: "upsert", payload: subject },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    await expect(
      resolveConflict(db, disagreement.id, "remote"),
    ).rejects.toThrow("confirm the submitted");
    expect(await listUnresolvedConflicts(db)).toHaveLength(1);
  });

  it("rolls back conflict resolution when sign-out changes the account before commit", async () => {
    const db = await account();
    const disagreement = await conflict(db);
    let checks = 0;
    await expect(
      resolveConflict(db, disagreement.id, "remote", () => {
        if (++checks === 2) throw new Error("Account changed");
      }),
    ).rejects.toThrow("Account changed");
    expect((await db.subjects.get(subject.id))?.name).toBe(
      "Device mathematics",
    );
    expect(await listUnresolvedConflicts(db)).toHaveLength(1);
    expect(await db.pendingOperations.count()).toBe(1);
    expect(await db.recoveryCopies.count()).toBe(1);
  });

  it("resolves parent and dependent cloud tombstones together using their current revisions", async () => {
    const db = await account();
    await seed(db);
    await enqueueOperation(db, "subject", subject.id, "upsert", subject);
    await enqueueOperation(db, "session", session.id, "upsert", {
      session,
      slices,
    });
    await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "session",
        record_id: session.id,
        local_snapshot: { action: "upsert", payload: { session, slices } },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "3",
        source: "pull",
      }),
    );
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "4",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    await resolveConflict(db, parent.id, "local");
    expect(await listUnresolvedConflicts(db)).toEqual([]);
    const operations = await db.pendingOperations.toArray();
    expect(
      operations.find((operation) => operation.entity === "subject")
        ?.base_revision,
    ).toBe("4");
    expect(
      operations.find((operation) => operation.entity === "session")
        ?.base_revision,
    ).toBe("3");
    expect(await db.slices.toArray()).toEqual(slices);
  });

  it("shared settings conflict resolution preserves device preferences", async () => {
    const db = await account();
    await db.preferences.put({
      ...defaults,
      theme: "light",
      notifications: true,
      onboarded: true,
      id: 1,
    });
    const disagreement = await db.transaction("rw", db.tables, async () =>
      preserveConflict(db, {
        entity: "settings",
        record_id: "settings",
        local_snapshot: await readLocalVersion(db, "settings", "settings"),
        remote_snapshot: {
          action: "upsert",
          payload: { minimum: 30, goal: 90, presets: "15,30", weekStart: 0 },
        },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
      }),
    );
    await resolveConflict(db, disagreement.id, "remote");
    expect(await db.preferences.get(1)).toMatchObject({
      minimum: 30,
      goal: 90,
      theme: "light",
      notifications: true,
      onboarded: true,
    });
    expect(canKeepBoth(disagreement)).toBe(false);
  });

  it("retains a late cloud child as a selectable live version after an acknowledged parent-delete cascade", async () => {
    const db = await account();
    // The parent delete has been acknowledged, but its pull cursor has not
    // consumed the child created by another device immediately before it.
    await db.recoveryCopies.add({
      id: crypto.randomUUID(),
      reason: "conflict",
      entity: "subject",
      record_id: subject.id,
      snapshot: source(),
      created_at: new Date().toISOString(),
    });
    await db.recordRevisions.put({
      entity: "subject",
      record_id: subject.id,
      server_revision: "2",
      deleted: true,
      updated_at: subject.created_at,
    });
    await db.syncCursors.put({
      stream: "study",
      cursor: "4",
      updated_at: subject.created_at,
    });
    const late = {
      ...session,
      id: "late-cloud-child",
      notes: "Study created by the other device",
    };
    const lateSlices = slices.map((slice) => ({
      ...slice,
      session_id: late.id,
    }));
    const deleteOperation = crypto.randomUUID();
    const adapter: SyncAdapter = {
      apply: async () => {
        throw new Error("No push during pull test");
      },
      changes: async () => ({
        changes: [
          {
            sequence: "5",
            entity: "session",
            record_id: late.id,
            action: "upsert",
            payload: { session: late, slices: lateSlices },
            revision: "1",
            operation_id: crypto.randomUUID(),
          },
          {
            sequence: "6",
            entity: "session",
            record_id: late.id,
            action: "delete",
            payload: null,
            revision: "2",
            operation_id: deleteOperation,
          },
          {
            sequence: "7",
            entity: "subject",
            record_id: subject.id,
            action: "delete",
            payload: null,
            revision: "2",
            operation_id: deleteOperation,
          },
        ],
        cursor: "7",
        has_more: false,
      }),
    };
    await pullChanges(db, adapter, () => {});
    const [disagreement] = await listUnresolvedConflicts(db);
    expect(disagreement.entity).toBe("session");
    expect(disagreement.context?.recovered_local).toBe(true);
    expect(disagreement.local_snapshot).toEqual({
      action: "upsert",
      payload: { session: late, slices: lateSlices },
    });
    expect(disagreement.remote_snapshot).toEqual({
      action: "delete",
      payload: null,
    });
    await resolveConflict(db, disagreement.id, "local");
    expect(await db.subjects.get(subject.id)).toEqual(subject);
    expect(await db.sessions.get(late.id)).toEqual(late);
    expect(await db.slices.toArray()).toEqual(lateSlices);
    const operations = await db.pendingOperations.toArray();
    expect(
      operations.find((operation) => operation.entity === "subject")
        ?.base_revision,
    ).toBe("2");
    expect(
      operations.find((operation) => operation.entity === "session")
        ?.base_revision,
    ).toBe("2");
    expect(await listUnresolvedConflicts(db)).toEqual([]);
  });

  it("does not regress a newer pulled conflict version when an older operation receipt arrives", async () => {
    const db = await account();
    const disagreement = await conflict(db);
    await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Device mathematics" },
        },
        remote_snapshot: {
          action: "upsert",
          payload: { ...subject, name: "Old receipt version" },
        },
        base_revision: null,
        remote_revision: "1",
        source: "push",
      }),
    );
    const saved = (await listUnresolvedConflicts(db))[0];
    expect(saved.id).toBe(disagreement.id);
    expect(saved.remote_revision).toBe("2");
    expect(saved.remote_snapshot).toEqual(disagreement.remote_snapshot);
    await resolveConflict(db, saved.id, "remote");
    expect(
      (await db.recordRevisions.get(["subject", subject.id]))?.server_revision,
    ).toBe("2");
  });

  it("keeps a separate staged-import conflict unresolved when a cloud parent deletion is chosen", async () => {
    const db = await account();
    await seed(db);
    const incoming = {
      session: { ...session, notes: "Divergent imported version" },
      slices,
    };
    const imported = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "session",
        record_id: session.id,
        local_snapshot: { action: "upsert", payload: { session, slices } },
        remote_snapshot: { action: "upsert", payload: incoming },
        base_revision: "1",
        remote_revision: "1",
        source: "legacy",
        kind: "import",
      }),
    );
    const parent = await db.transaction("rw", db.tables, () =>
      preserveConflict(db, {
        entity: "subject",
        record_id: subject.id,
        local_snapshot: { action: "upsert", payload: subject },
        remote_snapshot: { action: "delete", payload: null },
        base_revision: "1",
        remote_revision: "2",
        source: "pull",
        kind: "parent_deleted",
      }),
    );
    await resolveConflict(db, parent.id, "remote");
    expect(await db.subjects.get(subject.id)).toBeUndefined();
    expect(await db.sessions.count()).toBe(0);
    expect((await listUnresolvedConflicts(db)).map((item) => item.id)).toEqual([
      imported.id,
    ]);
    expect((await db.conflicts.get(imported.id))?.remote_snapshot).toEqual({
      action: "upsert",
      payload: incoming,
    });
  });
});
