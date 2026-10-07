import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { PGlite } from "@electric-sql/pglite";

const migration = await readFile(
  fileURLToPath(
    new URL("../migrations/20260929000000_stride_sync.sql", import.meta.url),
  ),
  "utf8",
);
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";

async function withDatabase(run) {
  const db = await PGlite.create();
  try {
    // Only the isolated test database gets these Supabase Auth stand-ins.
    await db.exec(`
      create role anon nologin;
      create role authenticated nologin;
      create schema auth;
      create table auth.users (id uuid primary key);
      create function auth.uid() returns uuid language sql stable as $$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $$;
      grant usage on schema auth to anon, authenticated;
      grant execute on function auth.uid() to anon, authenticated;
      insert into auth.users(id) values ('${alice}'), ('${bob}');
    `);
    await db.exec(migration);
    await run(db);
  } finally {
    await db.close();
  }
}

async function asRole(db, role, userId, run) {
  return db.transaction(async (tx) => {
    await tx.exec(`set local role ${role}`);
    await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
      userId ?? "",
    ]);
    return run(tx);
  });
}

async function apply(
  db,
  userId,
  {
    operationId = crypto.randomUUID(),
    entity,
    recordId,
    action = "upsert",
    payload = null,
    revision = null,
  },
) {
  return asRole(db, "authenticated", userId, async (tx) => {
    const result = await tx.query(
      `select public.apply_sync_operation(
        $1::uuid, $2::text, $3::text, $4::text, $5::jsonb, $6::text
      ) as result`,
      [
        operationId,
        entity,
        recordId,
        action,
        payload === null ? null : JSON.stringify(payload),
        revision,
      ],
    );
    return result.rows[0].result;
  });
}

async function pull(db, userId, cursor = "0", limit = 100) {
  return asRole(db, "authenticated", userId, async (tx) => {
    const result = await tx.query(
      "select public.get_sync_changes($1::text, $2::integer) as result",
      [cursor, limit],
    );
    return result.rows[0].result;
  });
}

function subject(name = "Mathematics", id = "math") {
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

function studySession(id = "session-one", subjectId = "math") {
  return {
    id,
    subject_id: subjectId,
    started_at: "2026-09-21T23:50:00.000Z",
    ended_at: "2026-09-22T00:10:00.000Z",
    duration_seconds: 1200,
    session_title: "Practice",
    notes: "Keep going",
    mode: "stopwatch",
    completed: 1,
  };
}

function sessionPayload(id = "session-one", subjectId = "math") {
  return {
    session: studySession(id, subjectId),
    slices: [
      { session_id: id, day: "2026-09-21", seconds: 600 },
      { session_id: id, day: "2026-09-22", seconds: 600 },
    ],
  };
}

test("migration creates the owner-scoped tables with RLS and no direct writes", async () => {
  await withDatabase(async (db) => {
    const result = await db.query(`
      select n.nspname, c.relname, c.relrowsecurity
      from pg_catalog.pg_class c
      join pg_catalog.pg_namespace n on n.oid = c.relnamespace
      where c.relkind = 'r' and
        ((n.nspname = 'public' and c.relname like 'stride_%') or
         (n.nspname = 'stride_private' and c.relname like 'stride_%'))
      order by n.nspname, c.relname
    `);
    assert.equal(result.rows.length, 8);
    assert.ok(result.rows.every((row) => row.relrowsecurity));
    for (const table of result.rows) {
      const name = `${table.nspname}.${table.relname}`;
      const access = await db.query(
        `
        select
          has_table_privilege('authenticated', $1, 'INSERT, UPDATE, DELETE') as can_write,
          has_table_privilege('anon', $1, 'SELECT, INSERT, UPDATE, DELETE') as anon_access
      `,
        [name],
      );
      assert.equal(access.rows[0].can_write, false, name);
      assert.equal(access.rows[0].anon_access, false, name);
    }
  });
});

test("anonymous callers cannot read study records or execute the sync RPC", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    await assert.rejects(() =>
      asRole(db, "anon", null, (tx) =>
        tx.query("select * from public.stride_subjects"),
      ),
    );
    await assert.rejects(() =>
      asRole(db, "anon", null, (tx) =>
        tx.query("select public.get_sync_changes('0'::text, 10::integer)"),
      ),
    );
    await assert.rejects(() =>
      asRole(db, "authenticated", alice, (tx) =>
        tx.query("select * from stride_private.stride_sync_changes"),
      ),
    );
    assert.equal(
      (
        await asRole(db, "authenticated", null, (tx) =>
          tx.query("select count(*)::integer as n from public.stride_subjects"),
        )
      ).rows[0].n,
      0,
    );
    await assert.rejects(() =>
      asRole(db, "authenticated", null, (tx) =>
        tx.query(
          "select public.apply_sync_operation($1::uuid, 'subject', 'math', 'delete', null::jsonb, null::text)",
          [crypto.randomUUID()],
        ),
      ),
    );
  });
});

test("creates a subject with a revision and idempotent operation receipt", async () => {
  await withDatabase(async (db) => {
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      entity: "subject",
      recordId: "math",
      payload: subject(),
    };
    const first = await apply(db, alice, input);
    assert.equal(first.status, "applied");
    assert.equal(first.revision, "1");
    assert.deepEqual(await apply(db, alice, input), first);
    assert.equal((await pull(db, alice)).changes.length, 1);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from stride_private.stride_sync_operations",
        )
      ).rows[0].n,
      1,
    );
    await assert.rejects(() =>
      apply(db, alice, { ...input, payload: subject("Changed request") }),
    );
  });
});

test("RLS confines reads and account-owned identifiers to their caller", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject("Alice's subject"),
    });
    await apply(db, bob, {
      entity: "subject",
      recordId: "math",
      payload: subject("Bob's subject"),
    });
    const read = (userId) =>
      asRole(db, "authenticated", userId, (tx) =>
        tx.query("select name from public.stride_subjects"),
      );
    assert.deepEqual(
      (await read(alice)).rows.map((r) => r.name),
      ["Alice's subject"],
    );
    assert.deepEqual(
      (await read(bob)).rows.map((r) => r.name),
      ["Bob's subject"],
    );
    assert.equal((await pull(db, alice)).changes.length, 1);
    assert.equal((await pull(db, bob)).changes.length, 1);
    await assert.rejects(() =>
      asRole(db, "authenticated", bob, (tx) =>
        tx.query(
          "update public.stride_subjects set name = 'forged' where id = 'math'",
        ),
      ),
    );
    await assert.rejects(() =>
      apply(db, alice, {
        entity: "subject",
        recordId: "forged",
        payload: { ...subject("Forged", "forged"), owner_id: bob },
      }),
    );
  });
});

test("a session and its recorded local-day allocations commit as one change", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const result = await apply(db, alice, {
      entity: "session",
      recordId: "session-one",
      payload: sessionPayload(),
    });
    assert.equal(result.status, "applied");
    const rows = await db.query(
      "select day::text as day, seconds from public.stride_allocations order by day",
    );
    assert.deepEqual(
      rows.rows.map((r) => r.day),
      ["2026-09-21", "2026-09-22"],
    );
    assert.equal(
      rows.rows.reduce((sum, row) => sum + Number(row.seconds), 0),
      1200,
    );
    const changes = (await pull(db, alice)).changes;
    assert.equal(changes.length, 2);
    assert.equal(changes[1].entity, "session");
    assert.equal(changes[1].payload.slices.length, 2);
  });
});

test("session updates replace allocations atomically and respect account RLS", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const created = await apply(db, alice, {
      entity: "session",
      recordId: "session-one",
      payload: sessionPayload(),
    });
    const updated = sessionPayload();
    updated.slices = [
      { session_id: "session-one", day: "2026-09-21", seconds: 1200 },
    ];
    assert.equal(
      (
        await apply(db, alice, {
          entity: "session",
          recordId: "session-one",
          payload: updated,
          revision: created.revision,
        })
      ).status,
      "applied",
    );
    const aliceDays = await asRole(db, "authenticated", alice, (tx) =>
      tx.query("select day::text as day from public.stride_allocations"),
    );
    assert.deepEqual(
      aliceDays.rows.map((row) => row.day),
      ["2026-09-21"],
    );
    const bobSessions = await asRole(db, "authenticated", bob, (tx) =>
      tx.query("select count(*)::integer as n from public.stride_sessions"),
    );
    const bobDays = await asRole(db, "authenticated", bob, (tx) =>
      tx.query("select count(*)::integer as n from public.stride_allocations"),
    );
    assert.equal(bobSessions.rows[0].n, 0);
    assert.equal(bobDays.rows[0].n, 0);
  });
});

test("cross-owner and out-of-order session references fail without partial writes", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const operationId = crypto.randomUUID();
    const input = {
      operationId,
      entity: "session",
      recordId: "session-one",
      payload: sessionPayload(),
    };
    await assert.rejects(() => apply(db, bob, input));
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      0,
    );
    await apply(db, bob, {
      entity: "subject",
      recordId: "math",
      payload: subject("Bob's subject"),
    });
    assert.equal((await apply(db, bob, input)).status, "applied");
  });
});

test("invalid daily totals and duplicate days roll back record, clock, and receipt", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const operationId = crypto.randomUUID();
    const invalid = sessionPayload();
    invalid.slices[1].seconds = 599;
    await assert.rejects(() =>
      apply(db, alice, {
        operationId,
        entity: "session",
        recordId: "session-one",
        payload: invalid,
      }),
    );
    const duplicates = sessionPayload();
    duplicates.slices[1].day = duplicates.slices[0].day;
    await assert.rejects(() =>
      apply(db, alice, {
        entity: "session",
        recordId: "session-one",
        payload: duplicates,
      }),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (
        await db.query(
          "select sequence from stride_private.stride_sync_clocks where owner_id = $1",
          [alice],
        )
      ).rows[0].sequence,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from stride_private.stride_sync_operations",
        )
      ).rows[0].n,
      1,
    );
  });
});

test("stale simulated device update yields a conflict and preserves the winner", async () => {
  await withDatabase(async (db) => {
    const first = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const winner = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject("Device A"),
      revision: first.revision,
    });
    assert.equal(winner.status, "applied");
    const loser = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject("Device B"),
      revision: first.revision,
    });
    assert.equal(loser.status, "conflict");
    assert.equal(loser.current_revision, winner.revision);
    assert.equal(
      (
        await db.query(
          "select name from public.stride_subjects where owner_id = $1 and id = 'math'",
          [alice],
        )
      ).rows[0].name,
      "Device A",
    );
    assert.equal((await pull(db, alice)).changes.length, 2);
  });
});

test("subject deletion emits child and parent tombstones and blocks stale resurrection", async () => {
  await withDatabase(async (db) => {
    const created = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    await apply(db, alice, {
      entity: "session",
      recordId: "session-one",
      payload: sessionPayload(),
    });
    const deleted = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      action: "delete",
      revision: created.revision,
    });
    assert.equal(deleted.status, "applied");
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      0,
    );
    const changes = (await pull(db, alice)).changes;
    assert.deepEqual(
      changes.slice(-2).map((row) => [row.entity, row.action]),
      [
        ["session", "delete"],
        ["subject", "delete"],
      ],
    );
    const stale = await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject("Stale device"),
      revision: null,
    });
    assert.equal(stale.status, "conflict");
    assert.equal(stale.deleted, true);
  });
});

test("pull is owner-scoped, ordered, paginated, and retains tombstones", async () => {
  await withDatabase(async (db) => {
    for (let n = 0; n < 4; n++)
      await apply(db, alice, {
        entity: "subject",
        recordId: `subject-${n}`,
        payload: subject(`Subject ${n}`, `subject-${n}`),
      });
    await apply(db, bob, {
      entity: "subject",
      recordId: "private",
      payload: subject("Bob", "private"),
    });
    const first = await pull(db, alice, "0", 2);
    assert.deepEqual(
      first.changes.map((x) => x.sequence),
      ["1", "2"],
    );
    assert.equal(first.cursor, "2");
    assert.equal(first.has_more, true);
    const second = await pull(db, alice, first.cursor, 2);
    assert.deepEqual(
      second.changes.map((x) => x.sequence),
      ["3", "4"],
    );
    assert.equal(second.has_more, false);
    assert.equal((await pull(db, bob)).changes.length, 1);
    await assert.rejects(() => pull(db, alice, "-1", 2));
    await assert.rejects(() => pull(db, alice, "5", 2));
    await assert.rejects(() => pull(db, alice, "0", 10000));
  });
});

test("timestamps without an explicit offset are rejected before storage", async () => {
  await withDatabase(async (db) => {
    await assert.rejects(() =>
      apply(db, alice, {
        entity: "subject",
        recordId: "math",
        payload: { ...subject(), created_at: "2026-09-21T10:00:00" },
      }),
    );
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const input = sessionPayload();
    input.session.started_at = "2026-09-21T23:50:00";
    await assert.rejects(() =>
      apply(db, alice, {
        entity: "session",
        recordId: "session-one",
        payload: input,
      }),
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      0,
    );
  });
});

test("cloud preferences exclude device-only theme, notifications, and onboarding", async () => {
  await withDatabase(async (db) => {
    const result = await apply(db, alice, {
      entity: "settings",
      recordId: "settings",
      payload: { minimum: 20, goal: 60, presets: "25,45,60", weekStart: 1 },
    });
    assert.equal(result.status, "applied");
    const row = (
      await db.query(
        "select * from public.stride_preferences where owner_id = $1",
        [alice],
      )
    ).rows[0];
    assert.equal(row.minimum, 20);
    assert.equal(row.week_start, 1);
    assert.ok(!("theme" in row));
    assert.ok(!("notifications" in row));
    assert.ok(!("onboarded" in row));
  });
});

test("every exposed study table denies bypass writes and foreign-owner reads, and private helpers stay denied", async () => {
  await withDatabase(async (db) => {
    for (const owner of [alice, bob]) {
      await apply(db, owner, {
        entity: "subject",
        recordId: "shared-subject",
        payload: subject(owner === alice ? "Alice" : "Bob", "shared-subject"),
      });
      await apply(db, owner, {
        entity: "session",
        recordId: "shared-session",
        payload: sessionPayload("shared-session", "shared-subject"),
      });
      await apply(db, owner, {
        entity: "settings",
        recordId: "settings",
        payload: { minimum: 20, goal: 60, presets: "25,45,60", weekStart: 1 },
      });
    }
    const before = await pull(db, alice);
    // Identifiers come only from this fixed test inventory, never user data.
    for (const table of [
      "stride_subjects",
      "stride_sessions",
      "stride_allocations",
      "stride_preferences",
    ]) {
      const ownRows = await asRole(db, "authenticated", alice, (tx) =>
        tx.query(`select owner_id from public.${table}`),
      );
      assert.ok(ownRows.rows.length > 0);
      assert.ok(
        ownRows.rows.every((row) => row.owner_id === alice),
        table,
      );
      const foreign = await asRole(db, "authenticated", alice, (tx) =>
        tx.query(`select owner_id from public.${table} where owner_id = $1`, [
          bob,
        ]),
      );
      assert.equal(foreign.rows.length, 0, table);
      for (const role of ["anon", "authenticated"]) {
        const statements = [
          `insert into public.${table} default values`,
          `update public.${table} set owner_id = $1 where owner_id = $1`,
          `delete from public.${table} where owner_id = $1`,
          ...(role === "anon"
            ? [`select * from public.${table} where owner_id = $1`]
            : []),
        ];
        for (const statement of statements) {
          await assert.rejects(
            () =>
              asRole(db, role, role === "anon" ? null : alice, (tx) =>
                tx.query(statement, statement.includes("$1") ? [alice] : []),
              ),
            (error) => error.code === "42501",
            `${role}: ${table} must deny direct access`,
          );
        }
      }
    }
    for (const table of [
      "stride_record_versions",
      "stride_sync_clocks",
      "stride_sync_changes",
      "stride_sync_operations",
    ]) {
      await assert.rejects(
        () =>
          asRole(db, "authenticated", alice, (tx) =>
            tx.query(`select * from stride_private.${table}`),
          ),
        (error) => error.code === "42501",
      );
    }
    for (const [signature, invocation] of [
      [
        "stride_private.assert_allocation_total(uuid,text)",
        "stride_private.assert_allocation_total($1::uuid, 'shared-session')",
      ],
      [
        "stride_private.check_allocation_total()",
        "stride_private.check_allocation_total()",
      ],
      [
        "stride_private.append_change(uuid,text,text,text,jsonb,bigint,uuid)",
        "stride_private.append_change($1::uuid, 'subject', 'shared-subject', 'delete', null::jsonb, 1::bigint, $2::uuid)",
      ],
    ]) {
      assert.equal(
        (
          await db.query(
            "select has_function_privilege('authenticated', $1, 'EXECUTE') as allowed",
            [signature],
          )
        ).rows[0].allowed,
        false,
        signature,
      );
      await assert.rejects(
        () =>
          asRole(db, "authenticated", alice, (tx) =>
            tx.query(
              `select ${invocation}`,
              invocation.includes("$2")
                ? [alice, crypto.randomUUID()]
                : invocation.includes("$1")
                  ? [alice]
                  : [],
            ),
          ),
        (error) => error.code === "42501",
      );
    }
    // These two private cores intentionally support the public invoker wrappers.
    // Their SQL grant must not be confused with exposing stride_private over HTTP.
    assert.equal(
      (
        await db.query(
          "select has_function_privilege('authenticated', 'stride_private.get_sync_changes_core(text,integer)', 'EXECUTE') as allowed",
        )
      ).rows[0].allowed,
      true,
    );
    await assert.rejects(
      () =>
        asRole(db, "authenticated", null, (tx) =>
          tx.query("select stride_private.get_sync_changes_core('0', 100)"),
        ),
      (error) => error.code === "42501",
    );
    assert.deepEqual(await pull(db, alice), before);
  });
});

test("malformed owner, UUID, timestamps, revisions and allocations leave cloud records, clocks and receipts unchanged", async () => {
  await withDatabase(async (db) => {
    await apply(db, alice, {
      entity: "subject",
      recordId: "math",
      payload: subject(),
    });
    const before = await pull(db, alice);
    const receiptCount = async () =>
      (
        await db.query(
          "select count(*)::integer as n from stride_private.stride_sync_operations where owner_id = $1",
          [alice],
        )
      ).rows[0].n;
    const beforeReceipts = await receiptCount();
    const invalidSubject = {
      entity: "subject",
      recordId: "invalid",
      payload: subject("Invalid", "invalid"),
    };
    const tooMany = sessionPayload("invalid-session");
    tooMany.slices = Array.from({ length: 1001 }, () => ({
      session_id: "invalid-session",
      day: "2026-09-21",
      seconds: 0,
    }));
    const invalidDay = sessionPayload("invalid-session");
    invalidDay.slices[0].day = "2026-02-30";
    for (const input of [
      {
        ...invalidSubject,
        payload: { ...invalidSubject.payload, owner_id: "not-a-uuid" },
      },
      { ...invalidSubject, operationId: "not-a-uuid" },
      {
        ...invalidSubject,
        payload: {
          ...invalidSubject.payload,
          created_at: "2026-02-30T00:00:00Z",
        },
      },
      { ...invalidSubject, revision: "9999999999999999999" },
      { entity: "session", recordId: "invalid-session", payload: invalidDay },
      { entity: "session", recordId: "invalid-session", payload: tooMany },
    ]) {
      await assert.rejects(() => apply(db, alice, input));
      assert.deepEqual(await pull(db, alice), before);
      assert.equal(await receiptCount(), beforeReceipts);
    }
    await assert.rejects(() => pull(db, alice, "9999999999999999999"));
    assert.deepEqual(await pull(db, alice), before);
    assert.equal(await receiptCount(), beforeReceipts);
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_subjects",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      0,
    );
  });
});

test("SQL-shaped text remains data and identical operation UUIDs have independent owner-scoped receipts", async () => {
  await withDatabase(async (db) => {
    const operationId = crypto.randomUUID();
    const id = "sql-shaped'); DROP TABLE public.stride_subjects; --";
    const aliceInput = {
      operationId,
      entity: "subject",
      recordId: id,
      payload: {
        ...subject("'; DELETE FROM auth.users; --", id),
        description:
          "SELECT secret FROM stride_private.stride_sync_operations;",
      },
    };
    const bobInput = {
      ...aliceInput,
      payload: subject("Bob sentinel unchanged", id),
    };
    const a = await apply(db, alice, aliceInput);
    const b = await apply(db, bob, bobInput);
    assert.deepEqual(await apply(db, alice, aliceInput), a);
    assert.deepEqual(await apply(db, bob, bobInput), b);
    for (const [owner, input] of [
      [alice, aliceInput],
      [bob, bobInput],
    ]) {
      const row = (
        await asRole(db, "authenticated", owner, (tx) =>
          tx.query(
            "select id, name, description from public.stride_subjects where id = $1",
            [id],
          ),
        )
      ).rows[0];
      assert.deepEqual(row, {
        id,
        name: input.payload.name,
        description: input.payload.description,
      });
      assert.equal((await pull(db, owner)).changes.length, 1);
      assert.equal(
        (await pull(db, owner)).changes[0].payload.name,
        input.payload.name,
      );
    }
    const sessionOperationId = crypto.randomUUID();
    const sessionId = "session'); SELECT pg_sleep(99); --";
    for (const owner of [alice, bob]) {
      const payload = sessionPayload(sessionId, id);
      payload.session.session_title =
        owner === alice
          ? "'; DROP TABLE public.stride_sessions; --"
          : "Bob title sentinel";
      payload.session.notes =
        owner === alice
          ? "UPDATE auth.users SET id = NULL; -- quotes ' remain text"
          : "Bob notes sentinel";
      await apply(db, owner, {
        operationId: sessionOperationId,
        entity: "session",
        recordId: sessionId,
        payload,
      });
      const row = (
        await asRole(db, "authenticated", owner, (tx) =>
          tx.query(
            "select session_title, notes from public.stride_sessions where id = $1",
            [sessionId],
          ),
        )
      ).rows[0];
      assert.deepEqual(row, {
        session_title: payload.session.session_title,
        notes: payload.session.notes,
      });
    }
    await assert.rejects(
      () =>
        apply(db, alice, {
          ...aliceInput,
          payload: {
            ...aliceInput.payload,
            name: "Changed request under frozen UUID",
          },
        }),
      (error) => error.code === "23505",
    );
    const receipts = (
      await db.query(
        "select owner_id, operation_id from stride_private.stride_sync_operations where operation_id = $1 order by owner_id",
        [operationId],
      )
    ).rows;
    assert.deepEqual(
      receipts.map((receipt) => receipt.owner_id),
      [alice, bob],
    );
    assert.ok(
      receipts.every((receipt) => receipt.operation_id === operationId),
    );
    assert.equal(
      (await db.query("select count(*)::integer as n from auth.users")).rows[0]
        .n,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_subjects",
        )
      ).rows[0].n,
      2,
    );
    assert.equal(
      (
        await db.query(
          "select count(*)::integer as n from public.stride_sessions",
        )
      ).rows[0].n,
      2,
    );
  });
});
