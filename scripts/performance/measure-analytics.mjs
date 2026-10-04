import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { aggregate, streaks } from "../../src/lib/analytics.ts";
import { sizes, workload } from "./workload.mjs";

const median = (values) =>
  [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
function measure(work) {
  work();
  const samples = Array.from({ length: 9 }, () => {
    const t = performance.now();
    work();
    return performance.now() - t;
  });
  return {
    medianMs: median(samples),
    maxMs: Math.max(...samples),
    samplesMs: samples,
  };
}
const measurements = sizes.map((count) => {
  const data = workload(count);
  const active = new Set(
    data.subjects.filter((s) => !s.archived).map((s) => s.id),
  );
  const sessions = data.sessions.filter((s) => active.has(s.subject_id));
  const days = aggregate(sessions, data.slices);
  assert.equal(
    [...days.values()].reduce((sum, seconds) => sum + seconds, 0),
    sessions.length * 1_800,
  );
  // These reproduce the existing selectors only to compare their CPU work;
  // real browser page/paint observations are recorded separately.
  const history = () =>
    data.sessions.filter((s) => data.slices.some((x) => x.session_id === s.id));
  const indexedHistory = () => {
    const ids = new Set(data.slices.map((slice) => slice.session_id));
    return data.sessions.filter((session) => ids.has(session.id));
  };
  assert.deepEqual(indexedHistory(), history());
  return {
    sessions: count,
    includedDashboardSessions: sessions.length,
    recordedDays: days.size,
    heatmapAggregate: measure(() => aggregate(sessions, data.slices)),
    streakCalculation: measure(() => streaks(days, 20, "2026-10-04")),
    historySelector: measure(history),
    indexedHistorySelectorCandidate: measure(indexedHistory),
    closedDayModalSelector: measure(() =>
      data.sessions.filter((s) =>
        data.slices.some((x) => x.session_id === s.id && x.day === undefined),
      ),
    ),
  };
});
await mkdir(new URL("../../docs/measurements/", import.meta.url), {
  recursive: true,
});
await writeFile(
  process.argv[2] ?? "docs/measurements/phase6-analytics.json",
  JSON.stringify(
    {
      measuredAt: new Date().toISOString(),
      runtime: process.version,
      method:
        "Actual analytics functions, one warmup and nine CPU samples; selector expressions reproduce baseline code, not browser paint. Candidate selector equivalence checked; no application code change.",
      measurements,
    },
    null,
    2,
  ) + "\n",
);
for (const item of measurements)
  console.log(
    JSON.stringify({
      sessions: item.sessions,
      historyMs: item.historySelector.medianMs,
      closedModalMs: item.closedDayModalSelector.medianMs,
      indexedHistoryMs: item.indexedHistorySelectorCandidate.medianMs,
    }),
  );
