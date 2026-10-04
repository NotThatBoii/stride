import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import {
  jsonBytes,
  operationId,
  operations,
  owner,
  rpcBody,
  workload,
} from "./workload.mjs";

// Actual unchanged SQL; a disposable in-memory account, never hosted data.
const db = await PGlite.create();
const data = workload(100);
const tables = [
  "public.stride_sessions",
  "public.stride_allocations",
  "stride_private.stride_record_versions",
  "stride_private.stride_sync_changes",
  "stride_private.stride_sync_operations",
];
let nextOperation = 1_000;
let requestBytes = 0;
let responseBytes = 0;
let calls = 0;
let lastBody;
let lastReply;
const measurements = [];
try {
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
  `);
  await db.query("insert into auth.users(id) values ($1::uuid)", [owner]);
  await db.exec(
    await readFile(
      new URL(
        "../../supabase/migrations/20260929000000_stride_sync.sql",
        import.meta.url,
      ),
      "utf8",
    ),
  );
  async function apply(body) {
    const reply = await db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub',$1,true)", [
        owner,
      ]);
      return (
        await tx.query(
          "select public.apply_sync_operation($1::uuid,$2::text,$3::text,$4::text,$5::jsonb,$6::text) as result",
          [
            body.p_operation_id,
            body.p_entity,
            body.p_record_id,
            body.p_action,
            body.p_payload === null ? null : JSON.stringify(body.p_payload),
            body.p_expected_revision,
          ],
        )
      ).rows[0].result;
    });
    assert.equal(reply.status, "applied");
    calls++;
    requestBytes += jsonBytes(body);
    responseBytes += jsonBytes(reply);
    lastBody = body;
    lastReply = reply;
    return reply;
  }
  async function snapshot(stage, wallMs) {
    const relations = [];
    for (const table of tables) {
      const row = (
        await db.query(`select count(*)::integer as rows,
        coalesce(sum(pg_column_size(t)),0)::bigint as tuple_bytes,
        pg_total_relation_size('${table}')::bigint as relation_bytes from ${table} t`)
      ).rows[0];
      relations.push({
        table,
        rows: row.rows,
        tupleValueBytes: Number(row.tuple_bytes),
        relationBytes: Number(row.relation_bytes),
      });
    }
    const cursor = (
      await db.query(
        "select sequence::text from stride_private.stride_sync_clocks where owner_id=$1::uuid",
        [owner],
      )
    ).rows[0].sequence;
    measurements.push({
      stage,
      segmentWallMs: wallMs,
      cumulativeApplyCalls: calls,
      requestJsonBytes: requestBytes,
      responseJsonBytes: responseBytes,
      cursor,
      tables: relations,
    });
  }
  const seedStart = performance.now();
  for (const operation of operations(data)) await apply(rpcBody(operation));
  await snapshot(
    "100 completed sessions, 120 allocations, 20 subjects, preferences",
    performance.now() - seedStart,
  );
  let revision = "1";
  const session = data.sessions[0];
  const slices = data.slices.filter((slice) => slice.session_id === session.id);
  for (const endpoint of [10, 100]) {
    const start = performance.now();
    const previous = endpoint === 10 ? 0 : 10;
    for (let index = previous; index < endpoint; index++) {
      const reply = await apply(
        rpcBody({
          id: operationId(nextOperation++),
          entity: "session",
          record_id: session.id,
          action: "upsert",
          base_revision: revision,
          payload: {
            session: {
              ...session,
              notes: `Edit ${index + 1}`.padEnd(100, "x"),
            },
            slices,
          },
        }),
      );
      revision = reply.revision;
    }
    await snapshot(
      `${endpoint} successive edits to one session`,
      performance.now() - start,
    );
  }
  const cycleStart = performance.now();
  for (let index = 0; index < 20; index++) {
    const deleted = await apply(
      rpcBody({
        id: operationId(nextOperation++),
        entity: "session",
        record_id: session.id,
        action: "delete",
        base_revision: revision,
        payload: null,
      }),
    );
    const restored = await apply(
      rpcBody({
        id: operationId(nextOperation++),
        entity: "session",
        record_id: session.id,
        action: "upsert",
        base_revision: deleted.revision,
        payload: { session, slices },
      }),
    );
    revision = restored.revision;
  }
  await snapshot(
    "100 edits plus 20 delete/restore cycles",
    performance.now() - cycleStart,
  );
  const replayBody = lastBody;
  const replayReply = lastReply;
  const replayStart = performance.now();
  for (let index = 0; index < 100; index++)
    assert.deepEqual(await apply(replayBody), replayReply);
  await snapshot(
    "100 exact UUID/body replays of the final accepted restore",
    performance.now() - replayStart,
  );
  assert.deepEqual(measurements.at(-1).tables, measurements.at(-2).tables);
  assert.equal(measurements.at(-1).cursor, measurements.at(-2).cursor);
  const allocations = (
    await db.query(
      "select day::text as day, seconds from public.stride_allocations where owner_id=$1::uuid and session_id=$2 order by day",
      [owner, session.id],
    )
  ).rows;
  assert.deepEqual(
    allocations,
    slices
      .map(({ day, seconds }) => ({ day, seconds }))
      .sort((a, b) => a.day.localeCompare(b.day)),
  );
  await mkdir(new URL("../../docs/measurements/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    process.argv[2] ?? "docs/measurements/phase6-growth.json",
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        engine:
          "PGlite; unchanged checked-in Phase 3 SQL; simulated auth.uid; one SQL connection; no HTTP or hosted latency claim",
        method:
          "Seed 100 completed sessions; edit one session 100 times; explicitly delete/restore it 20 times using each acknowledged revision; replay the final identical operation 100 times. Original day allocations verified unchanged. Relation totals include indexes and allocated page overhead; tuple bytes exclude them.",
        measurements,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      stages: measurements.length,
      finalCalls: calls,
      finalCursor: measurements.at(-1).cursor,
      replayAddedRows: 0,
    }),
  );
} finally {
  await db.close();
}
