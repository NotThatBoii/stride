# Phase 6 performance and Free-plan usage

These are executed local measurements, not hosted capacity or native timing promises. No large synthetic workload was uploaded to production, no backend migration was changed, and no retention was enabled. The machine ran Node 22.17.1 and Edge 154.0.4258.53 on Windows. The checked-in JSON records the timestamps and individual observations.

## Workload and measurement boundary

The repeatable workload contains 20 subjects (two archived), 100, 1,000 or 10,000 completed 30-minute sessions, 100-character notes, and original day allocations. Every fifth session crosses midnight in Asia/Manila, making 120, 1,200 or 12,000 allocation rows. The calendar range spans three years. Archiving hides a subject from dashboard totals while history and the archived subject detail retain its sessions.

`scripts/performance/measure-sql.mjs` applies every record through the **unchanged Phase 3 SQL RPC**, under an authenticated account role in a disposable in-memory PGlite database. It counts receipts, revisions and ordered changes, then pulls the entire ordered feed in 100-change pages. `pg_column_size` measures tuple values and `pg_total_relation_size` includes indexes, TOAST and allocated relation pages. These are Postgres relation measurements in PGlite; hosted Auth/system tables, WAL, production bloat and concurrent workload are not represented.

The browser suite serves a minified production build on a separate loopback port (1435). The workspace tests seed an isolated IndexedDB account and intercept Auth/cloud calls. The sync tests execute the real SDK, worker, parsing and Dexie transactions against unchanged SQL through intercepted RPC transport. No Vite development source hooks run in that app. Service workers are blocked in this suite so PWA lifecycle does not confound the measurements.

Browser startup is navigation through the restored account to the dashboard's painted heading. Route timings are click-to-visible-heading observations, including automation overhead. The recorder captures native IndexedDB read/query calls and transaction durations, and browser tasks of at least 50 ms. UI observations are single runs; the analytics CPU comparison uses one warmup and nine samples. They support targeted diagnosis rather than a statistical service-level objective.

## Measured storage and wire payloads

The exact creation-only results are in [phase6-sql.json](measurements/phase6-sql.json). All sizes below are bytes, not compressed HTTP transfer or billed egress.

| Completed sessions | Allocations | Compact local study JSON | Apply RPC calls | Data pull pages | Full pull JSON | Study + sync relation bytes |
| -----------------: | ----------: | -----------------------: | --------------: | --------------: | -------------: | --------------------------: |
|                100 |         120 |                   46,329 |             121 |               2 |         68,751 |                     524,288 |
|              1,000 |       1,200 |                  424,149 |           1,021 |              11 |        618,891 |                   2,113,536 |
|             10,000 |      12,000 |                4,202,349 |          10,021 |             101 |      6,129,165 |                  17,563,648 |

The extra 21 creates are 20 subjects and shared preferences. Each session's allocations travel inside its one session operation; they do not create one HTTP write per day slice. The 10,000-session relation total includes 7,299,072 bytes of change history, 3,039,232 bytes of immutable operation receipts and 2,293,760 bytes of version/tombstone identities. History plus receipts account for about 59% of that total. Creation requests total 6,155,774 JSON bytes and acknowledgements 1,211,387 bytes. The whole local benchmark database is 25,387,131 bytes, including its 7,954,555-byte pre-workload baseline.

The 100/1,000/10,000 creation segments actually executed 121/900/9,000 new operations in approximately 279/1,563/15,244 ms. Direct SQL pull took approximately 7/35/316 ms. These are in-process SQL durations; they must not be substituted for browser completion or hosted network latency.

## Real client pull, push and backup behavior

See [100](measurements/phase6-sync-100.json), [1,000](measurements/phase6-sync-1000.json) and [10,000](measurements/phase6-sync-10000.json) for actual client results. The worker's complete pull includes one final empty-page check after reaching the head, making 3/12/102 pull calls. For the large account the client receives 6,129,213 JSON bytes, including that empty response, and commits every one of the 10,021 changes. The harness counts IndexedDB queries performed by the app, excluding its own inspection/seed transactions.

Each account then receives a real client upload batch of 100 completed sessions and 120 allocations. It makes exactly **100 apply RPC calls plus two pull calls**, independent of the existing workspace size. The 100-session batch measures an ordinary client queue; a 10,000-item queued client upload is not claimed. Full creation of 10,000 records was measured separately through SQL.

After upload, the UI exports 200/1,100/10,100 sessions, stages that same JSON backup, performs the mandatory current-workspace backup download, and commits the additive import. Exact stored day slices, total counts, cursor and pending state remain unchanged, and **zero duplicate apply operations** are generated. The 10,100-session pretty-printed export is 5,487,199 UTF-8 bytes, below the 25 MB input limit. This validates a large same-ID backup round trip; divergent collisions and older backup versions have separate hardening coverage.

The final client observations are:

| Existing cloud sessions | Full client pull, ms | 100-session upload batch, ms | Export after upload, ms | Same-ID import including required backup, ms |
| ----------------------: | -------------------: | ---------------------------: | ----------------------: | -------------------------------------------: |
|                     100 |                  915 |                        3,964 |                     794 |                                        1,318 |
|                   1,000 |                4,451 |                        2,991 |                     505 |                                        1,810 |
|                  10,000 |               36,427 |                        3,001 |                     570 |                                        8,284 |

At 10,000 sessions, the app's full pull issues 40,388 store gets, 30,227 index getAll calls, 110 store getAll calls, 10,032 cursor opens and 10,000 index getAllKeys calls. The subsequent 100-session client batch uses 1,112 store gets, 300 index getAll, 301 store getAll and 806 cursor opens at every tested workspace size. These are native IndexedDB API call counts, not one database HTTP query per call or a claim that each query reads only one row.

The JSON files contain all durations and query counts. Their network model omits actual HTTP serialization overhead, TLS, Supabase compute contention and internet latency. An initial 10,000-session device pull remains a materially longer operation than opening an already-cached account; it is measured rather than hidden by a direct-fixture seed. Other development activity was present on this shared Windows host during final browser observations. The large selector improvement is clear, but small timing differences should not be treated as controlled statistical results.

## Targeted frontend fixes and bundle impact

The recorded baseline revealed two repeated quadratic selectors. History checked every session against all slices, and the app repeated an all-session/all-slice day-modal scan even while that modal was closed. At 10,000 sessions, their nine-sample median CPU costs were about 688 ms and 1,438 ms; the equivalent indexed History candidate took about 0.95 ms. See [phase6-analytics.json](measurements/phase6-analytics.json).

History now builds one set of matching session IDs and memoizes the filtered result. The day-modal selector exits when the modal is closed, uses matching ID sets, and recomputes only when its data or selection changes. Session display already had 20-row incremental rendering; the fix preserves that UI and all archived-session/date-filter semantics. No SQL, pagination contract or original day allocation changed.

Auth loads the workspace application after authentication, and non-Home pages load on demand. This lowers the JavaScript required to execute the signed-out entry, without replacing dependencies or widening CSP. The before/after bundle artifacts provide exact minified/gzip sizes and Rollup module attribution before minification:

| JavaScript scope                                  | Recorded baseline bytes / gzip | Final bytes / gzip |
| ------------------------------------------------- | -----------------------------: | -----------------: |
| Signed-out entry and static dependencies          |              792,841 / 229,968 |  727,332 / 212,330 |
| Authenticated Home cumulative entry + App         |              792,841 / 229,968 |  777,620 / 227,690 |
| All JS chunks, including optional/native adapters |              796,002 / 231,525 |  825,361 / 244,668 |

The complete app grows because Phase 6 adds recovery/PWA behavior and separate chunks. Initial Auth execution decreases by about 8.3%, while the all-route total increases by about 3.7%. Final CSS is 41,755 bytes / 9,197 gzip for the entry plus 1,135 bytes / 431 gzip for the Settings recovery styles. The generated worker is 3,990 bytes / 1,592 gzip. The static PWA installer **precaches every generated lazy chunk**, so lazy execution is not a promise that a newly prepared offline app downloads less total JS. The entry remains above Vite's 500 KB chunk warning. React DOM, the official Supabase SDK and validation account for much of the pre-minification attribution; removing security validation or substituting a private Auth implementation to shrink it was not justified.

See [baseline](measurements/phase6-bundle-before.json) and [final](measurements/phase6-bundle-after.json). Rendered module lengths are before final minification and cannot be treated as each package's compressed contribution.

Production browser before/after observations are recorded for [100](measurements/phase6-browser-100-before.json), [1,000](measurements/phase6-browser-1000-before.json), [10,000](measurements/phase6-browser-10000-before.json) and their matching final JSON files. The large baseline took about 1,453 ms to reach Home, 6,195 ms for History, 6,777 ms for Insights and 986 ms to return Home. It also recorded 1,029/844/467 ms tasks during three idle seconds. Final runs distinguish first lazy route loading from subsequent warm navigation:

| Sessions | Final startup, ms | First History / warm History, ms | First Insights / warm Insights, ms | Return Home, ms | Study snapshot read transaction, ms |
| -------: | ----------------: | -------------------------------: | ---------------------------------: | --------------: | ----------------------------------: |
|      100 |               487 |                         380 / 78 |                           353 / 41 |              97 |                                  18 |
|    1,000 |               526 |                         322 / 63 |                           360 / 44 |              92 |                                  33 |
|   10,000 |               771 |                         411 / 82 |                           267 / 59 |             140 |                                 227 |

All final cases record zero long tasks during their three idle seconds. Existing IndexedDB opens took about 1/8/71 ms; fixture writes took 13/109/1,170 ms. Startup issued 18 store gets, four index getAll, three store getAll and four cursor opens in each account; the three full-store reads naturally return more rows at larger sizes. Fixture writes are a measurement setup, not a supported production import mechanism. Small-workspace timing differences should not be interpreted as statistically significant improvements.

## Free-plan budget and practical assumptions

Checked on **2026-10-04**: the Free plan lists 500 MB database size per project, 50,000 monthly active users, unlimited API requests, 5 GB uncached egress and a separate 5 GB cached egress allowance. [Supabase pricing](https://supabase.com/pricing). Cached egress normally represents Storage/CDN cache hits; it is **not an extra 5 GB budget for Auth/database RPC traffic**. Database, Auth and other uncached services share uncached egress. [Supabase egress documentation](https://supabase.com/docs/guides/platform/manage-your-usage/egress).

One fresh 10,000-session device downloads about 6.13 MB of measured RPC JSON; three new devices download about 18.39 MB before Auth, HTTP overhead and subsequent edits. A 100-session incremental batch receives about 75.7 KB of apply/pull response JSON at that size. These are conservative planning inputs before compression, not dashboard billing measurements. A 5 GB decimal budget divided only by the measured full-pull body is roughly 815 such downloads; real capacity is lower once other traffic is included. Use incremental cursors rather than repeatedly resetting devices or importing as new IDs.

With a visible app polling once per minute, three unchanged devices used eight hours per day for 30 days imply 43,200 empty polls. At the measured 48-byte large-cursor response that is about 2.07 MB of response JSON, plus unmeasured protocol/Auth overhead. Hidden windows skip this regular poll. Edits, reconnect and foreground/manual triggers add calls. The benchmark sign-in uses one Auth request per fresh account context; real token refresh and email-confirmation traffic are not represented by fixture Auth. Auth counts each unique user once per billing cycle even when they sign in or refresh on several devices. [Supabase MAU documentation](https://supabase.com/docs/guides/platform/manage-your-usage/monthly-active-users). Unlimited API requests does not mean unlimited CPU, connections or egress.

The 10,000-session single-account relation total is approximately 17.56 MB. Multiplying it by account count is only a rough planning exercise: shared pages amortize differently, and real notes, edit history, conflict payloads, recovery copies, Auth rows and bloat increase usage. The measured 1,000-to-10,000 creation increment is about 1.72 KB per additional session, including feed/receipt/version overhead. A 400 MB study-data planning budget would therefore represent roughly 233,000 creation-only sessions under this exact workload; it is **not a supported-user limit** and assumes no subsequent edits or deletion history. Keep substantial project headroom and inspect actual usage before broad onboarding.

Free databases can enter read-only mode above their size quota. The documented limit concerns database data rather than provisioned disk space. [Supabase database size documentation](https://supabase.com/docs/guides/platform/database-size). Local saved data remains preserved when writes fail; increasing quota, pruning or changing account/Auth settings requires a separate decision. This phase does not activate any paid service or delete history to fit an estimate.

## Repeat-edit growth and retention consequence

`scripts/performance/measure-growth.mjs` measures a second disposable account through the same unchanged RPC: 100 baseline sessions, 100 edits of one session, 20 explicit delete/restore cycles, then 100 exact UUID/body replays. It verifies that restored midnight allocations retain their original days and that exact replay adds no feed/receipt/version rows. Its artifact is [phase6-growth.json](measurements/phase6-growth.json).

The measured live sessions/allocations remain 100/120 throughout the completed stages. One hundred edits increase feed rows 121→221 and feed relation bytes 131,072→204,800; receipt relation bytes increase 81,920→122,880. Twenty delete/restore cycles increase the cursor and feed/receipt rows to 261, feed relation bytes to 237,568 and receipt relation bytes to 131,072. Version identities stay at 121. The final 100 exact replays leave the cursor and every measured table count, tuple value size and relation size unchanged.

Accepted edits and deletes add immutable changes and operation proofs while the live session count stays nearly constant. Replayed already-accepted requests still consume request/response work but cannot add another mutation. Relation growth is page-based, not an exact per-edit marginal charge; no vacuum/bloat workload was simulated. Retention must therefore address historical growth without destroying uncertain-operation proofs, tombstone identities or unseen cascade recovery payloads. [The retention proposal](PHASE_6_RETENTION.md) specifies that prerequisite protocol and approval gate; no history or receipt pruning is implemented here.

## Reproduction and remaining measurements

Run `node scripts/performance/measure-sql.mjs`, `node scripts/performance/measure-growth.mjs`, `node --experimental-strip-types scripts/performance/measure-analytics.mjs`, `node scripts/performance/measure-bundle.mjs docs/measurements/phase6-bundle-after.json`, and `npx playwright test --config=playwright.performance.config.ts`. The performance config owns its isolated output directory and server; run timing suites sequentially on an otherwise idle machine. Existing baseline artifacts are historical evidence and should not be overwritten by the optimized source.

Six final browser cases cover the three workspace sizes plus three complete client pull/upload/export/import round trips. Physical mobile memory/battery behavior, packaged-native performance, hosted shared-compute saturation, live quota headroom and a 10,000-item client outbox drain remain separate measurements. Native and hosted validation status belongs in [the main Phase 6 report](PHASE_6_HARDENING.md).
