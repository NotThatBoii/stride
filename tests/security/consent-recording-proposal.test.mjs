// Isolated review prototype only. No URL, hosted key, Auth client, or network.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";

const proposed = await readFile(
  new URL("../../docs/proposals/consent-recording.sql", import.meta.url),
  "utf8",
);
const alice = "11111111-1111-4111-8111-111111111111";
const bob = "22222222-2222-4222-8222-222222222222";
const unconfirmed = "33333333-3333-4333-8333-333333333333";

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
      CREATE SCHEMA stride_private;
      GRANT USAGE ON SCHEMA stride_private TO authenticated;
    `);
    await db.query(
      "INSERT INTO auth.users VALUES ($1, now()), ($2, now()), ($3, NULL)",
      [alice, bob, unconfirmed],
    );
    await db.exec(proposed);
    await run(db);
  } finally {
    await db.close();
  }
}
async function role(db, user, run, selectedRole = "authenticated") {
  return db.transaction(async (tx) => {
    await tx.exec(`SET LOCAL ROLE ${selectedRole}`); // Fixed harness role, not a client input.
    await tx.query("SELECT set_config('request.jwt.claim.sub', $1, true)", [
      user ?? "",
    ]);
    return run(tx);
  });
}
async function record(db, user, terms = "2026-10-06", privacy = "2026-10-06") {
  const value = await role(db, user, (tx) =>
    tx.query("SELECT public.record_legal_acceptance($1, $2) AS receipt", [
      terms,
      privacy,
    ]),
  );
  return value.rows[0].receipt;
}

test("proposal records independent owner receipts at server time and preserves the first receipt on replay", async () => {
  await database(async (db) => {
    const before = (await db.query("SELECT clock_timestamp() AS at")).rows[0]
      .at;
    const first = await record(db, alice);
    const after = (await db.query("SELECT clock_timestamp() AS at")).rows[0].at;
    assert.ok(Date.parse(first.accepted_at) >= new Date(before).getTime());
    assert.ok(Date.parse(first.accepted_at) <= new Date(after).getTime());
    assert.deepEqual(await record(db, alice), first);
    await record(db, bob);
    const rows = (
      await db.query(
        "SELECT * FROM stride_private.stride_legal_acceptances ORDER BY owner_id",
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.owner_id),
      [alice, bob],
    );
    assert.equal(rows.length, 2);
    assert.deepEqual(Object.keys(first).sort(), [
      "accepted_at",
      "privacy_version",
      "terms_version",
    ]);
  });
});

test("proposal rejects anonymous, missing and unconfirmed owners, malformed versions and owner/timestamp arguments", async () => {
  await database(async (db) => {
    await assert.rejects(() =>
      role(
        db,
        null,
        (tx) =>
          tx.query(
            "SELECT public.record_legal_acceptance('2026-10-06', '2026-10-06')",
          ),
        "anon",
      ),
    );
    await assert.rejects(() => record(db, null));
    await assert.rejects(() => record(db, unconfirmed));
    for (const [terms, privacy] of [
      [null, "2026-10-06"],
      ["", "2026-10-06"],
      ["2026-10-06", "2099-01-01"],
      ["2026-10-06'); DROP TABLE auth.users; --", "2026-10-06"],
    ]) {
      await assert.rejects(() => record(db, alice, terms, privacy));
    }
    await assert.rejects(() =>
      role(db, alice, (tx) =>
        tx.query(
          "SELECT public.record_legal_acceptance($1, $2, $3::uuid, $4::timestamptz)",
          ["2026-10-06", "2026-10-06", bob, "2000-01-01T00:00:00Z"],
        ),
      ),
    );
    assert.equal(
      (
        await db.query(
          "SELECT count(*)::int AS n FROM stride_private.stride_legal_acceptances",
        )
      ).rows[0].n,
      0,
    );
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM auth.users")).rows[0].n,
      3,
    );
  });
});

test("proposal denies every client table privilege and owner RLS remains effective under a hypothetical read grant", async () => {
  await database(async (db) => {
    await record(db, alice);
    await record(db, bob);
    for (const who of ["anon", "authenticated"]) {
      const permissions = (
        await db.query(
          "SELECT has_table_privilege($1, 'stride_private.stride_legal_acceptances', 'SELECT,INSERT,UPDATE,DELETE') AS any_access",
          [who],
        )
      ).rows[0];
      assert.equal(permissions.any_access, false);
    }
    for (const statement of [
      "SELECT * FROM stride_private.stride_legal_acceptances",
      `INSERT INTO stride_private.stride_legal_acceptances VALUES ('${bob}', '2026-10-06', '2026-10-06', now())`,
      `UPDATE stride_private.stride_legal_acceptances SET accepted_at = '2000-01-01' WHERE owner_id = '${alice}'`,
      `DELETE FROM stride_private.stride_legal_acceptances WHERE owner_id = '${alice}'`,
    ])
      await assert.rejects(() => role(db, alice, (tx) => tx.query(statement)));
    // Test-only privileged grant; this is not in the proposal migration.
    await db.exec(
      "GRANT SELECT ON stride_private.stride_legal_acceptances TO authenticated",
    );
    const rows = (
      await role(db, alice, (tx) =>
        tx.query(
          "SELECT owner_id FROM stride_private.stride_legal_acceptances",
        ),
      )
    ).rows;
    assert.deepEqual(
      rows.map((row) => row.owner_id),
      [alice],
    );
    await db.exec(
      "REVOKE SELECT ON stride_private.stride_legal_acceptances FROM authenticated",
    );
    await db.query("DELETE FROM auth.users WHERE id = $1", [alice]);
    assert.deepEqual(
      (
        await db.query(
          "SELECT owner_id FROM stride_private.stride_legal_acceptances",
        )
      ).rows.map((row) => row.owner_id),
      [bob],
    );
    const evidence = (
      await db.query("SELECT * FROM stride_private.stride_legal_acceptances")
    ).rows;
    await db.exec(
      "REVOKE EXECUTE ON FUNCTION public.record_legal_acceptance(text, text), stride_private.record_legal_acceptance_core(text, text) FROM authenticated",
    );
    await assert.rejects(() => record(db, bob));
    assert.deepEqual(
      (await db.query("SELECT * FROM stride_private.stride_legal_acceptances"))
        .rows,
      evidence,
    );
  });
});
