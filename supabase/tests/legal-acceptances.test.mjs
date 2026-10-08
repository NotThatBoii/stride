// Exact implementation migration in disposable PGlite. Auth stand-ins here
// are separate from real JWT/PostgREST tests in local-integration.mjs.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const syncSql = await readFile(
  new URL("../migrations/20260929000000_stride_sync.sql", import.meta.url),
  "utf8",
);
const consentSql = await readFile(
  new URL(
    "../migrations/20261007000000_stride_legal_acceptances.sql",
    import.meta.url,
  ),
  "utf8",
);
const version = "2026-10-07";
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const unconfirmed = "33333333-3333-4333-8333-333333333333";

async function syncCatalog(db) {
  return (
    await db.query(`
    SELECT n.nspname AS schema, p.proname AS name, p.prosecdef,
      p.proconfig, p.proacl::text AS grants
    FROM pg_catalog.pg_proc AS p
    JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
    WHERE n.nspname IN ('public', 'stride_private')
      AND p.proname NOT LIKE '%legal_acceptance%'
    ORDER BY n.nspname, p.proname
  `)
  ).rows;
}
async function database(run) {
  const db = await PGlite.create();
  try {
    await db.exec(`
      CREATE ROLE anon NOLOGIN;
      CREATE ROLE authenticated NOLOGIN;
      CREATE SCHEMA auth;
      CREATE TABLE auth.users (id uuid PRIMARY KEY, email_confirmed_at timestamptz);
      CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $$
        SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
      $$;
      GRANT USAGE ON SCHEMA auth TO anon, authenticated;
      GRANT EXECUTE ON FUNCTION auth.uid() TO anon, authenticated;
    `);
    await db.query(
      "INSERT INTO auth.users VALUES ($1, now()), ($2, now()), ($3, NULL)",
      [alice, bob, unconfirmed],
    );
    await db.exec(syncSql);
    const before = await syncCatalog(db);
    await db.exec(consentSql);
    await run(db, before);
  } finally {
    await db.close();
  }
}
async function role(db, user, run, selectedRole = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${selectedRole}`); // Fixed harness inventory.
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      user ?? "",
    ]);
    return run(tx);
  });
}
async function receipt(
  db,
  user,
  action = "get",
  terms = version,
  privacy = version,
) {
  // Function names come only from this fixed get/record test inventory.
  assert.ok(["get", "record"].includes(action));
  const result = await role(db, user, (tx) =>
    tx.query(`SELECT public.${action}_legal_acceptance($1, $2) AS receipt`, [
      terms,
      privacy,
    ]),
  );
  return result.rows[0].receipt;
}
async function receiptRows(db) {
  return (
    await db.query(
      "SELECT * FROM stride_private.stride_legal_acceptances ORDER BY owner_id",
    )
  ).rows;
}

test("confirmed owners read without writing, retain the first server timestamp and have separate current receipts", async () => {
  await database(async (db) => {
    assert.equal(await receipt(db, alice), null);
    assert.equal(await receipt(db, bob), null);
    assert.deepEqual(await receiptRows(db), []);
    const before = (await db.query("SELECT clock_timestamp() AS at")).rows[0]
      .at;
    const first = await receipt(db, alice, "record");
    const after = (await db.query("SELECT clock_timestamp() AS at")).rows[0].at;
    assert.ok(Date.parse(first.accepted_at) >= new Date(before).getTime());
    assert.ok(Date.parse(first.accepted_at) <= new Date(after).getTime());
    assert.deepEqual(first, {
      terms_version: version,
      privacy_version: version,
      accepted_at: first.accepted_at,
    });
    assert.deepEqual(await receipt(db, alice), first);
    assert.deepEqual(await receipt(db, alice, "record"), first);
    assert.equal(await receipt(db, bob), null);
    assert.equal((await receiptRows(db)).length, 1);
    const second = await receipt(db, bob, "record");
    assert.deepEqual(await receipt(db, bob), second);
    assert.deepEqual(await receipt(db, alice), first);
    assert.deepEqual(
      (await receiptRows(db)).map((row) => row.owner_id),
      [alice, bob],
    );
  });
});

test("both receipt paths reject anonymous, unconfirmed, missing owners, stale versions and forged arguments", async () => {
  await database(async (db) => {
    for (const action of ["get", "record"]) {
      await assert.rejects(
        () =>
          role(
            db,
            null,
            (tx) =>
              tx.query(`SELECT public.${action}_legal_acceptance($1, $2)`, [
                version,
                version,
              ]),
            "anon",
          ),
        (error) => error.code === "42501",
      );
      for (const owner of [
        null,
        unconfirmed,
        "44444444-4444-4444-8444-444444444444",
      ]) {
        await assert.rejects(
          () => receipt(db, owner, action),
          (error) => error.code === "42501",
        );
      }
      for (const [terms, privacy] of [
        [null, version],
        [version, null],
        ["", version],
        ["2026-10-06", "2026-10-06"],
        [version, "2099-01-01"],
        ["2026-10-07'); DROP TABLE auth.users; --", version],
      ]) {
        await assert.rejects(
          () => receipt(db, alice, action, terms, privacy),
          (error) => error.code === "22023",
        );
      }
      await assert.rejects(
        () =>
          role(db, alice, (tx) =>
            tx.query(
              `SELECT public.${action}_legal_acceptance($1, $2, $3::uuid, $4::timestamptz)`,
              [version, version, bob, "2000-01-01T00:00:00Z"],
            ),
          ),
        (error) => error.code === "42883",
      );
    }
    assert.deepEqual(await receiptRows(db), []);
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n,
      3,
    );
  });
});

test("client receipts are append-only, private table access is denied and disabling writes preserves reads and evidence", async () => {
  await database(async (db) => {
    const first = await receipt(db, alice, "record");
    await receipt(db, bob, "record");
    const protections = (
      await db.query(`
      SELECT c.relrowsecurity FROM pg_catalog.pg_class AS c
      JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
      WHERE n.nspname = 'stride_private' AND c.relname = 'stride_legal_acceptances'
    `)
    ).rows[0];
    assert.equal(protections.relrowsecurity, true);
    for (const selectedRole of ["anon", "authenticated"]) {
      assert.equal(
        (
          await db.query(
            "SELECT has_table_privilege($1, 'stride_private.stride_legal_acceptances', 'SELECT,INSERT,UPDATE,DELETE') AS allowed",
            [selectedRole],
          )
        ).rows[0].allowed,
        false,
      );
    }
    for (const statement of [
      "SELECT * FROM stride_private.stride_legal_acceptances",
      "INSERT INTO stride_private.stride_legal_acceptances DEFAULT VALUES",
      "UPDATE stride_private.stride_legal_acceptances SET accepted_at = '2000-01-01'",
      "DELETE FROM stride_private.stride_legal_acceptances",
    ]) {
      await assert.rejects(
        () => role(db, alice, (tx) => tx.query(statement)),
        (error) => error.code === "42501",
      );
    }
    const functions = (
      await db.query(`
      SELECT n.nspname AS schema, p.proname AS name, p.prosecdef, p.proconfig,
        has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_allowed,
        has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_allowed
      FROM pg_catalog.pg_proc AS p JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE p.proname LIKE '%legal_acceptance%' ORDER BY n.nspname, p.proname
    `)
    ).rows;
    assert.equal(functions.length, 4);
    assert.ok(
      functions.every((fn) => !fn.anon_allowed && fn.authenticated_allowed),
    );
    assert.ok(
      functions.every(
        (fn) => fn.prosecdef === (fn.schema === "stride_private"),
      ),
    );
    for (const fn of functions)
      assert.deepEqual(fn.proconfig, ['search_path=""']);
    // Hypothetical SELECT grant stays owner-scoped; this is test-only, not deployment SQL.
    await db.exec(
      "GRANT SELECT ON stride_private.stride_legal_acceptances TO authenticated",
    );
    const visible = (
      await role(db, alice, (tx) =>
        tx.query(
          "SELECT owner_id FROM stride_private.stride_legal_acceptances",
        ),
      )
    ).rows;
    assert.deepEqual(visible, [{ owner_id: alice }]);
    await db.exec(
      "REVOKE SELECT ON stride_private.stride_legal_acceptances FROM authenticated",
    );
    assert.deepEqual(await receipt(db, alice), first);
    const evidence = await receiptRows(db);
    await db.exec(
      "REVOKE EXECUTE ON FUNCTION public.record_legal_acceptance(text, text), stride_private.record_legal_acceptance_core(text, text) FROM authenticated",
    );
    await assert.rejects(
      () => receipt(db, alice, "record"),
      (error) => error.code === "42501",
    );
    assert.deepEqual(await receipt(db, alice), first);
    assert.deepEqual(await receiptRows(db), evidence);
    await db.query("DELETE FROM auth.users WHERE id = $1", [alice]);
    assert.deepEqual(
      (await receiptRows(db)).map((row) => row.owner_id),
      [bob],
    );
  });
});

test("the migration retains existing sync grants and receipts never mutate study records or sync clocks/feed", async () => {
  await database(async (db, before) => {
    assert.deepEqual(await syncCatalog(db), before);
    const id = "study-before-consent";
    const payload = {
      id,
      name: "Preserved study",
      description: "",
      icon: "book",
      color: "#8b91e8",
      created_at: "2026-10-07T00:00:00Z",
      archived: 0,
    };
    await role(db, alice, (tx) =>
      tx.query(
        "SELECT public.apply_sync_operation($1::uuid, 'subject', $2, 'upsert', $3::jsonb, null::text)",
        [crypto.randomUUID(), id, JSON.stringify(payload)],
      ),
    );
    const pull = async () =>
      (
        await role(db, alice, (tx) =>
          tx.query("SELECT public.get_sync_changes('0', 100) AS result"),
        )
      ).rows[0].result;
    const snapshot = await pull();
    assert.equal(await receipt(db, alice), null);
    await receipt(db, alice, "record");
    await receipt(db, alice);
    await receipt(db, alice, "record");
    assert.deepEqual(await pull(), snapshot);
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM stride_private.stride_sync_operations",
        )
      ).rows[0].n,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT sequence FROM stride_private.stride_sync_clocks WHERE owner_id = $1",
          [alice],
        )
      ).rows[0].sequence,
      1,
    );
    assert.equal(
      (
        await db.query(
          "SELECT name FROM public.stride_subjects WHERE owner_id = $1 AND id = $2",
          [alice, id],
        )
      ).rows[0].name,
      payload.name,
    );
  });
});
