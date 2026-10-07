// Run explicitly with Node against a disposable local Supabase stack only.
// Set STRIDE_LOCAL_SUPABASE_URL, STRIDE_LOCAL_SUPABASE_PUBLIC_KEY, and
// STRIDE_LOCAL_SUPABASE_ADMIN_KEY in the process environment. Never use hosted keys.
import assert from "node:assert/strict";
import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { test } from "node:test";

const baseUrl = new URL(
  process.env.STRIDE_LOCAL_SUPABASE_URL ?? "http://127.0.0.1:54321",
);
if (
  baseUrl.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(baseUrl.hostname) ||
  !baseUrl.port ||
  baseUrl.pathname !== "/" ||
  baseUrl.username ||
  baseUrl.password ||
  baseUrl.search ||
  baseUrl.hash
) {
  throw new Error(
    "Integration tests require a plain HTTP loopback Supabase URL with an explicit port",
  );
}

const publicKey = process.env.STRIDE_LOCAL_SUPABASE_PUBLIC_KEY;
const adminKey = process.env.STRIDE_LOCAL_SUPABASE_ADMIN_KEY;
const localJwtSecret = process.env.STRIDE_LOCAL_SUPABASE_JWT_SECRET;
if (!publicKey || !adminKey || !localJwtSecret) {
  throw new Error(
    "Run integration through the loopback-only runner with its local public/admin/JWT credentials",
  );
}

async function request(
  path,
  { method = "GET", key = publicKey, token, body, headers = {} } = {},
) {
  const url = new URL(path, baseUrl);
  if (url.origin !== baseUrl.origin)
    throw new Error("Local integration request escaped the loopback origin");
  const response = await fetch(url, {
    method,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
    headers: {
      apikey: key,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      ...headers,
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const raw = await response.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function assertOk(result, context) {
  assert.ok(
    result.status >= 200 && result.status < 300,
    `${context}: HTTP ${result.status}, code ${result.data?.code ?? "unknown"}`,
  );
  return result.data;
}

function assertDenied(result, context) {
  assert.ok(
    [401, 403].includes(result.status),
    `${context}: expected access denial, got HTTP ${result.status}, code ${result.data?.code ?? "unknown"}`,
  );
}

function assertInvalid(result, context) {
  assert.ok(
    result.status >= 400 && result.status < 500,
    `${context}: expected client error, got HTTP ${result.status}`,
  );
}

async function createUser(label) {
  const email = `stride-phase3-${label}-${randomUUID()}@example.test`;
  const password = randomBytes(24).toString("base64url");
  const created = assertOk(
    await request("/auth/v1/admin/users", {
      method: "POST",
      key: adminKey,
      body: { email, password, email_confirm: true },
    }),
    `create local test user ${label}`,
  );
  try {
    assert.match(created.id, /^[0-9a-f-]{36}$/i);
    const signedIn = assertOk(
      await request("/auth/v1/token?grant_type=password", {
        method: "POST",
        body: { email, password },
      }),
      `sign in local test user ${label}`,
    );
    assert.ok(signedIn.access_token, `missing Auth token for ${label}`);
    return { id: created.id, token: signedIn.access_token };
  } catch (error) {
    if (created.id) {
      try {
        await deleteUser({ id: created.id });
      } catch (cleanupError) {
        throw new AggregateError(
          [error, cleanupError],
          `Could not sign in or remove local test user ${label}`,
        );
      }
    }
    throw error;
  }
}

async function deleteUser(user) {
  const result = await request(
    `/auth/v1/admin/users/${encodeURIComponent(user.id)}`,
    {
      method: "DELETE",
      key: adminKey,
    },
  );
  assertOk(result, "remove local test user");
}

const legalVersion = "2026-10-07";
async function legal(token, action, extra = {}) {
  assert.ok(["get", "record"].includes(action));
  return request(`/rest/v1/rpc/${action}_legal_acceptance`, {
    method: "POST",
    token,
    body: {
      p_terms_version: legalVersion,
      p_privacy_version: legalVersion,
      ...extra,
    },
  });
}
function unconfirmedFixtureToken(id) {
  // A valid local signature crosses the actual PostgREST JWT boundary while
  // the trusted Auth row remains unconfirmed. This is a negative test only;
  // ordinary Supabase Auth cannot issue this user's password session yet.
  // Neither the local signing secret nor this short-lived token is logged.
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "HS256", typ: "JWT" }),
  ).toString("base64url");
  const claims = Buffer.from(
    JSON.stringify({
      sub: id,
      role: "authenticated",
      aud: "authenticated",
      iss: `${baseUrl.origin}/auth/v1`,
      iat: now,
      exp: now + 300,
    }),
  ).toString("base64url");
  const signed = `${header}.${claims}`;
  return `${signed}.${createHmac("sha256", localJwtSecret).update(signed).digest("base64url")}`;
}

async function apply(
  token,
  {
    operationId = randomUUID(),
    entity,
    recordId,
    action = "upsert",
    payload = null,
    revision = null,
  },
) {
  return request("/rest/v1/rpc/apply_sync_operation", {
    method: "POST",
    token,
    body: {
      p_operation_id: operationId,
      p_entity: entity,
      p_record_id: recordId,
      p_action: action,
      p_payload: payload,
      p_expected_revision: revision,
    },
  });
}

async function pull(token, cursor = "0", limit = 100) {
  return request("/rest/v1/rpc/get_sync_changes", {
    method: "POST",
    token,
    body: { p_after: cursor, p_limit: limit },
  });
}

async function rows(token, table, query = "select=*") {
  return request(`/rest/v1/${table}?${query}`, { token });
}

function subject(id, name = "Study") {
  return {
    id,
    name,
    description: "",
    icon: "book",
    color: "#8b91e8",
    created_at: "2026-09-21T10:00:00.000Z",
    archived: 0,
  };
}

function sessionPayload(id, subjectId) {
  return {
    session: {
      id,
      subject_id: subjectId,
      started_at: "2026-09-21T23:50:00.000Z",
      ended_at: "2026-09-22T00:10:00.000Z",
      duration_seconds: 1200,
      session_title: "Practice",
      notes: "",
      mode: "stopwatch",
      completed: 1,
    },
    slices: [
      { session_id: id, day: "2026-09-21", seconds: 600 },
      { session_id: id, day: "2026-09-22", seconds: 600 },
    ],
  };
}

test(
  "local Supabase Auth and PostgREST integration",
  { timeout: 180000 },
  async (t) => {
    const users = [];
    try {
      users.push(await createUser("a"));
      users.push(await createUser("b"));
      const [alice, bob] = users;
      const prefix = `integration-${randomUUID()}`;

      await t.test(
        "public Data API is available; private schema and anonymous data are denied",
        async () => {
          const publicRead = await rows(
            alice.token,
            "stride_subjects",
            "select=id&limit=0",
          );
          assertOk(publicRead, "public schema API exposure");
          const hidden = await request(
            "/rest/v1/stride_sync_changes?select=sequence&limit=0",
            {
              token: alice.token,
              headers: { "Accept-Profile": "stride_private" },
            },
          );
          assert.equal(
            hidden.data?.code,
            "PGRST106",
            `private schema exposure: HTTP ${hidden.status}`,
          );
          assertDenied(
            await rows(undefined, "stride_subjects"),
            "anonymous table read",
          );
          assertDenied(await pull(undefined), "anonymous sync pull");
          assertDenied(
            await apply(undefined, {
              entity: "subject",
              recordId: `${prefix}-anon`,
              payload: subject(`${prefix}-anon`),
            }),
            "anonymous sync write",
          );
        },
      );

      await t.test(
        "two signed-in users have isolated reads, writes, and subject references",
        async () => {
          const sameId = `${prefix}-same-id`;
          assert.equal(
            assertOk(
              await apply(alice.token, {
                entity: "subject",
                recordId: sameId,
                payload: subject(sameId, "Alice only"),
              }),
              "Alice subject",
            ).status,
            "applied",
          );
          assert.equal(
            assertOk(
              await apply(bob.token, {
                entity: "subject",
                recordId: sameId,
                payload: subject(sameId, "Bob only"),
              }),
              "Bob subject",
            ).status,
            "applied",
          );
          const query = `select=id,name&${new URLSearchParams({ id: `eq.${sameId}` })}`;
          assert.deepEqual(
            assertOk(
              await rows(alice.token, "stride_subjects", query),
              "Alice read",
            ).map(({ name }) => name),
            ["Alice only"],
          );
          assert.deepEqual(
            assertOk(
              await rows(bob.token, "stride_subjects", query),
              "Bob read",
            ).map(({ name }) => name),
            ["Bob only"],
          );
          const bobChanges = assertOk(
            await pull(bob.token),
            "Bob same-ID change history",
          ).changes.filter(
            ({ entity, record_id }) =>
              entity === "subject" && record_id === sameId,
          );
          assert.deepEqual(
            bobChanges.map(({ payload }) => payload.name),
            ["Bob only"],
          );
          const directPath = `/rest/v1/stride_subjects?${new URLSearchParams({ id: `eq.${sameId}` })}`;
          assertDenied(
            await request(directPath, {
              method: "PATCH",
              token: alice.token,
              body: { name: "Bypassed sync" },
            }),
            "authenticated direct subject update",
          );
          assertDenied(
            await request(directPath, {
              method: "DELETE",
              token: alice.token,
            }),
            "authenticated direct subject delete",
          );
          assert.deepEqual(
            assertOk(
              await rows(alice.token, "stride_subjects", query),
              "Alice row after denied direct writes",
            ).map(({ name }) => name),
            ["Alice only"],
          );
          const forgedId = `${prefix}-forged`;
          assertInvalid(
            await apply(alice.token, {
              entity: "subject",
              recordId: forgedId,
              payload: { ...subject(forgedId), owner_id: bob.id },
            }),
            "forged RPC owner",
          );
          assertDenied(
            await request("/rest/v1/stride_subjects", {
              method: "POST",
              token: alice.token,
              body: { owner_id: bob.id, ...subject(forgedId) },
            }),
            "direct forged-owner insert",
          );
          const aOnly = `${prefix}-a-only`;
          assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: aOnly,
              payload: subject(aOnly),
            }),
            "Alice private subject",
          );
          assertInvalid(
            await apply(bob.token, {
              entity: "session",
              recordId: `${prefix}-foreign-session`,
              payload: sessionPayload(`${prefix}-foreign-session`, aOnly),
            }),
            "cross-user subject reference",
          );
        },
      );

      await t.test(
        "settings RPC and preference reads are account-isolated",
        async () => {
          const aliceBefore = assertOk(
            await pull(alice.token),
            "Alice settings cursor",
          ).cursor;
          const bobBefore = assertOk(
            await pull(bob.token),
            "Bob settings cursor",
          ).cursor;
          assert.equal(
            assertOk(
              await apply(alice.token, {
                entity: "settings",
                recordId: "settings",
                payload: {
                  minimum: 20,
                  goal: 60,
                  presets: "25,45,60",
                  weekStart: 1,
                },
              }),
              "Alice settings RPC",
            ).status,
            "applied",
          );
          assert.equal(
            assertOk(
              await apply(bob.token, {
                entity: "settings",
                recordId: "settings",
                payload: {
                  minimum: 15,
                  goal: 45,
                  presets: "15,30,45",
                  weekStart: 0,
                },
              }),
              "Bob settings RPC",
            ).status,
            "applied",
          );
          const preferences = "select=minimum,goal,presets,week_start";
          assert.deepEqual(
            assertOk(
              await rows(alice.token, "stride_preferences", preferences),
              "Alice preferences",
            ).map(({ minimum, goal, presets, week_start }) => ({
              minimum,
              goal,
              presets,
              week_start,
            })),
            [{ minimum: 20, goal: 60, presets: "25,45,60", week_start: 1 }],
          );
          assert.deepEqual(
            assertOk(
              await rows(bob.token, "stride_preferences", preferences),
              "Bob preferences",
            ).map(({ minimum, goal, presets, week_start }) => ({
              minimum,
              goal,
              presets,
              week_start,
            })),
            [{ minimum: 15, goal: 45, presets: "15,30,45", week_start: 0 }],
          );
          const aliceChanges = assertOk(
            await pull(alice.token, aliceBefore),
            "Alice settings change",
          ).changes;
          const bobChanges = assertOk(
            await pull(bob.token, bobBefore),
            "Bob settings change",
          ).changes;
          assert.deepEqual(
            aliceChanges.map(({ entity, record_id, payload }) => [
              entity,
              record_id,
              payload.minimum,
            ]),
            [["settings", "settings", 20]],
          );
          assert.deepEqual(
            bobChanges.map(({ entity, record_id, payload }) => [
              entity,
              record_id,
              payload.minimum,
            ]),
            [["settings", "settings", 15]],
          );
        },
      );

      await t.test(
        "session and allocation days are atomic; invalid totals roll back",
        async () => {
          const subjectId = `${prefix}-session-subject`;
          const sessionId = `${prefix}-session`;
          assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: subjectId,
              payload: subject(subjectId),
            }),
            "session subject",
          );
          const before = assertOk(
            await pull(alice.token),
            "pull before invalid session",
          ).cursor;
          const invalid = sessionPayload(sessionId, subjectId);
          invalid.slices[1].seconds = 599;
          const operationId = randomUUID();
          assertInvalid(
            await apply(alice.token, {
              operationId,
              entity: "session",
              recordId: sessionId,
              payload: invalid,
            }),
            "invalid allocation total",
          );
          assert.deepEqual(
            assertOk(
              await rows(
                alice.token,
                "stride_sessions",
                `select=id&id=eq.${sessionId}`,
              ),
              "session after rollback",
            ),
            [],
          );
          assert.equal(
            assertOk(await pull(alice.token), "cursor after rollback").cursor,
            before,
          );
          const duplicateId = `${prefix}-duplicate-day`;
          const duplicateDays = sessionPayload(duplicateId, subjectId);
          duplicateDays.slices[1].day = duplicateDays.slices[0].day;
          assertInvalid(
            await apply(alice.token, {
              entity: "session",
              recordId: duplicateId,
              payload: duplicateDays,
            }),
            "duplicate allocation day",
          );
          assert.deepEqual(
            assertOk(
              await rows(
                alice.token,
                "stride_sessions",
                `select=id&id=eq.${duplicateId}`,
              ),
              "duplicate-day session rollback",
            ),
            [],
          );
          assert.equal(
            assertOk(await pull(alice.token), "cursor after duplicate rollback")
              .cursor,
            before,
          );
          const created = assertOk(
            await apply(alice.token, {
              operationId,
              entity: "session",
              recordId: sessionId,
              payload: sessionPayload(sessionId, subjectId),
            }),
            "valid session retry after rollback",
          );
          assert.equal(created.status, "applied");
          const days = assertOk(
            await rows(
              alice.token,
              "stride_allocations",
              `select=day,seconds&session_id=eq.${sessionId}&order=day.asc`,
            ),
            "daily allocations",
          );
          assert.deepEqual(
            days.map((day) => day.day),
            ["2026-09-21", "2026-09-22"],
          );
          assert.equal(
            days.reduce((sum, day) => sum + Number(day.seconds), 0),
            1200,
          );
          assert.deepEqual(
            assertOk(
              await rows(
                bob.token,
                "stride_allocations",
                `select=day&session_id=eq.${sessionId}`,
              ),
              "Bob allocation read",
            ),
            [],
          );
          const delta = assertOk(
            await pull(alice.token, before),
            "session change",
          ).changes;
          assert.equal(delta.length, 1);
          assert.equal(delta[0].payload.slices.length, 2);
        },
      );

      await t.test(
        "operation IDs give safe retries and stale revisions give conflicts",
        async () => {
          const id = `${prefix}-revision`;
          const input = {
            operationId: randomUUID(),
            entity: "subject",
            recordId: id,
            payload: subject(id, "Original"),
          };
          const before = assertOk(
            await pull(alice.token),
            "retry start cursor",
          ).cursor;
          const [submitted, duplicate] = await Promise.all([
            apply(alice.token, input),
            apply(alice.token, input),
          ]);
          const first = assertOk(submitted, "initial subject");
          assert.deepEqual(
            assertOk(duplicate, "concurrent duplicate request"),
            first,
          );
          assert.equal(
            assertOk(await pull(alice.token, before), "deduplicated changes")
              .changes.length,
            1,
          );
          assert.deepEqual(
            assertOk(await apply(alice.token, input), "same request retry"),
            first,
          );
          assertInvalid(
            await apply(alice.token, {
              ...input,
              payload: subject(id, "Changed under same ID"),
            }),
            "operation ID reuse with different request",
          );
          const updated = assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: id,
              payload: subject(id, "Winner"),
              revision: first.revision,
            }),
            "valid revision update",
          );
          assert.equal(updated.status, "applied");
          const stale = assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: id,
              payload: subject(id, "Stale"),
              revision: first.revision,
            }),
            "stale revision response",
          );
          assert.equal(stale.status, "conflict");
          assert.equal(stale.current_revision, updated.revision);
          assert.deepEqual(
            assertOk(
              await rows(
                alice.token,
                "stride_subjects",
                `select=name&id=eq.${id}`,
              ),
              "winner retained",
            ).map(({ name }) => name),
            ["Winner"],
          );
        },
      );

      await t.test(
        "paginated pull is ordered, owner-scoped, and includes deletion tombstones",
        async () => {
          const start = assertOk(
            await pull(alice.token),
            "start cursor",
          ).cursor;
          const id = `${prefix}-deletion`;
          const child = `${prefix}-deletion-session`;
          const created = assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: id,
              payload: subject(id),
            }),
            "subject for deletion",
          );
          assertOk(
            await apply(alice.token, {
              entity: "session",
              recordId: child,
              payload: sessionPayload(child, id),
            }),
            "child for deletion",
          );
          assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: id,
              action: "delete",
              revision: created.revision,
            }),
            "subject deletion",
          );
          const collected = [];
          let cursor = start;
          for (let page = 0; page < 6; page++) {
            const result = assertOk(
              await pull(alice.token, cursor, 2),
              "paged pull",
            );
            collected.push(...result.changes);
            assert.ok(BigInt(result.cursor) >= BigInt(cursor));
            cursor = result.cursor;
            if (!result.has_more) break;
          }
          assert.deepEqual(
            collected.map(({ entity, action }) => [entity, action]),
            [
              ["subject", "upsert"],
              ["session", "upsert"],
              ["session", "delete"],
              ["subject", "delete"],
            ],
          );
          assert.ok(
            collected.every(
              ({ sequence }, index) =>
                index === 0 ||
                BigInt(sequence) > BigInt(collected[index - 1].sequence),
            ),
          );
          assert.deepEqual(
            assertOk(
              await rows(
                alice.token,
                "stride_sessions",
                `select=id&id=eq.${child}`,
              ),
              "deleted child",
            ),
            [],
          );
          assert.deepEqual(
            assertOk(
              await rows(bob.token, "stride_subjects", `select=id&id=eq.${id}`),
              "Bob deleted subject read",
            ),
            [],
          );
          const bobChanges = assertOk(
            await pull(bob.token),
            "Bob change history",
          ).changes;
          assert.ok(
            bobChanges.every(
              ({ record_id }) => record_id !== id && record_id !== child,
            ),
          );
        },
      );

      await t.test(
        "an out-of-order session can succeed when retried after its subject arrives",
        async () => {
          const subjectId = `${prefix}-late-subject`;
          const sessionId = `${prefix}-late-session`;
          const input = {
            operationId: randomUUID(),
            entity: "session",
            recordId: sessionId,
            payload: sessionPayload(sessionId, subjectId),
          };
          const before = assertOk(
            await pull(bob.token),
            "out-of-order start cursor",
          ).cursor;
          assertInvalid(await apply(bob.token, input), "missing subject");
          assert.equal(
            assertOk(await pull(bob.token), "out-of-order failed cursor")
              .cursor,
            before,
          );
          assertOk(
            await apply(bob.token, {
              entity: "subject",
              recordId: subjectId,
              payload: subject(subjectId),
            }),
            "subject arrives",
          );
          assert.equal(
            assertOk(await apply(bob.token, input), "out-of-order retry")
              .status,
            "applied",
          );
          assert.deepEqual(
            assertOk(
              await rows(
                bob.token,
                "stride_sessions",
                `select=id&id=eq.${sessionId}`,
              ),
              "retried session",
            ).map(({ id }) => id),
            [sessionId],
          );
        },
      );

      await t.test(
        "concurrent requests serialize one winner and preserve the loser as a conflict",
        async () => {
          const id = `${prefix}-race`;
          const created = assertOk(
            await apply(alice.token, {
              entity: "subject",
              recordId: id,
              payload: subject(id, "Before race"),
            }),
            "race subject",
          );
          const before = assertOk(
            await pull(alice.token),
            "race start cursor",
          ).cursor;
          const results = await Promise.all(
            ["First", "Second"].map((name) =>
              apply(alice.token, {
                entity: "subject",
                recordId: id,
                payload: subject(id, name),
                revision: created.revision,
              }),
            ),
          );
          const bodies = results.map((result, index) =>
            assertOk(result, `concurrent request ${index + 1}`),
          );
          assert.deepEqual(bodies.map(({ status }) => status).sort(), [
            "applied",
            "conflict",
          ]);
          assert.equal(
            assertOk(await pull(alice.token, before), "race changes").changes
              .length,
            1,
          );
          const finalName = assertOk(
            await rows(
              alice.token,
              "stride_subjects",
              `select=name&id=eq.${id}`,
            ),
            "race final row",
          )[0].name;
          assert.ok(["First", "Second"].includes(finalName));
        },
      );
      await t.test(
        "every study table denies direct writes and foreign reads; private tables and functions are not API routes",
        async () => {
          const beforeAlice = assertOk(
            await pull(alice.token),
            "access-matrix Alice feed",
          );
          const beforeBob = assertOk(
            await pull(bob.token),
            "access-matrix Bob feed",
          );
          for (const table of [
            "stride_subjects",
            "stride_sessions",
            "stride_allocations",
            "stride_preferences",
          ]) {
            const own = assertOk(
              await rows(alice.token, table, "select=owner_id"),
              `${table} own read`,
            );
            assert.ok(own.length > 0, `${table} fixture must contain own rows`);
            assert.ok(
              own.every((row) => row.owner_id === alice.id),
              `${table} own scope`,
            );
            assert.deepEqual(
              assertOk(
                await rows(
                  alice.token,
                  table,
                  `select=owner_id&${new URLSearchParams({ owner_id: `eq.${bob.id}` })}`,
                ),
                `${table} foreign filter`,
              ),
              [],
            );
            assertDenied(
              await rows(undefined, table),
              `${table} anonymous read`,
            );
            const directPath = `/rest/v1/${table}?${new URLSearchParams({ owner_id: `eq.${alice.id}` })}`;
            for (const token of [undefined, alice.token]) {
              assertDenied(
                await request(`/rest/v1/${table}`, {
                  method: "POST",
                  token,
                  body: { owner_id: bob.id },
                }),
                `${table} direct insert`,
              );
              assertDenied(
                await request(directPath, {
                  method: "PATCH",
                  token,
                  body: { owner_id: bob.id },
                }),
                `${table} direct update`,
              );
              assertDenied(
                await request(directPath, {
                  method: "DELETE",
                  token,
                }),
                `${table} direct delete`,
              );
            }
          }
          const hiddenCore = await request(
            "/rest/v1/rpc/get_sync_changes_core",
            {
              method: "POST",
              token: alice.token,
              headers: { "Content-Profile": "stride_private" },
              body: { p_after: "0", p_limit: 100 },
            },
          );
          assert.equal(
            hiddenCore.data?.code,
            "PGRST106",
            "private RPC schema must stay unexposed",
          );
          for (const name of [
            "get_sync_changes_core",
            "apply_sync_operation_core",
            "append_change",
            "assert_allocation_total",
            "check_allocation_total",
          ]) {
            const absent = await request(`/rest/v1/rpc/${name}`, {
              method: "POST",
              token: alice.token,
              body: {},
            });
            assert.equal(
              absent.status,
              404,
              `${name} must not be a public RPC route`,
            );
          }
          assert.deepEqual(
            assertOk(await pull(alice.token), "Alice after access denials"),
            beforeAlice,
          );
          assert.deepEqual(
            assertOk(await pull(bob.token), "Bob after access denials"),
            beforeBob,
          );
        },
      );

      await t.test(
        "malicious RPC arguments cannot alter feeds; SQL-shaped text and reused UUIDs remain account-scoped",
        async () => {
          const before = assertOk(
            await pull(alice.token),
            "malformed RPC start feed",
          );
          const invalidId = `${prefix}-malformed`;
          const base = {
            entity: "subject",
            recordId: invalidId,
            payload: subject(invalidId),
          };
          for (const input of [
            { ...base, operationId: "not-a-uuid" },
            { ...base, payload: { ...base.payload, owner_id: "not-a-uuid" } },
            {
              ...base,
              payload: { ...base.payload, created_at: "2026-02-30T00:00:00Z" },
            },
            { ...base, revision: "9999999999999999999" },
          ]) {
            assertInvalid(
              await apply(alice.token, input),
              "malformed RPC value",
            );
            assert.deepEqual(
              assertOk(await pull(alice.token), "feed after malformed RPC"),
              before,
            );
          }
          assertInvalid(
            await pull(alice.token, "9999999999999999999"),
            "overflowing cursor",
          );
          assert.deepEqual(
            assertOk(await pull(alice.token), "feed after overflowing cursor"),
            before,
          );
          const operationId = randomUUID();
          const id = `${prefix}-sql'); DROP TABLE public.stride_subjects; --`;
          const aliceInput = {
            operationId,
            entity: "subject",
            recordId: id,
            payload: {
              ...subject(id, "'; DELETE FROM auth.users; --"),
              description:
                "SELECT * FROM stride_private.stride_sync_operations;",
            },
          };
          const bobInput = {
            ...aliceInput,
            payload: subject(id, "Bob sentinel unchanged"),
          };
          for (const [user, input] of [
            [alice, aliceInput],
            [bob, bobInput],
          ]) {
            const first = assertOk(
              await apply(user.token, input),
              "SQL-shaped own subject",
            );
            assert.deepEqual(
              assertOk(
                await apply(user.token, input),
                "same-account receipt replay",
              ),
              first,
            );
            // Plain eq values are free-form, unlike in/and/or filter grammar.
            // Match the official SDK: URLSearchParams encodes the raw value;
            // adding double quotes would search for literal quotes in the ID.
            const query = `select=id,name,description&${new URLSearchParams({ id: `eq.${id}` })}`;
            assert.deepEqual(
              assertOk(
                await rows(user.token, "stride_subjects", query),
                "SQL-shaped own read",
              ),
              [
                {
                  id,
                  name: input.payload.name,
                  description: input.payload.description,
                },
              ],
            );
            const changes = assertOk(
              await pull(user.token),
              "SQL-shaped account feed",
            ).changes.filter((change) => change.record_id === id);
            assert.equal(changes.length, 1);
            assert.equal(changes[0].payload.name, input.payload.name);
          }
          assertInvalid(
            await apply(alice.token, {
              ...aliceInput,
              payload: {
                ...aliceInput.payload,
                name: "Changed under frozen UUID",
              },
            }),
            "altered same-account UUID reuse",
          );
          assert.deepEqual(
            assertOk(
              await rows(
                bob.token,
                "stride_subjects",
                `select=name&${new URLSearchParams({ id: `eq.${id}` })}`,
              ),
              "Bob sentinel after attack",
            ),
            [{ name: "Bob sentinel unchanged" }],
          );
          const sessionOperationId = randomUUID();
          const sessionId = `${prefix}-session'); SELECT pg_sleep(99); --`;
          for (const user of [alice, bob]) {
            const payload = sessionPayload(sessionId, id);
            payload.session.session_title =
              user === alice
                ? "'; DROP TABLE public.stride_sessions; --"
                : "Bob title sentinel";
            payload.session.notes =
              user === alice
                ? "UPDATE auth.users SET id = NULL; -- quotes ' remain text"
                : "Bob notes sentinel";
            assertOk(
              await apply(user.token, {
                operationId: sessionOperationId,
                entity: "session",
                recordId: sessionId,
                payload,
              }),
              "SQL-shaped own session",
            );
            assert.deepEqual(
              assertOk(
                await rows(
                  user.token,
                  "stride_sessions",
                  `select=session_title,notes&${new URLSearchParams({ id: `eq.${sessionId}` })}`,
                ),
                "SQL-shaped session read",
              ),
              [
                {
                  session_title: payload.session.session_title,
                  notes: payload.session.notes,
                },
              ],
            );
          }
        },
      );
      await t.test(
        "post-confirmation receipts are owner-scoped, concurrent/idempotent and read without changing study sync",
        async () => {
          const beforeAlice = assertOk(
            await pull(alice.token),
            "receipt Alice study feed",
          );
          const beforeBob = assertOk(
            await pull(bob.token),
            "receipt Bob study feed",
          );
          assert.equal(
            assertOk(
              await legal(alice.token, "get"),
              "Alice receipt before acknowledgment",
            ),
            null,
          );
          assert.equal(
            assertOk(
              await legal(bob.token, "get"),
              "Bob receipt before acknowledgment",
            ),
            null,
          );
          const before = Date.now();
          const concurrent = (
            await Promise.all([
              legal(alice.token, "record"),
              legal(alice.token, "record"),
            ])
          ).map((value) => assertOk(value, "concurrent receipt submission"));
          assert.deepEqual(concurrent[0], concurrent[1]);
          const first = concurrent[0];
          assert.deepEqual(Object.keys(first).sort(), [
            "accepted_at",
            "privacy_version",
            "terms_version",
          ]);
          assert.equal(first.terms_version, legalVersion);
          assert.equal(first.privacy_version, legalVersion);
          assert.ok(Number.isFinite(Date.parse(first.accepted_at)));
          assert.ok(
            Date.parse(first.accepted_at) >= before - 1000 &&
              Date.parse(first.accepted_at) <= Date.now() + 1000,
          );
          assert.deepEqual(
            assertOk(await legal(alice.token, "get"), "Alice receipt read"),
            first,
          );
          assert.equal(
            assertOk(
              await legal(bob.token, "get"),
              "Bob must not read Alice receipt",
            ),
            null,
          );
          const both = (
            await Promise.all([
              legal(alice.token, "record"),
              legal(bob.token, "record"),
            ])
          ).map((value) => assertOk(value, "independent account receipt"));
          assert.deepEqual(both[0], first);
          assert.deepEqual(
            assertOk(await legal(bob.token, "get"), "Bob current receipt"),
            both[1],
          );
          assert.deepEqual(
            assertOk(
              await legal(alice.token, "get"),
              "Alice unchanged receipt",
            ),
            first,
          );
          assert.deepEqual(
            assertOk(await pull(alice.token), "Alice sync after receipts"),
            beforeAlice,
          );
          assert.deepEqual(
            assertOk(await pull(bob.token), "Bob sync after receipts"),
            beforeBob,
          );
        },
      );

      await t.test(
        "receipt APIs deny anonymous/unconfirmed identities, version spoofing, forged fields and private table access",
        async () => {
          const email = `stride-consent-unconfirmed-${randomUUID()}@example.test`;
          const password = randomBytes(24).toString("base64url");
          const pending = assertOk(
            await request("/auth/v1/admin/users", {
              method: "POST",
              key: adminKey,
              body: { email, password, email_confirm: false },
            }),
            "create local unconfirmed consent user",
          );
          assert.match(pending.id, /^[0-9a-f-]{36}$/i);
          users.push({ id: pending.id });
          assert.equal(pending.email_confirmed_at ?? null, null);
          const unconfirmedSignIn = await request(
            "/auth/v1/token?grant_type=password",
            {
              method: "POST",
              body: { email, password },
            },
          );
          assertInvalid(unconfirmedSignIn, "unconfirmed password sign-in");
          assert.equal(
            unconfirmedSignIn.data?.error_code ?? unconfirmedSignIn.data?.code,
            "email_not_confirmed",
          );
          const token = unconfirmedFixtureToken(pending.id);
          // Prove this is a valid authenticated fixture, not a blanket bad-JWT
          // rejection: the unchanged sync RPC accepts its authenticated owner.
          assertOk(
            await pull(token),
            "locally signed unconfirmed JWT reaches authenticated RPC",
          );
          const first = assertOk(
            await legal(alice.token, "get"),
            "Alice receipt before denied requests",
          );
          for (const action of ["get", "record"]) {
            assertDenied(
              await legal(undefined, action),
              "anonymous receipt request",
            );
            const unconfirmed = await legal(token, action);
            assertDenied(unconfirmed, "trusted unconfirmed receipt request");
            assert.equal(unconfirmed.data?.code, "42501");
            for (const extra of [
              { p_terms_version: "2026-10-06" },
              { p_privacy_version: "2099-01-01" },
              { p_terms_version: null },
              { p_privacy_version: "" },
              { p_terms_version: "2026-10-07'); DROP TABLE auth.users; --" },
            ])
              assertInvalid(
                await legal(alice.token, action, extra),
                "unsupported legal version",
              );
            for (const extra of [
              { owner_id: bob.id },
              { p_owner_id: bob.id },
              { accepted_at: "2000-01-01T00:00:00Z" },
              { p_accepted_at: "2000-01-01T00:00:00Z" },
            ])
              assertInvalid(
                await legal(alice.token, action, extra),
                "forged receipt argument",
              );
          }
          for (const method of ["GET", "POST", "PATCH", "DELETE"]) {
            const hidden = await request(
              "/rest/v1/stride_legal_acceptances?select=*&limit=0",
              {
                method,
                token: alice.token,
                headers:
                  method === "GET"
                    ? { "Accept-Profile": "stride_private" }
                    : { "Content-Profile": "stride_private" },
                ...(method === "POST" || method === "PATCH"
                  ? { body: { owner_id: bob.id } }
                  : {}),
              },
            );
            assert.equal(
              hidden.data?.code,
              "PGRST106",
              "receipt relation must remain outside API exposure",
            );
          }
          for (const name of [
            "get_legal_acceptance_core",
            "record_legal_acceptance_core",
          ]) {
            assert.equal(
              (
                await request(`/rest/v1/rpc/${name}`, {
                  method: "POST",
                  token: alice.token,
                  body: {
                    p_terms_version: legalVersion,
                    p_privacy_version: legalVersion,
                  },
                })
              ).status,
              404,
              "private receipt core must not be public RPC",
            );
          }
          assert.deepEqual(
            assertOk(
              await legal(alice.token, "get"),
              "Alice receipt after denied requests",
            ),
            first,
          );
          assertOk(
            await pull(bob.token),
            "Bob study API remains available after SQL-shaped version",
          );
        },
      );
    } finally {
      const cleanup = await Promise.allSettled(users.map(deleteUser));
      for (const result of cleanup)
        if (result.status === "rejected") throw result.reason;
    }
  },
);
