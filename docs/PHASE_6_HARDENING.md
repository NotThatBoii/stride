# Phase 6: release hardening

**Review status, 2026-10-04: implementation and local hardening coverage are complete; final native, hosted, email and CI gates are still being recorded.** This report distinguishes executed checks from pending evidence. It is not a claim that every release target has passed.

Work began from clean `main` at `9f240b6`, after [Phase 5 / PR #7](https://github.com/NotThatBoii/stride/pull/7) was merged. The Phase 2, 3, 4, 4.1 and 5 reports were reviewed. The unchanged baseline passed 143 unit tests, 13 database contract tests, browser suites of 7/14/15 cases, and the production build before creating `codex/phase-6-hardening`. `main` was not edited.

The existing React/Tauri/Dexie/Supabase architecture remains in place. Active timers stay device-local, authentication remains required, conflicting versions are preserved, and account caches remain separate. No hosted migration, Auth-setting change, paid service, Realtime integration or history/receipt pruning is introduced.

## 1. Files modified

The PR diff is authoritative. The principal changes are grouped below; measurement JSON and browser fixtures contain synthetic records only.

- Release configuration: `config/supabase-public.json`, `config/native-validation.json`, `scripts/build-desktop.mjs`, `scripts/build-web.mjs`, `scripts/public-build-config.mjs`, its Node tests, `package.json`, and `.github/workflows/windows.yml` / `check.yml`.
- PWA and branding: `scripts/pwa.mjs` / `.d.mts`, `src/lib/pwa.ts` / `.test.ts`, `src/components/Pwa.tsx`, `src/pwa.css`, `public/manifest.webmanifest`, `_headers`, and the existing Stride SVG plus 180/192/512 px PNG icons. `vite.config.ts`, `index.html`, `src/main.tsx`, `App.tsx`, `AuthenticationScreen.tsx` and `Settings.tsx` integrate the shared app and lifecycle UI.
- Recovery and failure safety: `RecoveryCenter.tsx`, `SyncPanel.tsx`, `recovery.css`, `local-database.ts`, `platform.ts`, `src/lib/sync/{client,conflicts,failures,pull,push,worker,recovery,recovery-export}.ts`, `Sessions.tsx`, `SubjectEditor.tsx` and `Focus.tsx`.
- Targeted rendering/mobile fixes: `App.tsx`, `History.tsx`, `main.tsx` and `src/mobile.css`; the existing React view navigation is retained.
- Tests/fixtures: foundation, conflict, protocol and recovery unit tests; `supabase/tests/client-integration.test.ts`; existing Auth, countdown, workspace and multi-device fixtures/tests; `tests/auth-mock.ts` and `sync-fixture.ts`; new hardening, recovery, stress, production PWA and performance browser suites, their Playwright configs and runner scripts.
- Evidence/docs: this report, README, [data-safety audit](PHASE_6_DATA_SAFETY.md), [PWA lifecycle](PHASE_6_PWA.md), [retention proposal](PHASE_6_RETENTION.md), [performance/usage report](PHASE_6_PERFORMANCE.md), [stress report](PHASE_6_STRESS.md), `docs/measurements/phase6-*.json`, and two recovery screenshots.

## 2. Windows packaged validation

**CI tested:** both ordinary release and isolated validation installers/executables built successfully for source checkpoint `8b11c06` in [Windows run 37195373455](https://github.com/NotThatBoii/stride/actions/runs/37195373455). These are actual Tauri/Rust/NSIS builds, not Vite-only substitutes.

**Packaged Windows tested, checkpoint `3d96ad8`:** the actual validation package launched on this Windows machine, signed in, pushed study data, worked offline, preserved a paused timer, and restored its account/timer/cache after closing and reopening. The validation package uses the separate `com.philippaglinawan.stride.validation` identity and disposable test state. It does not replace the user's ordinary Stride installation/profile.

The `8b11c06` validation installer was subsequently installed and launched. It restored that account cache and paused timer, opened the real Settings recovery UI with zero issue counts and no error, and completed an actual native **Save As** JSON export. The written file validated as `stride` version 1 with the saved subject and running-timer checkpoint. This establishes native saving; native opening/import and notifications remain separate gates.

The local `desktop:build` attempt failed because Cargo/Rust and Visual Studio C++ Build Tools/Windows SDK are absent; WebView2 is installed. The system drive had about 9.3 GB free when assessed. Installing the full development toolchain was not a reasonable low-impact prerequisite to testing an already-built CI artifact. CI supplied the real compiler/toolchain instead.

| Required packaged behavior                                             | Recorded status                                                    |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------ |
| Launch, sign-in, account workspace, push                               | Passed on `3d96ad8` validation package                             |
| Offline study/timer state, close/restart persistence, restored account | Passed on that package                                             |
| Upgraded `8b11c06` package                                             | Installed/launched; restored account/cache/paused timer            |
| Pull/reverse sync, reconnect retry, sync-status UI                     | **PENDING FINAL VALIDATION**                                       |
| Native JSON Save As export                                             | Passed; written version-1 JSON validated                           |
| Native open dialog and backup-gated import                             | **PENDING FINAL VALIDATION**                                       |
| Native countdown notification                                          | **PENDING FINAL VALIDATION**                                       |
| Recovery UI                                                            | Settings area opened with zero issues/no error on upgraded package |
| Sign-out, account switch and conflict actions                          | **PENDING FINAL VALIDATION**                                       |

Packaged coverage is limited to the explicit rows above until the remaining run is recorded. Browser platform mocks are not evidence of native dialogs or notifications. macOS/Linux packages and physical iOS/Android behavior are untested.

## 3. PWA implementation

**Implemented and locally tested:** the hosted build contains an existing-brand manifest, stable root identity, standalone display mode, theme/background metadata and PNG icons. It reuses the React app without a new runtime dependency. Settings exposes browser installation when an actual install prompt is available, and otherwise gives browser-menu/Add to Home Screen guidance.

The production PWA suite passed **5 tests**, with **1 optional OS-install experiment skipped**. A disposable persistent Edge profile had no installability errors. Experimental install commands acknowledged success, but standalone launch was not exposed as a controllable app; these acknowledgements are not proof of working OS installation. Headed cleanup of that exact disposable profile completed uninstall and returned an unknown app identity. No user browser profile was touched.

Actual Windows OS PWA standalone launch, physical Android Add to Home Screen and iOS/Safari installation remain unverified. Hosted deployment of the reviewed PWA branch is also pending. See [PWA implementation and limits](PHASE_6_PWA.md).

## 4. Offline app shell

The build generates a versioned exact allowlist of static HTML, all emitted route JS/CSS and known branding assets. The worker caches no Auth, Supabase/RPC/API response, arbitrary JSON, query-bearing request or private study data. Account history, outbox, conflicts and timers stay in account-scoped IndexedDB. Development and native Tauri builds do not register the web worker.

Executed production-browser tests verify unsigned offline shell reopen; restored account/cache/outbox/paused timer; offline timer save; successful reconnect sync; and a durable offline sign-out barrier. An initial login, email callback or expired session requiring refresh still needs a connection.

Updates precache completely and wait for explicit acceptance. Reload is blocked while a local write or unsaved timer exists; other open Stride windows must close first. Activation retains one prior static build to tolerate chunk races and preserves IndexedDB/pending operations. A failed initial worker registration recovers through **Check for updates**. Storage eviction/clearing can still remove local data; the shell does not replace downloaded backups.

## 5. Recovery-center behavior

**Settings → Recovery and sync issues** exposes failed/pending/uncertain changes, preserved copies, unresolved-conflict actions, last successful sync and safe persisted error summaries. Users can inspect a change/copy, export the complete account recovery envelope, explicitly retry an unchanged frozen request, or rebuild an eligible rejected operation after export. Valid preserved history opens the existing backup-gated additive importer. No casual cleanup/reset/delete-copy action is offered.

Invalid never-submitted changes are quarantined without dropping the user record or blocking unrelated valid work. **Sync now** does not repeatedly clear permanent quarantine. Transient, Auth, conflict, validation, server-rejection and corruption states remain distinct. Malformed/uncertain acknowledgements retain the original UUID/body; a damaged status cannot make an existing `wire_request` appear unsubmitted.

Repair requires a validated current record and trusted rollback/no-submission evidence, preserves the original operation chain, retains its original base revision and checks a review fingerprint after export. SQL UUID-reuse errors and legacy unversioned rollback flags cannot authorize replacement. Missing/invalid data remains inspection/export-only. Every operation stays account/lifecycle guarded and atomic.

The full diagnostic export preserves raw damaged values, missing-index rows, binary/Blob data and cycles without reading Auth storage or another account. Study-history export is a separate validated format. Session deletion and timer discard now preserve recoverable copies before removal; account-wide replacement restore fails closed. See [the path-by-path deletion/replacement audit](PHASE_6_DATA_SAFETY.md) for surviving copy, confirmation and reversal of each path.

## 6. Retention-policy proposal

**Design only; no migration or pruning deployed.** The proposal retains tombstone/version identities and operation UUID/hash/outcome proofs, and requires immutable per-deletion recovery bundles before truncating the feed. A snapshot of only currently live rows would otherwise lose a late child's unseen upsert→cascade-delete history.

A future protocol needs versioned manifest/cursor floors and epochs, consistent pinned paged snapshots, durable device acknowledgements, proof/fence handling for delayed uncertain requests, compatibility for old clients, and recoverable atomic adoption. Expiring device leases select that recovery path; they do not authorize deletion of local pending/conflict/timer data. Proposed durations are unapproved examples.

[The complete proposal](PHASE_6_RETENTION.md) specifies RPC/migration responsibilities, account deletion/device reset behavior, proof tests and an explicit approval gate. It cannot be activated merely by merging this client PR.

## 7. Performance measurements

Actual production Edge observations cover 100/1,000/10,000 sessions. At 10,000, cached startup was **771 ms**; first/warm History **411/82 ms**; first/warm Insights **267/59 ms**; return Home **140 ms**; study snapshot read **227 ms**. Final cases recorded no long tasks during three idle seconds. Before the targeted selector fixes, History took 6,195 ms, Insights 6,777 ms and idle tasks reached 1,029 ms.

The indexed History selector and closed day-modal guard address measured quadratic work. Heatmap aggregation itself measured about 1.19 ms at 10,000 sessions in the nine-sample CPU benchmark and was not rewritten. Final full client pull took **36,427 ms**, including 102 pages/empty-head check; a 100-session incremental upload took **3,001 ms**, with exactly 100 apply and two pull RPCs.

These are shared-Windows-host observations through isolated local SQL/mock Auth transport, not hosted/native latency or statistical promises. All raw timings, transaction/query counts and methodology are in [the performance report](PHASE_6_PERFORMANCE.md).

## 8. Bundle-size measurements

| Minified JavaScript scope            | Baseline bytes / gzip | Final measurement bytes / gzip |
| ------------------------------------ | --------------------: | -----------------------------: |
| Signed-out entry/static dependencies |     792,841 / 229,968 |              727,332 / 212,330 |
| Authenticated Home cumulative        |     792,841 / 229,968 |              777,620 / 227,690 |
| Every JS chunk                       |     796,002 / 231,525 |              825,361 / 244,668 |

Auth defers the workspace app; non-Home views load on demand. Initial executed JS decreases about 8.3%, while added recovery/PWA behavior increases the total about 3.7%. PWA preparation still precaches all route chunks. Measured entry CSS is 41,755 bytes plus 1,135 bytes of Settings CSS; the worker is 3,990 bytes. The entry still triggers Vite's 500 KB warning. Module attribution identifies React DOM, the official Supabase SDK and validation as large contributors; no security validation or maintained SDK was removed for a marginal size gain. These saved artifact measurements are a Phase 6 optimization checkpoint with public test configuration; subsequent reviewed guards and exact release-key embedding can change a few bytes. They are not presented as byte-for-byte `af81874` packaged output.

## 9. Free-tier usage estimates

Measured creation-only local SQL/workspace results:

| Sessions / allocations | Compact study JSON | Full data-feed JSON | Study + sync relation bytes | Create / data-pull RPC counts |
| ---------------------- | -----------------: | ------------------: | --------------------------: | ----------------------------: |
| 100 / 120              |             46,329 |              68,751 |                     524,288 |                       121 / 2 |
| 1,000 / 1,200          |            424,149 |             618,891 |                   2,113,536 |                    1,021 / 11 |
| 10,000 / 12,000        |          4,202,349 |           6,129,165 |                  17,563,648 |                  10,021 / 101 |

At 10,000 sessions, feed plus receipts occupy about 10.34 MB/59% of relation storage. Average compact subject/session/allocation JSON is about 208/335/69 bytes in this 100-character-note workload. Another measurement executes 100 edits and 20 delete/restore cycles while live rows remain 100 sessions/120 allocations; feed/receipt counts increase 121→261. A hundred exact replays leave all measured row/byte counts and cursor unchanged.

Checked 2026-10-04, Free lists 500 MB database/project, 50,000 MAU, unlimited API requests and 5 GB uncached egress; the separate 5 GB cached allowance normally covers Storage/CDN hits, not extra RPC capacity. [Supabase pricing](https://supabase.com/pricing), [egress](https://supabase.com/docs/guides/platform/manage-your-usage/egress). Three fresh large-account devices receive roughly 18.39 MB of feed JSON before Auth/HTTP overhead. Quotas, real Auth/system rows, edits, bloat and project-wide activity limit capacity; measured local sizes are not a supported-user count. The architecture remains reasonable for modest incremental personal use with headroom; heavy unpruned edit history must be monitored. [Detailed assumptions and budget calculations](PHASE_6_PERFORMANCE.md#free-plan-budget-and-practical-assumptions).

## 10. Large-workspace and mobile results

**Six production performance cases passed:** 100/1,000/10,000 sessions, 20 subjects including two archived, three years of dates and original midnight allocations. Dashboard/heatmap totals, selected-day detail, history filters/20-row incremental display, insights and archived subject pages agree. Each workspace also completes a real full client pull, 100-session upload, JSON export and required-backup same-ID additive reimport with unchanged allocations/cursor and zero duplicate writes. The largest export contains 10,100 sessions/12,120 allocations, is 5,487,199 bytes, and takes 570 ms to export / 8,284 ms to backup-gate and reimport.

**Three mobile-width flows passed** at 360/390/430 px in Edge. Each checks Auth, both onboarding steps, Home, subject list/detail, ready/running/paused Focus, History, Insights, Settings, sync/conflict/recovery controls and legacy offer/review/backup. No document/control overflow or ordinary visible button below the checked 44 px target remains; heatmap cells stay in their accessible scrolling region. CSS raises normal button/input/select targets, uses 16 px input text and wraps dialog actions. [360](measurements/phase6-mobile-360.json), [390](measurements/phase6-mobile-390.json), [430](measurements/phase6-mobile-430.json). These are viewport checks, not physical-phone/touch-event or mobile memory/battery measurements.

## 11. Multi-device, network, timezone and backup stress

**16 browser/SQL stress tests passed**, alongside the existing 15 sync cases. Three separate logical devices preserve sequential revisions, competing offline edits and independent histories through repeated reconnects and explicit conflict choices. Lost acknowledgements, duplicate UUID replay, close during committed push, refresh during pull, sign-out/account switch during delayed work and parent/child deletion races retain recoverable data.

Cases cover actual browser offline cycles, 429/Retry-After, distinct 500/502/503 responses, dropped/aborted requests, a real 30-second timeout, malformed cursor replies, expired RPC tokens and failed Auth refresh. Original midnight and DST allocations survive Manila/New York/Berlin round trips and travel/reload. Synced and older supported version-1 backups deduplicate or preserve divergent IDs through backup-gated Keep both. Unsupported formats fail validation.

These contexts share one computer; PGlite has one SQL connection and controlled Auth/network responses. They do not prove three physical devices or concurrent hosted PostgreSQL connections. [Exact cases and limitations](PHASE_6_STRESS.md).

## 12. Production smoke and real email

Production remains [stride-89c.pages.dev](https://stride-89c.pages.dev), with the intended Supabase project. The packaged checkpoint tests above exercised only their recorded scope; they are not the requested full hosted-web sign-up-to-reverse-sync smoke.

The review deployment initially displayed the missing-public-configuration gate. `scripts/build-web.mjs` now validates the intended public fallback, runs strict TypeScript/Vite with the same public-only build environment and checks the emitted frontend. Its local production build passed. The fix was pushed in `2c864d5`; the refreshed deployed review must still be exercised before claiming hosted success. Development missing-config tests continue to use the unchanged gate.

**PENDING FINAL VALIDATION — hosted web smoke:** record review/production deployment URL and source, disposable-account creation method, sign-in/subject/session/push, second independent context/pull, reverse edit, offline/reconnect, sign-out/sign-back-in persistence and exact cleanup. No Phase 6 complete hosted-web smoke is claimed yet. Phase 5's hosted RPC/SDK evidence remains historical and is not relabelled as Phase 6 execution.

**Awaiting a reachable disposable inbox:** public signup, receipt of a real confirmation email, confirmation-link redirect, post-confirmation login and absence of redirect loops remain unverified. Administrative confirmation or mocked signup cannot establish email delivery. No personal account is used for destructive testing, and no Supabase Auth/redirect/SMTP setting is changed without a separately explained approval.

## 13. Exact automated test counts

Counts below describe completed local runs; they are not summed with earlier checkpoint runs or overlapping focused unit subsets.

| Suite                                |                        Local executed result | Scope                                                                           |
| ------------------------------------ | -------------------------------------------: | ------------------------------------------------------------------------------- |
| `npm test`                           |                                   180 passed | Unit/storage/Auth/platform/protocol/recovery, including four PWA boundary tests |
| `test:db`                            |                                    13 passed | Unchanged SQL/RLS/RPC contracts in PGlite                                       |
| `test:release-config`                |                                     3 passed | Public-only config and embedded-credential rejection                            |
| `test:e2e`                           |                                     7 passed | Existing browser workflows/persistence                                          |
| `test:e2e:auth`                      |                                    14 passed | Auth gate, restore, sign-out, isolation                                         |
| `test:e2e:sync`                      |                                    15 passed | Independent contexts with unchanged SQL                                         |
| `test:e2e:hardening`                 |                                     3 passed | 360/390/430 px flows                                                            |
| `test:e2e:recovery`                  |                                     3 passed | Export gates, repair and deleted-session restoration                            |
| `test:e2e:pwa`                       | 5 passed, 1 optional OS-install test skipped | Real production worker/cache/update lifecycle                                   |
| `test:e2e:performance`               |                                     6 passed | Three workload sizes and three full client/backup round trips                   |
| `test:e2e:stress`                    |                                    16 passed | Multi-device/network/timezone/backup stress                                     |
| SQL size/growth and bundle harnesses |                        Executed successfully | Measurement/assertion programs, not extra unit cases                            |
| `test:integration`                   |          Local stack unavailable; not passed | Requires real disposable local Supabase Auth/PostgREST                          |

Focused recovery/foundation/protocol checks passed 136 cases including 30 recovery tests; these overlap `npm test` and are not additional totals. Final frontend CI is **PENDING FINAL VALIDATION**: the `8b11c06` checkpoint failed Auth fixture readiness; local Auth 14/14 and sync 15/15 passed after fixture corrections. That failure is not reported as green. Windows build CI for the same checkpoint passed both matrix jobs. Real integration/hosted/native results must be recorded separately.

## 14. Build and security results

The pre-change production build passed; final production PWA and performance builds passed with the expected large-entry warning and existing Zod annotation warnings. The final public-configured `npm run build` wrapper passed strict TypeScript, production Vite and credential/config validation locally; the full local unit run passed **180/180** at 18:37 Asia/Manila. Both packaged Windows CI variants passed at `8b11c06`. Local Cargo metadata failed for the missing toolchain, as recorded above. **PENDING FINAL VALIDATION — final-push frontend/native CI URL/source.** No release tag or automatic merge is required by this phase.

Production web and Windows wrappers accept only the exact project URL and a public `sb_publishable_` key, remove other `VITE_`/Supabase variables and GitHub-token variables from the child build, and verify emitted frontend content/configuration before artifact upload. Invalid config/secret credential patterns fail the build with a safe message. The checked-in fallback is already-public frontend configuration, not a service-role secret. Plain web development still requires its explicit public configuration and retains the missing-config authentication gate.

Tauri CSP remains limited to the existing IPC origins and this Supabase origin; no wildcard network permission or remote script source was added. RLS/private schema/grants and the existing server migration remain unchanged. Account-generation checks, logout barrier and owner-scoped caches prevent delayed acknowledgements or pulls being applied to another account. Recovery exports exclude Auth/browser credentials; network errors shown/persisted use fixed safe categories rather than bearer headers. The final source and compiled-bundle credential scan passed; its only source match was the intentional `sb_secret_test_private_value` rejection fixture, not an actual credential. Compiled output contained only the intended public configuration fields. **PENDING FINAL VALIDATION — disposable hosted cleanup verification.**

## 15. Pull request

Branch: `codex/phase-6-hardening`; intended base: `main`; title: **Phase 6: Harden Stride for production use**.

**PENDING FINAL VALIDATION — PR link and final reviewed source SHA.** Checkpoint pushes `3d96ad8` and `8b11c06` provided real build artifacts during validation. Reviewed fixes were pushed as `2c864d5`, and the test harness/coverage push `af81874` started final CI. Final docs/evidence must also be committed/pushed, the PR attached to the chat, and its final checks recorded. Do not merge automatically.

## 16. Remaining release blockers and limits

- Complete the upgraded native-package matrix, especially native open/import, notifications, account switching/conflict actions, pull and reconnect. Save As export and the recovery-area opening have passed; the partial checkpoint run cannot stand in for the remaining behaviors.
- Complete the disposable hosted-web smoke on a deployed reviewed build and verify cleanup. Verify public email delivery/confirmation with a reachable test inbox; record any actual SMTP/redirect limitation before proposing settings changes.
- Obtain a green final frontend CI run after the fixture/config fixes and record its exact source. Local 180-unit/build/secret-scan success and corrected Auth/sync runs do not retroactively pass the failed checkpoint.
- Windows OS PWA standalone launch, physical Android/iOS/Safari installation, mobile memory/battery and macOS/Linux packaging remain untested. Unsigned Windows artifacts and browser storage eviction remain existing distribution/storage limitations.
- No pruning protection beyond the current unpruned feed is deployed. Indefinite edit/receipt/recovery growth, slow first large-account pull and the large Auth entry need monitoring and explicit future capacity decisions.

## 17. Recommended Phase 7 scope

Close the outstanding email/native/hosted/physical-PWA release gates and choose an explicit signed distribution/release process before broad onboarding. Monitor actual project database/egress/Auth use and first-sync behavior with representative disposable accounts.

If measured history growth warrants retention, implement the separately approved versioned snapshot/receipt/fence protocol, compatibility rollout and proof suite from the retention proposal before enabling any floor or pruning. Preserve tombstone identities and historical deletion recovery; do not make silent cleanup a performance shortcut. Keep encrypted backups or unrelated product features outside this hardening PR.
