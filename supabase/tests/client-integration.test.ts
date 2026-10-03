import "fake-indexeddb/auto";
import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { defaults, type Data, type Subject } from "../../src/models";
import {
  enqueueOperation,
  initialize,
  readData,
  restoreData,
  StrideDatabase,
} from "../../src/lib/local-database";
import { createSyncAdapter } from "../../src/lib/sync/client";
import { SyncWorker } from "../../src/lib/sync/worker";

// This suite is launched only by the local-stack runner. Real SDK Auth and
// PostgREST requests use disposable users; IndexedDB devices are independent.
// It intentionally refuses a hosted URL or missing local credentials.
const api = new URL(
  process.env.STRIDE_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321",
);
const publicKey = process.env.STRIDE_LOCAL_SUPABASE_PUBLIC_KEY;
const adminKey = process.env.STRIDE_LOCAL_SUPABASE_ADMIN_KEY;
if (
  api.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(api.hostname) ||
  !api.port ||
  api.pathname !== "/" ||
  api.username ||
  api.password ||
  api.search ||
  api.hash ||
  !publicKey ||
  !adminKey
)
  throw new Error(
    "Client integration requires the disposable loopback Supabase stack and its local runner keys.",
  );

interface Account {
  id: string;
  email: string;
  password: string;
}
interface Device {
  db: StrideDatabase;
  client: SupabaseClient;
  worker: SyncWorker;
}
const accounts: Account[] = [];
const devices: Device[] = [];

async function admin(path: string, method: string, body?: unknown) {
  const url = new URL(path, api);
  if (url.origin !== api.origin)
    throw new Error("Local test escaped its loopback origin.");
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30_000),
    headers: {
      apikey: adminKey!,
      Authorization: `Bearer ${adminKey}`,
      "Content-Type": "application/json",
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok)
    throw new Error(
      `Disposable Auth administration failed: HTTP ${response.status}.`,
    );
  return response.status === 204 ? null : response.json();
}

async function createAccount() {
  const email = `stride-phase5-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const user = await admin("/auth/v1/admin/users", "POST", {
    email,
    password,
    email_confirm: true,
  });
  if (typeof user?.id !== "string")
    throw new Error("Disposable Auth user lacked an ID.");
  const account = { id: user.id, email, password };
  accounts.push(account);
  return account;
}

async function device(
  account: Account,
  transport: typeof fetch = fetch,
): Promise<Device> {
  const client = createClient(api.origin, publicKey!, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
    global: { fetch: transport },
  });
  const signedIn = await client.auth.signInWithPassword({
    email: account.email,
    password: account.password,
  });
  if (signedIn.error || signedIn.data.user?.id !== account.id)
    throw new Error("Disposable account did not establish a real SDK session.");
  const db = new StrideDatabase(
    `stride-integration-${randomUUID()}`,
    account.id,
  );
  await initialize(db, null);
  const worker = new SyncWorker(
    db,
    createSyncAdapter(client, account.id, () => {}),
    () => {},
  );
  const value = { db, client, worker };
  devices.push(value);
  worker.start();
  await sync(value);
  return value;
}

async function sync(value: Device) {
  for (let n = 0; n < 5; n++) {
    if (!(await value.worker.syncNow()))
      throw new Error(
        `Real client sync failed: ${value.worker.getSnapshot().phase}.`,
      );
    if (!(await value.db.pendingOperations.count())) return;
  }
  throw new Error("Real client did not drain its bounded outbox.");
}

const subject: Subject = {
  id: "integration-subject",
  name: "Phase 5 integration",
  description: "Disposable local-stack data",
  icon: "book",
  color: "#8b91e8",
  created_at: "2026-09-21T10:00:00.000Z",
  archived: 0,
};
const history: Data = {
  subjects: [subject],
  sessions: [
    {
      id: "integration-session",
      subject_id: subject.id,
      started_at: "2026-09-21T15:50:00.000Z",
      ended_at: "2026-09-21T16:30:00.000Z",
      duration_seconds: 2400,
      session_title: "Recorded allocation days",
      notes: "Real PostgREST client test",
      mode: "stopwatch",
      completed: 1,
    },
  ],
  slices: [
    { session_id: "integration-session", day: "2026-09-21", seconds: 1200 },
    { session_id: "integration-session", day: "2026-09-22", seconds: 1200 },
  ],
  settings: {
    ...defaults,
    goal: 75,
    onboarded: true,
    theme: "light",
    notifications: true,
  },
  running: null,
};

async function edit(value: Device, name: string) {
  await value.db.transaction(
    "rw",
    value.db.subjects,
    value.db.pendingOperations,
    value.db.recordRevisions,
    async () => {
      const changed = { ...subject, name };
      await value.db.subjects.put(changed);
      await enqueueOperation(
        value.db,
        "subject",
        subject.id,
        "upsert",
        changed,
      );
    },
  );
}

describe("real local Supabase SDK Auth, adapter, and sync worker", () => {
  let first: Account;
  let second: Account;
  let a: Device;
  let b: Device;

  beforeAll(async () => {
    first = await createAccount();
    second = await createAccount();
    a = await device(first);
    b = await device(first);
  });

  afterAll(async () => {
    for (const value of devices) value.worker.stop();
    const failures: string[] = [];
    for (const value of devices) {
      try {
        await value.client.auth.signOut({ scope: "local" });
        await value.db.delete();
      } catch {
        failures.push("Disposable client cleanup failed.");
      }
    }
    for (const account of accounts) {
      try {
        await admin(
          `/auth/v1/admin/users/${encodeURIComponent(account.id)}`,
          "DELETE",
        );
      } catch {
        failures.push("Disposable Auth user cleanup failed.");
      }
    }
    if (failures.length) throw new Error(failures.join(" "));
  });

  it("pushes and pulls subjects, complete sessions, allocations and shared settings", async () => {
    await restoreData(history, a.db);
    await sync(a);
    await sync(b);
    const received = await readData(b.db);
    expect(received.subjects).toEqual(history.subjects);
    expect(received.sessions).toEqual(history.sessions);
    expect(received.slices).toEqual(history.slices);
    expect(received.settings).toMatchObject({
      goal: 75,
      theme: "dark",
      notifications: false,
      onboarded: false,
    });
    expect(await b.db.syncCursors.count()).toBe(1);
    expect(await b.db.recordRevisions.count()).toBe(3);
  });

  it("retries the same request after a real server commit loses its acknowledgement", async () => {
    let drop = false;
    const attempts: unknown[] = [];
    const transport: typeof fetch = async (input, init) => {
      const response = await fetch(input, init);
      if (String(input).includes("/rest/v1/rpc/apply_sync_operation")) {
        attempts.push(JSON.parse(String(init?.body)));
        if (drop && response.ok) {
          drop = false;
          throw new Error("Injected lost acknowledgment after real commit");
        }
      }
      return response;
    };
    const c = await device(first, transport);
    drop = true;
    await edit(c, "Lost acknowledgment version");
    expect(await c.worker.syncNow()).toBe(false);
    await sync(c);
    expect(attempts.length).toBeGreaterThanOrEqual(2);
    expect(attempts.at(-1)).toEqual(attempts[0]);
    expect(await c.db.pendingOperations.count()).toBe(0);
    expect(await c.db.conflicts.count()).toBe(0);
    await sync(a);
    await sync(b);
  });

  it("preserves concurrent edit versions instead of overwriting pending local data", async () => {
    b.worker.stop();
    await edit(b, "Device B pending version");
    await edit(a, "Device A committed version");
    await sync(a);
    b.worker.start();
    expect(await b.worker.syncNow()).toBe(true);
    expect((await readData(b.db)).subjects[0].name).toBe(
      "Device B pending version",
    );
    const conflicts = await b.db.conflicts.toArray();
    expect(conflicts.filter((conflict) => !conflict.resolved_at)).toHaveLength(
      1,
    );
    expect(JSON.stringify(conflicts)).toContain("Device A committed version");
    expect(JSON.stringify(conflicts)).toContain("Device B pending version");
    expect(await b.db.pendingOperations.count()).toBe(1);
  });

  it("isolates a second real authenticated account and denies anonymous RPCs", async () => {
    const other = await device(second);
    expect((await readData(other.db)).subjects).toHaveLength(0);
    await restoreData(
      {
        ...history,
        subjects: [{ ...subject, name: "Second account history" }],
      },
      other.db,
    );
    await sync(other);
    expect((await readData(a.db)).subjects[0].name).toBe(
      "Device A committed version",
    );
    expect((await readData(other.db)).subjects[0].name).toBe(
      "Second account history",
    );
    const anonymous = createClient(api.origin, publicKey!, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
        detectSessionInUrl: false,
      },
    });
    const denied = await anonymous.rpc("get_sync_changes", {
      p_after: "0",
      p_limit: 1,
    });
    expect([401, 403]).toContain(denied.status);
    expect(denied.error).not.toBeNull();
  });

  it("pulls real child and parent tombstones without inferring deletes from absent rows", async () => {
    const receiver = await device(first);
    await a.db.transaction(
      "rw",
      a.db.subjects,
      a.db.sessions,
      a.db.slices,
      a.db.pendingOperations,
      a.db.recordRevisions,
      async () => {
        await a.db.subjects.delete(subject.id);
        await a.db.sessions.delete("integration-session");
        await a.db.slices
          .where("session_id")
          .equals("integration-session")
          .delete();
        await enqueueOperation(a.db, "subject", subject.id, "delete", null);
      },
    );
    await sync(a);
    await sync(receiver);
    const received = await readData(receiver.db);
    expect(received.subjects).toHaveLength(0);
    expect(received.sessions).toHaveLength(0);
    expect(received.slices).toHaveLength(0);
    expect(
      (await receiver.db.recordRevisions.toArray()).filter(
        (revision) => revision.deleted,
      ),
    ).toHaveLength(2);
  });

  it("recognizes a real foreign-key rollback as definitive and leaves the cloud feed unchanged", async () => {
    const adapter = createSyncAdapter(a.client, first.id, () => {});
    const cursor = (await a.db.syncCursors.toArray())[0].cursor;
    const before = await adapter.changes(cursor, 100);
    const id = "integration-rejected-child";
    await expect(
      adapter.apply({
        id: randomUUID(),
        entity: "session",
        record_id: id,
        action: "upsert",
        payload: {
          session: { ...history.sessions[0], id },
          slices: history.slices.map((slice) => ({ ...slice, session_id: id })),
        },
        base_revision: null,
      }),
    ).rejects.toMatchObject({ kind: "permanent", definitiveNoCommit: true });
    expect(await adapter.changes(cursor, 100)).toEqual(before);
  });
});
