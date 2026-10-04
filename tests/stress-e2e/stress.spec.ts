import { readFile } from "node:fs/promises";
import {
  expect,
  test as base,
  type Browser,
  type Page,
  type Route,
} from "@playwright/test";
import type { Data, Session, Slice } from "../../src/models";
import { authOrigin, mockAuth, signIn, users } from "../auth-mock";
import {
  SqlSyncServer,
  device,
  saveSession,
  saveSubject,
  session,
  settle,
  signOut,
  slices,
  snapshot,
  subject,
  syncNow,
} from "../sync-fixture";

// Each successful study RPC uses the real, unchanged Phase 3 SQL. These
// transport faults are test-only; nothing is added to the application bundle.
const test = base.extend<{ cloud: SqlSyncServer }>({
  cloud: async ({}, use) => {
    const cloud = await SqlSyncServer.create();
    try {
      await use(cloud);
    } finally {
      await cloud.close();
    }
  },
});

test.afterEach(async ({ browser }) => {
  await Promise.all(browser.contexts().map((context) => context.close()));
});

async function stressDevice(
  browser: Browser,
  cloud: SqlSyncServer,
  timezone: string | null = "Asia/Manila",
) {
  const profile = await browser.newContext({
    baseURL: "http://127.0.0.1:1429",
    ...(timezone ? { timezoneId: timezone } : {}),
    reducedMotion: "reduce",
    viewport: { width: 1440, height: 1000 },
  });
  return device(browser, cloud, { profile });
}

async function workerState(page: Page) {
  return page.evaluate(async () => {
    const { activeSyncWorker } = await import("/src/lib/sync/worker.ts");
    return activeSyncWorker?.getSnapshot();
  });
}

async function interruptRpc(
  page: Page,
  rpc: "get_sync_changes" | "apply_sync_operation",
  reply: (route: Route) => Promise<void>,
) {
  let enabled = true;
  let attempts = 0;
  const blockedAt: number[] = [];
  const resumedAt: number[] = [];
  await page.route(`${authOrigin}/rest/v1/rpc/${rpc}`, async (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    if (!enabled) {
      resumedAt.push(Date.now());
      return route.fallback();
    }
    ++attempts;
    blockedAt.push(Date.now());
    await reply(route);
  });
  return {
    attempts: () => attempts,
    blockedAt: () => blockedAt,
    resumedAt: () => resumedAt,
    restore: () => {
      enabled = false;
    },
  };
}

async function resolveAllWithCloud(page: Page) {
  await page.evaluate(async () => {
    const { activeSyncWorker } = await import("/src/lib/sync/worker.ts");
    const { resolveConflict } = await import("/src/lib/sync/conflicts.ts");
    if (!activeSyncWorker) throw new Error("No account worker");
    await activeSyncWorker.runExclusive(async (db, guard) => {
      const conflicts = await db.conflicts
        .filter((row) => !row.resolved_at)
        .toArray();
      for (const conflict of conflicts)
        await resolveConflict(db, conflict.id, "remote", guard);
    });
  });
}

test("three devices preserve sequential revisions, simultaneous offline histories, and competing versions through repeated reconnects", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  const b = await stressDevice(browser, cloud);
  const c = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await Promise.all([syncNow(b.page), syncNow(c.page)]);
  let previousRevision = 0n;
  for (let edit = 1; edit <= 3; ++edit) {
    const value = subject("shared-subject", `Sequential version ${edit}`);
    await saveSubject(a.page, value);
    await settle(a.page);
    await Promise.all([syncNow(b.page), syncNow(c.page)]);
    for (const target of [a, b, c])
      expect((await snapshot(target.page)).data.subjects).toEqual([value]);
    const revision = BigInt(
      (await snapshot(c.page)).revisions.find(
        (row) => row.entity === "subject",
      )!.server_revision,
    );
    expect(revision).toBeGreaterThan(previousRevision);
    previousRevision = revision;
  }
  await Promise.all([
    a.context.setOffline(true),
    b.context.setOffline(true),
    c.context.setOffline(true),
  ]);
  for (const [index, target] of [a, b, c].entries()) {
    await saveSubject(
      target.page,
      subject("shared-subject", `Offline device ${index + 1}`),
    );
    await saveSubject(
      target.page,
      subject(`device-parent-${index + 1}`, `Independent device ${index + 1}`),
    );
    await saveSession(
      target.page,
      session(`offline-history-${index + 1}`, `device-parent-${index + 1}`),
      slices(`offline-history-${index + 1}`),
    );
    expect(await syncNow(target.page)).toBe(false);
    expect((await snapshot(target.page)).operations).toHaveLength(3);
  }
  await a.context.setOffline(false);
  await settle(a.page);
  await Promise.all([b.context.setOffline(false), c.context.setOffline(false)]);
  await Promise.all([
    syncNow(b.page),
    syncNow(b.page),
    syncNow(c.page),
    syncNow(c.page),
  ]);
  for (const [index, target] of [b, c].entries()) {
    const captured = await snapshot(target.page);
    const conflict = captured.conflicts.find(
      (row) => row.entity === "subject" && !row.resolved_at,
    )!;
    expect(conflict).toBeDefined();
    expect(JSON.stringify(conflict.local_snapshot)).toContain(
      `Offline device ${index + 2}`,
    );
    expect(captured.data.sessions).toContainEqual(
      session(`offline-history-${index + 2}`, `device-parent-${index + 2}`),
    );
    await resolveAllWithCloud(target.page);
  }
  await Promise.all([settle(b.page), settle(c.page)]);
  await Promise.all([syncNow(a.page), syncNow(b.page), syncNow(c.page)]);
  const expectedIds = [
    "offline-history-1",
    "offline-history-2",
    "offline-history-3",
  ];
  for (const target of [a, b, c]) {
    const result = await snapshot(target.page);
    expect(result.data.sessions.map((row) => row.id).sort()).toEqual(
      expectedIds,
    );
    expect(result.data.slices).toHaveLength(6);
    expect(result.data.subjects).toHaveLength(4);
    expect(result.operations).toHaveLength(0);
    expect(result.conflicts.filter((row) => !row.resolved_at)).toHaveLength(0);
  }
  expect(await cloud.rows("sessions")).toHaveLength(3);
  expect(await cloud.rows("allocations")).toHaveLength(6);
  const duplicateReceipts = await cloud.db.query(
    "select operation_id from stride_private.stride_sync_operations group by owner_id, operation_id having count(*) > 1",
  );
  expect(duplicateReceipts.rows).toHaveLength(0);
});

for (const status of [429, 500, 502, 503]) {
  test(`HTTP ${status} keeps a frozen study request recoverable and later commits once`, async ({
    browser,
    cloud,
  }) => {
    const a = await stressDevice(browser, cloud);
    await saveSubject(a.page);
    await settle(a.page);
    const fault = await interruptRpc(a.page, "apply_sync_operation", (route) =>
      route.fulfill({
        status,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-expose-headers": "Retry-After",
          "retry-after": status === 429 ? "0.25" : "0",
        },
        contentType: "application/json",
        body: JSON.stringify({
          code: "TEST_TRANSPORT_FAILURE",
          message: "Temporary test outage",
        }),
      }),
    );
    const recorded = session(`http-${status}`);
    await saveSession(a.page, recorded, slices(recorded.id));
    expect(await syncNow(a.page)).toBe(false);
    const failed = await snapshot(a.page);
    expect(failed.data.sessions).toEqual([recorded]);
    expect(failed.data.slices).toEqual(slices(recorded.id));
    expect(failed.operations).toHaveLength(1);
    expect(failed.operations[0].status).toBe("in_flight");
    expect(failed.operations[0].wire_request?.id).toBe(failed.operations[0].id);
    expect((await workerState(a.page))?.phase).toBe("offline");
    expect(
      JSON.parse(
        failed.metadata.find((row) => row.key === "last_sync_error")!.value,
      ).kind,
    ).toBe("transient");
    expect(await cloud.rows("sessions")).toHaveLength(0);
    fault.restore();
    await settle(a.page);
    if (status === 429)
      expect(
        fault.resumedAt()[0] - fault.blockedAt().at(-1)!,
      ).toBeGreaterThanOrEqual(250);
    expect(fault.attempts()).toBeGreaterThanOrEqual(1);
    const successful = cloud.calls.filter(
      (call) =>
        call.name === "apply_sync_operation" &&
        call.body.p_record_id === recorded.id,
    );
    expect(successful).toHaveLength(1);
    expect(successful[0].body.p_operation_id).toBe(failed.operations[0].id);
    expect(await cloud.rows("sessions")).toHaveLength(1);
    expect((await snapshot(a.page)).operations).toHaveLength(0);
  });
}

test("an expired-token RPC rejection requests account attention without retrying or dropping its frozen change", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  const fault = await interruptRpc(a.page, "apply_sync_operation", (route) =>
    route.fulfill({
      status: 401,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({ code: "PGRST303", message: "JWT expired" }),
    }),
  );
  await saveSession(a.page, session("expired-rpc"), slices("expired-rpc"));
  expect(await syncNow(a.page)).toBe(false);
  const rejected = await snapshot(a.page);
  expect(rejected.data.sessions).toEqual([session("expired-rpc")]);
  expect(rejected.operations).toHaveLength(1);
  expect(rejected.operations[0].status).toBe("in_flight");
  expect((await workerState(a.page))?.phase).toBe("auth");
  expect((await workerState(a.page))?.nextRetryAt).toBeNull();
  await expect(
    a.page.getByRole("button", {
      name: "Synchronization: Account needs attention",
      exact: true,
    }),
  ).toBeVisible();
  expect(await cloud.rows("sessions")).toHaveLength(0);
  fault.restore();
  await a.page.evaluate(async () => {
    const { supabase } = await import("/src/lib/supabase.ts");
    if (!supabase) throw new Error("No test client");
    const { error } = await supabase.auth.refreshSession();
    if (error) throw new Error("Test session refresh failed");
  });
  await settle(a.page);
  const retried = cloud.calls.find(
    (call) =>
      call.name === "apply_sync_operation" &&
      call.body.p_record_id === "expired-rpc",
  )!;
  expect(retried.body.p_operation_id).toBe(rejected.operations[0].id);
  expect(await cloud.rows("sessions")).toHaveLength(1);
});

test("intermittent total offline periods keep each locally recorded session and drain the queue after every reconnect", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  const b = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  for (let cycle = 1; cycle <= 3; ++cycle) {
    await a.context.setOffline(true);
    const recorded = session(`reconnect-${cycle}`);
    await saveSession(a.page, recorded, slices(recorded.id));
    expect(await syncNow(a.page)).toBe(false);
    expect((await snapshot(a.page)).data.sessions).toHaveLength(cycle);
    expect((await snapshot(a.page)).operations).toHaveLength(1);
    expect((await workerState(a.page))?.phase).toBe("offline");
    await a.context.setOffline(false);
    await settle(a.page);
    await syncNow(b.page);
    expect((await snapshot(b.page)).data.sessions).toHaveLength(cycle);
    expect((await snapshot(b.page)).data.slices).toHaveLength(cycle * 2);
  }
  expect(await cloud.rows("sessions")).toHaveLength(3);
});

test("a malformed pull cannot advance the cursor or replace local data, and a healthy manual retry recovers", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  const before = await snapshot(a.page);
  const fault = await interruptRpc(a.page, "get_sync_changes", (route) =>
    route.fulfill({
      status: 200,
      headers: { "access-control-allow-origin": "*" },
      contentType: "application/json",
      body: JSON.stringify({ changes: [], cursor: "99999", has_more: false }),
    }),
  );
  await saveSession(a.page);
  expect(await syncNow(a.page)).toBe(false);
  const rejected = await snapshot(a.page);
  expect(rejected.cursors).toEqual(before.cursors);
  expect(rejected.data.subjects).toEqual(before.data.subjects);
  expect(rejected.data.sessions).toEqual([session()]);
  expect(rejected.operations).toHaveLength(1);
  expect((await workerState(a.page))?.phase).toBe("error");
  expect(
    JSON.parse(
      rejected.metadata.find((row) => row.key === "last_sync_error")!.value,
    ).kind,
  ).toBe("malformed");
  fault.restore();
  await settle(a.page);
  expect(await cloud.rows("sessions")).toHaveLength(1);
  expect((await snapshot(a.page)).data.slices).toEqual(slices());
});

test("an aborted dispatch retries the identical frozen operation rather than inventing another cloud edit", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  const fault = await interruptRpc(a.page, "apply_sync_operation", (route) =>
    route.abort("connectionreset"),
  );
  await saveSession(a.page);
  expect(await syncNow(a.page)).toBe(false);
  const frozen = (await snapshot(a.page)).operations[0];
  expect(frozen.status).toBe("in_flight");
  expect(frozen.wire_request?.id).toBe(frozen.id);
  expect(await cloud.rows("sessions")).toHaveLength(0);
  fault.restore();
  await settle(a.page);
  const retried = cloud.calls.find(
    (call) =>
      call.name === "apply_sync_operation" &&
      call.body.p_record_id === session().id,
  )!;
  expect(retried.body.p_operation_id).toBe(frozen.id);
  expect(retried.body.p_payload).toEqual(frozen.wire_request?.payload);
  expect(await cloud.rows("sessions")).toHaveLength(1);
  expect(await cloud.rows("allocations")).toHaveLength(2);
});

test("a real 30-second slow-response timeout preserves the complete page and pending local history before retry", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  const b = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await syncNow(b.page);
  await saveSubject(
    a.page,
    subject("remote-after-timeout", "Remote delayed history"),
  );
  await settle(a.page);
  await b.context.setOffline(true);
  await saveSession(b.page, session("local-timeout"), slices("local-timeout"));
  const before = await snapshot(b.page);
  const gate = cloud.holdNextPull(b.page);
  let pending: Promise<unknown> | undefined;
  try {
    await b.context.setOffline(false);
    const started = Date.now();
    pending = syncNow(b.page);
    await gate.captured;
    expect((await workerState(b.page))?.phase).toBe("syncing");
    expect(await pending).toBe(false);
    const duration = Date.now() - started;
    expect(duration).toBeGreaterThanOrEqual(29_000);
    expect(duration).toBeLessThan(45_000);
    const timedOut = await snapshot(b.page);
    expect(timedOut.cursors).toEqual(before.cursors);
    expect(timedOut.data).toEqual(before.data);
    expect(timedOut.operations).toEqual(before.operations);
    expect((await workerState(b.page))?.phase).toBe("offline");
    gate.release();
    await settle(b.page);
    expect((await snapshot(b.page)).data.subjects).toHaveLength(2);
    expect((await snapshot(b.page)).data.sessions).toEqual([
      session("local-timeout"),
    ]);
    expect(await cloud.rows("sessions")).toHaveLength(1);
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
  }
});

test("closing the app during a committed push reopens the same cache and acknowledges one receipt with the same UUID", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  await a.context.setOffline(true);
  await saveSession(
    a.page,
    session("close-during-push"),
    slices("close-during-push"),
  );
  const gate = cloud.holdNextAcknowledgment();
  let pending: Promise<unknown> | undefined;
  try {
    await a.context.setOffline(false);
    pending = syncNow(a.page).catch(() => undefined);
    await gate.committed;
    const first = cloud.calls.find(
      (call) =>
        call.name === "apply_sync_operation" &&
        call.body.p_record_id === "close-during-push",
    )!;
    expect(await cloud.rows("sessions")).toHaveLength(1);
    await a.page.close();
    gate.release();
    await pending;
    const reopened = await a.context.newPage();
    await mockAuth(reopened);
    await cloud.attach(reopened);
    await reopened.goto("/");
    await expect(
      reopened.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await settle(reopened);
    expect((await snapshot(reopened)).data.sessions).toEqual([
      session("close-during-push"),
    ]);
    expect((await snapshot(reopened)).data.slices).toEqual(
      slices("close-during-push"),
    );
    const retries = cloud.calls.filter(
      (call) =>
        call.name === "apply_sync_operation" &&
        call.body.p_record_id === "close-during-push",
    );
    expect(retries.length).toBeGreaterThanOrEqual(2);
    expect(
      retries.every(
        (call) => JSON.stringify(call.body) === JSON.stringify(first.body),
      ),
    ).toBe(true);
    const receipts = await cloud.db.query<{ n: number }>(
      "select count(*)::integer as n from stride_private.stride_sync_operations where owner_id = $1 and operation_id = $2",
      [users["first@example.test"], first.body.p_operation_id],
    );
    expect(receipts.rows[0].n).toBe(1);
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
  }
});

test("refresh during pull discards the late response and replays the unchanged cursor after restoration", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  const b = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await saveSession(a.page);
  await settle(a.page);
  const gate = cloud.holdNextPull(b.page);
  let pending: Promise<unknown> | undefined;
  try {
    pending = syncNow(b.page).catch(() => undefined);
    await gate.captured;
    await b.page.reload();
    gate.release();
    await pending;
    await expect(
      b.page.getByRole("heading", { name: "Keep your stride." }),
    ).toBeVisible();
    await settle(b.page);
    expect((await snapshot(b.page)).data.sessions).toEqual([session()]);
    expect((await snapshot(b.page)).data.slices).toEqual(slices());
    expect((await snapshot(b.page)).conflicts).toHaveLength(0);
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
  }
});

test("sign-out during a captured pull cannot write another account's cache or expose the first account's history", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  const b = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await saveSession(a.page);
  await settle(a.page);
  const gate = cloud.holdNextPull(b.page);
  let pending: Promise<unknown> | undefined;
  try {
    pending = syncNow(b.page);
    await gate.captured;
    await signOut(b.page);
    await signIn(b.page, "second@example.test");
    await b.page.evaluate(async () => {
      const storage = await import("/src/lib/storage.ts");
      await storage
        .getActiveDatabase()
        .preferences.update(1, { onboarded: true });
    });
    gate.release();
    await pending;
    await syncNow(b.page);
    const second = await snapshot(b.page);
    expect(second.data.subjects).toHaveLength(0);
    expect(second.data.sessions).toHaveLength(0);
    expect(second.data.slices).toHaveLength(0);
    expect(second.conflicts).toHaveLength(0);
    expect(second.operations).toHaveLength(0);
    expect(
      await cloud.rows("sessions", users["second@example.test"]),
    ).toHaveLength(0);
  } finally {
    gate.release();
    await pending?.catch(() => undefined);
  }
});

test("an expired saved session with failed refresh closes the gate while retaining its local outbox for later sign-in", async ({
  browser,
  cloud,
}) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await settle(a.page);
  cloud.unavailable = true;
  await saveSession(
    a.page,
    session("refresh-preserved"),
    slices("refresh-preserved"),
  );
  await syncNow(a.page);
  const original = await snapshot(a.page);
  let refreshCalls = 0;
  await a.page.route(
    `${authOrigin}/auth/v1/token?grant_type=refresh_token`,
    async (route) => {
      ++refreshCalls;
      await route.fulfill({
        status: 400,
        headers: { "access-control-allow-origin": "*" },
        contentType: "application/json",
        body: JSON.stringify({
          code: "refresh_token_not_found",
          message: "Invalid Refresh Token: Refresh Token Not Found",
        }),
      });
    },
  );
  await a.page.evaluate(() => {
    const key = "stride-auth-v1-fotgomkjwbahxmmovzmn.supabase.co";
    const current = JSON.parse(localStorage.getItem(key)!);
    current.expires_at = Math.floor(Date.now() / 1000) - 60;
    const [header, body, signature] = current.access_token.split(".");
    const claims = JSON.parse(atob(body.replace(/-/g, "+").replace(/_/g, "/")));
    claims.exp = current.expires_at;
    const encoded = btoa(JSON.stringify(claims))
      .replace(/=/g, "")
      .replace(/\+/g, "-")
      .replace(/\//g, "_");
    current.access_token = `${header}.${encoded}.${signature}`;
    localStorage.setItem(key, JSON.stringify(current));
  });
  await a.page.reload();
  await expect(a.page.locator(".auth-screen")).toBeVisible();
  expect(refreshCalls).toBeGreaterThanOrEqual(1);
  const cached = await a.page.evaluate(async (accountId) => {
    const storage = await import("/src/lib/storage.ts");
    const db = new storage.StrideDatabase(
      `stride-account-${accountId}`,
      accountId,
    );
    try {
      return {
        data: await storage.readData(db),
        operations: await db.pendingOperations.toArray(),
      };
    } finally {
      db.close();
    }
  }, users["first@example.test"]);
  expect(cached.data).toEqual(original.data);
  expect(cached.operations).toEqual(original.operations);
  cloud.unavailable = false;
  await signIn(a.page);
  await settle(a.page);
  expect((await snapshot(a.page)).data.sessions).toEqual([
    session("refresh-preserved"),
  ]);
  expect(await cloud.rows("sessions")).toHaveLength(1);
});

test("original midnight and DST study-day allocations survive three timezones, travel, and cloud round trips", async ({
  browser,
  cloud,
}) => {
  const devices = [
    await stressDevice(browser, cloud, null),
    await stressDevice(browser, cloud, "America/New_York"),
    await stressDevice(browser, cloud, "Europe/Berlin"),
  ];
  // Keep this override on one CDP session so it can change during travel;
  // Playwright's context timezone owns a separate immutable override.
  const travel = await devices[0].context.newCDPSession(devices[0].page);
  await travel.send("Emulation.setTimezoneOverride", {
    timezoneId: "Asia/Manila",
  });
  await saveSubject(devices[0].page);
  await settle(devices[0].page);
  await Promise.all(devices.slice(1).map((target) => syncNow(target.page)));
  const cases = [
    {
      owner: 0,
      id: "manila-midnight",
      start: "2026-09-21T15:50:00.000Z",
      end: "2026-09-21T16:20:00.000Z",
      days: [
        ["2026-09-21", 600],
        ["2026-09-22", 1200],
      ],
    },
    {
      owner: 1,
      id: "new-york-midnight",
      start: "2026-03-08T04:50:00.000Z",
      end: "2026-03-08T05:20:00.000Z",
      days: [
        ["2026-03-07", 600],
        ["2026-03-08", 1200],
      ],
    },
    {
      owner: 1,
      id: "new-york-spring-forward",
      start: "2026-03-08T06:50:00.000Z",
      end: "2026-03-08T07:20:00.000Z",
      days: [["2026-03-08", 1800]],
    },
    {
      owner: 1,
      id: "new-york-fall-back",
      start: "2026-11-01T05:50:00.000Z",
      end: "2026-11-01T06:20:00.000Z",
      days: [["2026-11-01", 1800]],
    },
    {
      owner: 2,
      id: "berlin-spring-forward",
      start: "2026-03-29T00:50:00.000Z",
      end: "2026-03-29T01:20:00.000Z",
      days: [["2026-03-29", 1800]],
    },
  ];
  const expected: Slice[] = [];
  for (const item of cases) {
    const record: Session = {
      ...session(item.id),
      started_at: item.start,
      ended_at: item.end,
      duration_seconds: 1800,
      session_title: item.id,
    };
    const allocated = await devices[item.owner].page.evaluate(async (value) => {
      const { splitSegments } = await import("/src/lib/analytics.ts");
      return splitSegments(value.id, [
        {
          start: Date.parse(value.started_at),
          end: Date.parse(value.ended_at),
        },
      ]);
    }, record);
    expect(allocated.map((slice) => [slice.day, slice.seconds])).toEqual(
      item.days,
    );
    expected.push(...allocated);
    await saveSession(devices[item.owner].page, record, allocated);
    await settle(devices[item.owner].page);
  }
  const ordered = (values: Slice[]) =>
    values
      .slice()
      .sort((a, b) =>
        `${a.session_id}:${a.day}`.localeCompare(`${b.session_id}:${b.day}`),
      );
  await Promise.all(devices.map((target) => syncNow(target.page)));
  for (const target of devices) {
    expect(ordered((await snapshot(target.page)).data.slices)).toEqual(
      ordered(expected),
    );
    expect((await snapshot(target.page)).data.sessions).toHaveLength(5);
  }
  await travel.send("Emulation.setTimezoneOverride", {
    timezoneId: "Europe/Berlin",
  });
  expect(
    await devices[0].page.evaluate(
      () => Intl.DateTimeFormat().resolvedOptions().timeZone,
    ),
  ).toBe("Europe/Berlin");
  await devices[0].page.reload();
  await settle(devices[0].page);
  expect(ordered((await snapshot(devices[0].page)).data.slices)).toEqual(
    ordered(expected),
  );
  const totals = await Promise.all(
    devices.map((target) =>
      target.page.evaluate(async () => {
        const { readData } = await import("/src/lib/storage.ts");
        const { aggregate } = await import("/src/lib/analytics.ts");
        const data = await readData();
        return [...aggregate(data.sessions, data.slices)].sort(([a], [b]) =>
          a.localeCompare(b),
        );
      }),
    ),
  );
  expect(totals[0]).toEqual(totals[1]);
  expect(totals[0]).toEqual(totals[2]);
  expect(await cloud.rows("allocations")).toHaveLength(expected.length);
});

test("a synced JSON export deduplicates on import and an older version-1 divergent backup stays additive and backup-gated across reload", async ({
  browser,
  cloud,
}, testInfo) => {
  const a = await stressDevice(browser, cloud);
  await saveSubject(a.page);
  await saveSubject(a.page, subject("unrelated", "Unrelated cloud history"));
  await saveSession(a.page);
  await settle(a.page);
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  const downloaded = a.page.waitForEvent("download");
  await a.page
    .getByRole("button", { name: "Export JSON", exact: true })
    .click();
  const path = testInfo.outputPath("synced-workspace.json");
  await (await downloaded).saveAs(path);
  const exported = JSON.parse(await readFile(path, "utf8")) as Data & {
    format: string;
    version: number;
    exportedAt: string;
  };
  expect(exported.version).toBe(1);
  expect(exported.sessions).toEqual([session()]);
  const importSource = async (value: unknown) => {
    await a.page.getByLabel("Import backup file").setInputFiles({
      name: "old-backup.json",
      mimeType: "application/json",
      buffer: Buffer.from(JSON.stringify(value)),
    });
    await expect(
      a.page.getByRole("dialog", { name: "Review backup import" }),
    ).toBeVisible();
    await expect(
      a.page.getByRole("button", { name: "Import history", exact: true }),
    ).toBeDisabled();
  };
  const finishImport = async () => {
    const backup = a.page.waitForEvent("download");
    await a.page
      .getByRole("button", { name: "Download backup", exact: true })
      .click();
    await backup;
    await a.page
      .getByRole("button", { name: "Import history", exact: true })
      .click();
    await expect(
      a.page.getByRole("dialog", { name: "Review backup import" }),
    ).toHaveCount(0);
    await settle(a.page);
  };
  const callsBefore = cloud.calls.filter(
    (call) => call.name === "apply_sync_operation",
  ).length;
  await importSource(exported);
  await finishImport();
  expect((await snapshot(a.page)).data.subjects).toHaveLength(2);
  expect((await snapshot(a.page)).data.sessions).toEqual([session()]);
  expect(
    cloud.calls.filter((call) => call.name === "apply_sync_operation"),
  ).toHaveLength(callsBefore);
  const older = {
    ...exported,
    exportedAt: "2026-09-22T12:00:00.000Z",
    subjects: [subject()],
    sessions: [{ ...session(), notes: "Older divergent backup notes" }],
  };
  await importSource(older);
  await a.page.getByRole("button", { name: "Cancel", exact: true }).click();
  const staged = await snapshot(a.page);
  expect(JSON.stringify(staged.recovery)).toContain(
    "Older divergent backup notes",
  );
  expect(staged.data.sessions).toEqual([session()]);
  await a.page.reload();
  await a.page.getByRole("button", { name: "Settings", exact: true }).click();
  await a.page
    .getByRole("button", { name: "Continue backup import", exact: true })
    .click();
  await expect(
    a.page.getByRole("button", { name: "Import history", exact: true }),
  ).toBeDisabled();
  await finishImport();
  const imported = await snapshot(a.page);
  expect(imported.data.subjects).toHaveLength(2);
  expect(imported.data.sessions).toEqual([session()]);
  const collision = imported.conflicts.find(
    (row) => row.entity === "session" && !row.resolved_at,
  )!;
  expect(collision).toBeDefined();
  expect(JSON.stringify(collision.remote_snapshot)).toContain(
    "Older divergent backup notes",
  );
  const review = a.page
    .locator(".sync-conflict")
    .filter({ hasText: "Two versions of a session need review" });
  await review.locator("summary").click();
  await review.getByRole("button", { name: "Keep both", exact: true }).click();
  await settle(a.page);
  const recovered = await snapshot(a.page);
  expect(recovered.data.subjects).toHaveLength(2);
  expect(recovered.data.sessions).toHaveLength(2);
  expect(recovered.data.sessions).toContainEqual(session());
  expect(
    recovered.data.sessions.find(
      (row) => row.notes === "Older divergent backup notes",
    )?.id,
  ).not.toBe(session().id);
  expect(recovered.data.slices).toHaveLength(4);
  expect(JSON.stringify(recovered.recovery)).toContain(
    "Older divergent backup notes",
  );
  expect(await cloud.rows("sessions")).toHaveLength(2);
});
