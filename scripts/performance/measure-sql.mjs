import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { PGlite } from "@electric-sql/pglite";
import {
  jsonBytes,
  operations,
  owner,
  rpcBody,
  sizes,
  workload,
} from "./workload.mjs";

const tables = [
  "public.stride_subjects",
  "public.stride_sessions",
  "public.stride_allocations",
  "public.stride_preferences",
  "stride_private.stride_record_versions",
  "stride_private.stride_sync_clocks",
  "stride_private.stride_sync_changes",
  "stride_private.stride_sync_operations",
];
const output = process.argv[2] ?? "docs/measurements/phase6-sql.json";
const percentile = (values, p) =>
  [...values].sort((a, b) => a - b)[Math.ceil(values.length * p) - 1];
const db = await PGlite.create();
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
  const baselineDatabaseBytes = Number(
    (await db.query("select pg_database_size(current_database()) as bytes"))
      .rows[0].bytes,
  );
  async function rpc(name, params) {
    return db.transaction(async (tx) => {
      await tx.exec("set local role authenticated");
      await tx.query("select set_config('request.jwt.claim.sub', $1, true)", [
        owner,
      ]);
      const query =
        name === "apply"
          ? "select public.apply_sync_operation($1::uuid,$2::text,$3::text,$4::text,$5::jsonb,$6::text) as result"
          : "select public.get_sync_changes($1::text,$2::integer) as result";
      return (await tx.query(query, params)).rows[0].result;
    });
  }
  const full = workload(10_000);
  const all = operations(full);
  const measurements = [];
  const durations = [];
  let sent = 0;
  let requestBytes = 0;
  let acknowledgmentBytes = 0;
  for (const count of sizes) {
    const started = performance.now();
    const before = sent;
    while (sent < count + 21) {
      const operation = all[sent];
      const body = rpcBody(operation);
      const t = performance.now();
      const result = await rpc("apply", [
        body.p_operation_id,
        body.p_entity,
        body.p_record_id,
        body.p_action,
        JSON.stringify(body.p_payload),
        body.p_expected_revision,
      ]);
      durations.push(performance.now() - t);
      assert.equal(result.status, "applied");
      requestBytes += jsonBytes(body);
      acknowledgmentBytes += jsonBytes(result);
      sent++;
    }
    const applyWallMs = performance.now() - started;
    let cursor = "0";
    let pages = 0;
    let changes = 0;
    let pullResponseBytes = 0;
    let pullRequestBytes = 0;
    const pullStarted = performance.now();
    do {
      const result = await rpc("changes", [cursor, 100]);
      pages++;
      pullRequestBytes += jsonBytes({ p_after: cursor, p_limit: 100 });
      pullResponseBytes += jsonBytes(result);
      for (const change of result.changes) {
        assert.equal(BigInt(change.sequence), BigInt(cursor) + 1n);
        cursor = change.sequence;
        changes++;
      }
      assert.equal(result.cursor, cursor);
      if (!result.has_more) break;
    } while (true);
    assert.equal(changes, sent);
    assert.equal(pages, Math.ceil(sent / 100));
    const pullWallMs = performance.now() - pullStarted;
    const tableMeasurements = [];
    for (const table of tables) {
      const result = (
        await db.query(`select count(*)::integer as rows,
        coalesce(sum(pg_column_size(t)),0)::bigint as tuple_value_bytes,
        pg_total_relation_size('${table}')::bigint as relation_bytes
        from ${table} as t`)
      ).rows[0];
      const records = (
        await db.query(`select to_jsonb(t) as value from ${table} as t`)
      ).rows;
      tableMeasurements.push({
        table,
        rows: result.rows,
        tupleValueBytes: Number(result.tuple_value_bytes),
        relationBytes: Number(result.relation_bytes),
        serializedRowBytes: records.reduce(
          (sum, row) => sum + jsonBytes(row.value),
          0,
        ),
      });
    }
    const data = workload(count);
    assert.equal(data.slices.length, count * 1.2);
    const empty = await rpc("changes", [cursor, 100]);
    const entry = {
      sessions: count,
      allocations: data.slices.length,
      localJsonBytes: jsonBytes(data),
      subjectJsonMeanBytes:
        data.subjects.reduce((sum, value) => sum + jsonBytes(value), 0) / 20,
      sessionJsonMeanBytes:
        data.sessions.reduce((sum, value) => sum + jsonBytes(value), 0) / count,
      allocationJsonMeanBytes:
        data.slices.reduce((sum, value) => sum + jsonBytes(value), 0) /
        data.slices.length,
      applyCalls: sent,
      applyRequestBytes: requestBytes,
      applyResponseBytes: acknowledgmentBytes,
      applySegmentOperations: sent - before,
      applySegmentWallMs: applyWallMs,
      cumulativeApplyRpcMedianMs: percentile(durations, 0.5),
      cumulativeApplyRpcP95Ms: percentile(durations, 0.95),
      initialPullCalls: pages,
      initialPullChanges: changes,
      initialPullRequestBytes: pullRequestBytes,
      initialPullResponseBytes: pullResponseBytes,
      initialPullWallMs: pullWallMs,
      emptyPullResponseBytes: jsonBytes(empty),
      tables: tableMeasurements,
      relationBytes: tableMeasurements.reduce(
        (sum, value) => sum + value.relationBytes,
        0,
      ),
      databaseBytes: Number(
        (await db.query("select pg_database_size(current_database()) as bytes"))
          .rows[0].bytes,
      ),
    };
    measurements.push(entry);
    console.log(
      JSON.stringify({
        sessions: count,
        applyCalls: sent,
        initialPullCalls: pages,
        relationBytes: entry.relationBytes,
        applySegmentWallMs: applyWallMs,
      }),
    );
  }
  await mkdir(new URL("../../docs/measurements/", import.meta.url), {
    recursive: true,
  });
  await writeFile(
    output,
    JSON.stringify(
      {
        measuredAt: new Date().toISOString(),
        runtime: process.version,
        platform: process.platform,
        engine:
          "PGlite; unchanged checked-in Phase3 SQL; simulated auth.uid; one SQL connection; no HTTP",
        baselineDatabaseBytes,
        assumptions: {
          subjects: 20,
          archivedSubjects: 2,
          sessionSeconds: 1800,
          noteCharacters: 100,
          midnightFraction: 0.2,
          pageSize: 100,
          edits: 0,
          deletes: 0,
        },
        measurements,
      },
      null,
      2,
    ) + "\n",
  );
} finally {
  await db.close();
}
