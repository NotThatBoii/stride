# Phase 6: release hardening

**Validation spans 2026-10-04 and 2026-10-05, Asia/Manila.** [PR #8](https://github.com/NotThatBoii/stride/pull/8) is open, attached to the chat and unmerged. Application source `91e7225` passed frontend, both real Windows builds and real Supabase integration. Its SHA-verified validation installer was installed and exercised alongside the deployed review. Actual hosted update/logout, offline/reconnect, native reverse-sync/conflict/account switching and the final delayed-logout recovery passed. Both disposable accounts and their study/sync rows were deleted and verified. Real email delivery, visual Windows toast delivery, OS PWA standalone launch and physical mobile installation remain unverified.

The [executed live-validation record](measurements/phase6-live-validation.json) ties the application source, PR test merge, CI runs, installer digest, hosted/native checks and nine zero-row cleanup results together. It contains synthetic account identifiers and no credentials.

Work began from clean `main` at `9f240b6`, after [Phase 5 / PR #7](https://github.com/NotThatBoii/stride/pull/7) was merged. The Phase 2, 3, 4, 4.1 and 5 reports were reviewed. The unchanged baseline passed 143 unit tests, 13 database contract tests, browser suites of 7/14/15 cases, and the production build before creating `codex/phase-6-hardening`. `main` was not edited.

The existing React/Tauri/Dexie/Supabase architecture remains in place. Active timers stay device-local, authentication remains required, conflicting versions are preserved, and account caches remain separate. No hosted migration, Auth-setting change, paid service, Realtime integration or history/receipt pruning is introduced.

## 1. Files modified

The PR diff is authoritative. The principal changes are grouped below; measurement JSON and browser fixtures contain synthetic records only.

- Release configuration: `config/supabase-public.json`, `config/native-validation.json`, `scripts/build-desktop.mjs`, `scripts/build-web.mjs`, `scripts/public-build-config.mjs`, its Node tests, `package.json`, and `.github/workflows/windows.yml` / `check.yml`.
- PWA and branding: `scripts/pwa.mjs` / `.d.mts`, `src/lib/pwa.ts` / `.test.ts`, `src/components/Pwa.tsx`, `src/pwa.css`, `public/manifest.webmanifest`, `_headers`, and the existing Stride SVG plus 180/192/512 px PNG icons. `vite.config.ts`, `index.html`, `src/main.tsx`, `App.tsx`, `AuthenticationScreen.tsx` and `Settings.tsx` integrate the shared app and lifecycle UI.
- Recovery and failure safety: `RecoveryCenter.tsx`, `SyncPanel.tsx`, `recovery.css`, `local-database.ts`, `platform.ts`, `src/lib/sync/{client,conflicts,failures,pull,push,worker,recovery,recovery-export}.ts`, `Sessions.tsx`, `SubjectEditor.tsx` and `Focus.tsx`.
- Targeted rendering/mobile fixes: `App.tsx`, `History.tsx`, `main.tsx` and `src/mobile.css`; the existing React view navigation is retained.
- Auth recovery: `src/auth/AuthProvider.tsx`, `auth-session.ts` and its unit tests, plus `AuthenticationScreen.tsx` and the Auth browser tests, share pending-operation state and guard reopening sign-in during a delayed logout.
- Tests/fixtures: foundation, conflict, protocol and recovery unit tests; `supabase/tests/client-integration.test.ts`; existing Auth, countdown, workspace and multi-device fixtures/tests; `tests/auth-mock.ts` and `sync-fixture.ts`; new hardening, recovery, stress, production PWA and performance browser suites, their Playwright configs and runner scripts.
- Evidence/docs: this report, README, [data-safety audit](PHASE_6_DATA_SAFETY.md), [PWA lifecycle](PHASE_6_PWA.md), [retention proposal](PHASE_6_RETENTION.md), [performance/usage report](PHASE_6_PERFORMANCE.md), [stress report](PHASE_6_STRESS.md), `docs/measurements/phase6-*.json`, and six recovery/sync/logout screenshots.

## 2. Windows packaged validation

**CI tested, source `91e72259f0e0f74732b8c7cd92b22127c0fa0a6c`:** both ordinary release and isolated validation installers/executables built successfully in [Windows run 37216358307](https://github.com/NotThatBoii/stride/actions/runs/37216358307). Both jobs passed 181 unit tests and public configuration/credential validation, then ran actual Tauri/Rust/NSIS builds. Release publication was skipped.

**Packaged Windows tested:** the actual validation package launched on this Windows machine, signed in, pushed study data, worked offline, preserved a paused timer, and restored its account/timer/cache after closing and reopening. The validation package uses the separate `com.philippaglinawan.stride.validation` identity and disposable test state. It does not replace the user's ordinary Stride installation/profile. File, timer, conflict and account-switch behavior was exercised across the `3d96ad8`, `8b11c06` and SHA-verified `af81874` validation packages. The final `91e7225` package separately passed installation/launch/cache restoration, delayed-logout recovery, real SDK sign-in with restored history and normal settled sign-out.

The native Settings recovery UI opened with zero issue counts and no error, and an actual native **Save As** JSON export succeeded. The written file validated as `stride` version 1 with one subject, zero completed sessions and the paused running-timer checkpoint.

An offline stopwatch session of **2 minutes 26 seconds** completed locally with one queued change. Reconnection drained that queue and the native UI reported **Synced, zero pending**. The real **Import JSON** open picker read the saved backup and opened review with import disabled. **Download backup** then opened native saving and wrote a second safety JSON; only after success did import enable. Completing the additive import preserved the existing completed history, deduplicated its subject and restored the backed-up timer paused. Preserved copies were visible in Settings. These are actual packaged file-dialog/import actions, not browser download mocks.

A real installer upgrade/restart retained the account cache and paused timer. A hosted subject edit pulled into native; competing native-offline and independent review-web edits produced one conflict. Both versions were inspected, **Keep both** was chosen in native, two subjects/recovery copies remained, and the hosted peer received both. A subject and the **40-second session shown in the hosted History UI** also pulled into the native app.

Switching from the first disposable account to the second opened an isolated empty workspace without the first account's history/timer. Normal settled sign-out and sign-back-in worked without reloading, and a reload recovery case was also exercised. Native notification preferences were saved and a real one-minute countdown completed/paused, but the Windows toast was **not visually observed**; notification delivery is not claimed passed. These native results refer to the installed `af81874` package, not the subsequently changed Auth guard.

The latest `91e7225` validation artifact (`11308269028`) was downloaded as a **4,638,642-byte ZIP** and checked against SHA-256 `585bed24c4c62b4df5eefe63e6b507aba65df2fde24c9b3e108743e51155f282`. Its **2,030,984-byte installer** completed an actual silent upgrade with exit 0; launch restored the account cache. Its entry `index-C2PynC4Z.js` matched the hosted build. A controlled delay held the original real logout request for ten seconds using browser request interception. Email remained disabled and account data hidden while **Finishing sign-out** displayed; **Reopen sign in** then appeared. Clicking it reloaded the native renderer into the Auth gate with Email enabled and account data still hidden. Real SDK sign-in restored all three subjects, including the offline-created subject, and the 40-second session. Normal final sign-out settled to the enabled gate with history hidden. No response fixture was substituted for this live request. [Native logout recovery](screenshots/phase6-native-logout-recovery.png).

The local `desktop:build` attempt failed because Cargo/Rust and Visual Studio C++ Build Tools/Windows SDK are absent; WebView2 is installed. The system drive had about 9.3 GB free when assessed. Installing the full development toolchain was not a reasonable low-impact prerequisite to testing an already-built CI artifact. CI supplied the real compiler/toolchain instead.

| Required packaged behavior                                             | Recorded status                                                                                                   |
| ---------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Launch, sign-in, account workspace, push                               | Passed on actual validation packages                                                                              |
| Offline study/timer state, close/restart persistence, restored account | Passed on actual validation packages                                                                              |
| Offline completed session, reconnect retry, sync-status UI             | Passed; 2m26s completed, pending 1→0, Synced after reconnect                                                      |
| Pull/reverse sync                                                      | Passed; hosted edit and hosted subject/40-second session appeared in native; native Keep both reached hosted peer |
| Native JSON Save As export                                             | Passed; written version-1 JSON validated                                                                          |
| Native open dialog and backup-gated import                             | Passed; disabled before safety save, additive import preserved history and restored paused timer                  |
| Native countdown/notification preference                               | Preference saved and one-minute countdown completed/paused; visual toast delivery unverified                      |
| Recovery UI                                                            | Settings opened without error; preserved import copies visible                                                    |
| Sign-out/account switch                                                | Passed settled sign-out/relogin without reload; second account isolated; reload recovery exercised                |
| Conflict actions                                                       | Passed actual native inspection and Keep both; both copies/preserved recovery reached hosted peer                 |
| `af81874` installer upgrade/restart                                    | SHA verified; actual close/upgrade/restart preserved account cache and paused timer                               |
| Latest `91e7225` validation installer                                  | SHA verified; silent upgrade exit 0; cache restored; live delayed-logout recovery and real SDK re-login passed    |

Packaged coverage is limited to the explicit rows above. Browser platform mocks are not evidence of native dialogs or notifications. macOS/Linux packages and physical iOS/Android behavior are untested.

## 3. PWA implementation

**Implemented and locally tested:** the hosted build contains an existing-brand manifest, stable root identity, standalone display mode, theme/background metadata and PNG icons. It reuses the React app without a new runtime dependency. Settings exposes browser installation when an actual install prompt is available, and otherwise gives browser-menu/Add to Home Screen guidance.

The production PWA suite passed **5 tests**, with **1 optional OS-install experiment skipped**. A disposable persistent Edge profile had no installability errors. Experimental install commands acknowledged success, but standalone launch was not exposed as a controllable app; these acknowledgements are not proof of working OS installation. Headed cleanup of that exact disposable profile completed uninstall and returned an unknown app identity. No user browser profile was touched.

The deployed review passed actual service-worker-controlled online reload, offline reload and another offline tab restoring the account. An offline subject queued one change; reconnect and Retry reached Synced with zero pending, and the installed native peer pulled that subject. Actual Windows OS PWA standalone launch, physical Android Add to Home Screen and iOS/Safari installation remain unverified. See [PWA implementation and limits](PHASE_6_PWA.md).

## 4. Offline app shell

The build generates a versioned exact allowlist of static HTML, all emitted route JS/CSS and known branding assets. The worker caches no Auth, Supabase/RPC/API response, arbitrary JSON, query-bearing request or private study data. Account history, outbox, conflicts and timers stay in account-scoped IndexedDB. Development and native Tauri builds do not register the web worker.

Executed production-browser tests verify unsigned offline shell reopen; restored account/cache/outbox/paused timer; offline timer save; successful reconnect sync; and a durable offline sign-out barrier. An initial login, email callback or expired session requiring refresh still needs a connection.

Actual Cloudflare review testing found a host-specific defect: `/index.html` redirects to `/` with HTTP 308, and precaching its followed redirect response made service-worker-controlled navigation fail with `ERR_FAILED`. Bypassing the worker recovered navigation and inspecting its cached response confirmed `redirected: true`. Fix `452c8f0` reconstructs only the allowlisted static response with its original bytes/status/headers, clearing the redirect flag before navigation caching. A production regression server now reproduces that canonical 308. The post-fix suite passed **5 PWA tests plus one explicit optional skip**, including online/offline reload and opening another window. The actual deployed review then passed online and offline reload with worker control and bypass disabled, plus an offline new tab restoring the account. Creating a subject offline showed one queued change; reconnect and Retry reached **Synced, zero pending**, and the actual installed native peer pulled it. Each of the current and previous static caches held 19 entries, with zero Auth/RPC/Supabase/export/recovery URLs; the new cached index had `redirected: false`. [Hosted synced view](screenshots/phase6-hosted-synced.png), [native peer synced view](screenshots/phase6-native-synced.png).

Updates precache completely and wait for explicit acceptance. Reload is blocked while a local write or unsaved timer exists; other open Stride windows must close first. Activation retains one prior static build to tolerate chunk races and preserves IndexedDB/pending operations. A failed initial worker registration recovers through **Check for updates**. Storage eviction/clearing can still remove local data; the shell does not replace downloaded backups.

On the real review deployment, accepting **Reload to update** applied the `91e7225` build (`index-C2PynC4Z.js`) while retaining all three subjects and the 40-second session under worker control. Settled hosted sign-out and sign-back-in then retained the offline-created subject and saved session.

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

Auth defers the workspace app; non-Home views load on demand. Initial executed JS decreases about 8.3%, while added recovery/PWA behavior increases the total about 3.7%. PWA preparation still precaches all route chunks. Measured entry CSS is 41,755 bytes plus 1,135 bytes of Settings CSS; the worker is 3,990 bytes. The entry still triggers Vite's 500 KB warning. Module attribution identifies React DOM, the official Supabase SDK and validation as large contributors; no security validation or maintained SDK was removed for a marginal size gain. These saved artifact measurements are a Phase 6 optimization checkpoint with public test configuration; subsequent reviewed guards and exact release-key embedding change a few bytes. The final local build reported its entry at **728.32 kB / 212.70 kB gzip**. The saved table is not presented as byte-for-byte `af81874` packaged output.

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

Production remains [stride-89c.pages.dev](https://stride-89c.pages.dev), with the intended Supabase project. The Phase 6 smoke used [the branch review deployment](https://codex-phase-6-hardening.stride-89c.pages.dev/), administratively confirmed disposable accounts, an independently signed-in review-web context and the actual isolated Windows validation package. Public email-confirmed signup remains a separate outstanding step.

`scripts/build-web.mjs` fixes the review deployment's missing-public-configuration gate by validating the intended public fallback, running strict TypeScript/Vite with the same public-only build environment and checking the emitted frontend. Its local production build passed, the review displayed configured sign-in and accepted the disposable account, and both latest Windows build wrappers passed their public-only checks. Development missing-config tests continue to use the unchanged gate.

| Actual hosted/native smoke behavior                             | Recorded result                                                                                                                                                 |
| --------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Configured review sign-in, subject/session create and peer pull | Passed; the hosted History UI showed a 40-second saved session, which appeared in native                                                                        |
| Reverse edit and competing offline edits                        | Passed; a hosted edit pulled into native, and native Keep both preserved both versions and reached the hosted peer                                              |
| Account isolation and settled native logout/relogin             | Passed; second account had no first-account history/timer; normal logout/relogin required no reload                                                             |
| Deployed PWA online/offline reload and offline new tab          | Passed with actual worker control and bypass disabled after the redirect fix                                                                                    |
| Offline subject create, reconnect and peer pull                 | Passed; queued 1→Synced 0, followed by the actual native peer pulling the new subject                                                                           |
| Hosted update and settled logout/relogin                        | Passed on deployed `91e7225`; explicit update and logout/relogin preserved three subjects, offline edit and the 40-second session                               |
| Live delayed-logout guard                                       | Passed on hosted and installed native `91e7225`; original logout request held ten seconds, gate reopened safely, real SDK re-login restored the account history |
| Latest native Auth guard                                        | Passed actual installer/launch/cache restore, delayed-logout recovery, real re-login and normal final sign-out                                                  |
| Disposable-account cleanup                                      | Passed; both exact test Auth users deleted and all nine scoped Auth/study/sync checks returned zero remaining rows                                              |

The latest Auth fix shares sign-in/signup/logout pending state between the provider and form, preventing a second Auth action while logout settles. After ten seconds, **Reopen sign in** is available only after the durable signed-out marker is confirmed. It reloads into the guarded Auth gate; it does not bypass the logout barrier or delete study/recovery data. The focused **18 Auth unit tests** and **15 Auth browser cases** passed locally and final frontend CI. Actual hosted and packaged-native checks held each original logout request for ten seconds through controlled browser interception, with no replacement response fixture. Both showed disabled Email, hidden account data and **Finishing sign-out**, then offered recovery. The recovery click reloaded to an enabled, unsigned gate with history hidden; real SDK sign-in restored three subjects including the offline-created subject and the 40-second session. Final normal sign-out settled successfully on both. The controlled delay verifies the recovery path, not a naturally slow server response. [Hosted logout recovery](screenshots/phase6-hosted-logout-recovery.png), [native logout recovery](screenshots/phase6-native-logout-recovery.png).

**Cleanup verified:** after all owned contexts signed out, the two exact disposable Auth users (`58b49b3d-098e-4536-848f-0fcbaef4ec8e` and `7b3bbf35-3289-4649-9093-bee850a95e2b`) were deleted through Supabase Users. A read-only query scoped only to these UUIDs returned zero remaining rows for each of nine categories: Auth users, subjects, sessions, allocations, preferences, versions, clocks, changes and operations. This verifies cascade cleanup of the test study/sync data. No personal data was queried or mutated, and no SQL snippet or migration was saved. The dashboard's stale total counter was not used as cleanup evidence.

**Awaiting a reachable disposable inbox:** public signup, receipt of a real confirmation email, confirmation-link redirect, post-confirmation login and absence of redirect loops remain unverified. Administrative confirmation or mocked signup cannot establish email delivery. No personal account is used for destructive testing, and no Supabase Auth/redirect/SMTP setting is changed without a separately explained approval.

## 13. Exact automated test counts

Counts below describe completed local runs; they are not summed with earlier checkpoint runs or overlapping focused unit subsets.

| Suite                                |                        Local executed result | Scope                                                                                                        |
| ------------------------------------ | -------------------------------------------: | ------------------------------------------------------------------------------------------------------------ |
| `npm test`                           |                                   181 passed | Ten files; includes 18 Auth tests and four PWA boundary tests                                                |
| `test:db`                            |                                    13 passed | Unchanged SQL/RLS/RPC contracts in PGlite                                                                    |
| `test:release-config`                |                                     3 passed | Public-only config and embedded-credential rejection                                                         |
| `test:e2e`                           |                                     7 passed | Existing browser workflows/persistence                                                                       |
| `test:e2e:auth`                      |                                    15 passed | Auth gate, restore, sign-out, isolation and delayed-logout recovery                                          |
| `test:e2e:sync`                      |                                    15 passed | Independent contexts with unchanged SQL                                                                      |
| `test:e2e:hardening`                 |                                     3 passed | 360/390/430 px flows                                                                                         |
| `test:e2e:recovery`                  |                                     3 passed | Export gates, repair and deleted-session restoration                                                         |
| `test:e2e:pwa`                       | 5 passed, 1 optional OS-install test skipped | Real production worker/cache/update lifecycle                                                                |
| `test:e2e:performance`               |                                     6 passed | Three workload sizes and three full client/backup round trips                                                |
| `test:e2e:stress`                    |                                    16 passed | Multi-device/network/timezone/backup stress                                                                  |
| SQL size/growth and bundle harnesses |                        Executed successfully | Measurement/assertion programs, not extra unit cases                                                         |
| `test:integration`                   |      Local stack unavailable; real CI passed | Disposable runner: 13 SQL contracts, 9 raw TAP passes (parent plus eight scenarios), 6 SDK tests; zero skips |

Focused recovery/foundation/protocol checks passed 136 cases including 30 recovery tests; these overlap `npm test` and are not additional totals. The latest full local unit run passed **181/181 in ten files, 1.94 seconds**, at 00:17 on October 5, Asia/Manila. Final [frontend run 37216358334](https://github.com/NotThatBoii/stride/actions/runs/37216358334) confirms **181 unit, 3 release-config, 7 existing browser, 15 Auth, 15 sync, 3 mobile, 3 recovery, 16 stress and 5 PWA passes plus one optional PWA skip**, with strict production build/config verification. Both latest Windows jobs also passed **181 units and 3 config tests each** before building real packages. Six performance cases remain separate executed local results.

For application source `91e72259f0e0f74732b8c7cd92b22127c0fa0a6c`, frontend passed [run 37216358334](https://github.com/NotThatBoii/stride/actions/runs/37216358334), both Windows jobs passed [run 37216358307](https://github.com/NotThatBoii/stride/actions/runs/37216358307), and real disposable Supabase Auth/PostgREST passed [integration run 37216358320](https://github.com/NotThatBoii/stride/actions/runs/37216358320): **13 SQL contract tests, 9 raw TAP passes (one parent plus eight scenarios) and 6 SDK tests**, with zero skips. PR checks used test merge `c5b3460138d0f73b6927a35498eefa2f8f4f14e7` against base `9f240b6`. These are actual completed green runs; hosted/native/email results remain separately scoped.

## 14. Build and security results

The pre-change production build passed; production PWA and performance builds passed with the expected large-entry warning and existing Zod annotation warnings. The latest public-configured `npm run build` wrapper passed strict TypeScript, production Vite and emitted credential/config validation locally and final frontend CI; the full local unit run passed **181/181**. Both actual `91e7225` Windows builds passed their unit/public-config checks and emitted installers/executables; publishing was skipped. The latest local production entry is **728.32 kB / 212.70 kB gzip**, while the saved controlled optimization checkpoint remains 727,332 / 212,330 bytes. Local Cargo metadata failed for the missing toolchain, as recorded above. Final application frontend, Windows and real integration CI are green. No release tag or automatic merge is required by this phase.

Production web and Windows wrappers accept only the exact project URL and a public `sb_publishable_` key, remove other `VITE_`/Supabase variables and GitHub-token variables from the child build, and verify emitted frontend content/configuration before artifact upload. Invalid config/secret credential patterns fail the build with a safe message. The checked-in fallback is already-public frontend configuration, not a service-role secret. Plain web development still requires its explicit public configuration and retains the missing-config authentication gate.

Tauri CSP remains limited to the existing IPC origins and this Supabase origin; no wildcard network permission or remote script source was added. RLS/private schema/grants and the existing server migration remain unchanged. Account-generation checks, logout barrier and owner-scoped caches prevent delayed acknowledgements or pulls being applied to another account. Recovery exports exclude Auth/browser credentials; network errors shown/persisted use fixed safe categories rather than bearer headers. The earlier source credential scan covered 101 text files; the latest scan covered 99 changed tracked text files plus new documentation. Both passed with matches limited to intentional negative fixtures (`sb_secret_example`, `sb_secret_test_private_value`, `sb_secret_invalid`) and their documentation, with no actual private credential found. The latest compiled-bundle scan also passed and contained only the intended public configuration fields. Both disposable hosted accounts and their study/sync rows were cleanup-verified as described above.

## 15. Pull request

Branch: `codex/phase-6-hardening`; intended base: `main`; title: **Phase 6: Harden Stride for production use**.

[PR #8](https://github.com/NotThatBoii/stride/pull/8) is open, attached to this chat and unmerged. Application source `91e72259f0e0f74732b8c7cd92b22127c0fa0a6c` includes the deployed PWA redirect and Auth guard fixes and is pushed to the branch. Frontend, both Windows builds and real Supabase integration passed. The SHA-verified validation artifact from this source is installed and passed the final live Auth recovery checks; disposable hosted cleanup is verified. Subsequent documentation/evidence commits do not change that tested application source. Do not merge automatically; wait for the user's review.

## 16. Remaining release blockers and limits

- Visually verify Windows toast delivery. Permission/preference and real countdown completion passed, as did native account switching, settled logout/relogin, conflict Keep both and reverse sync; those passes do not establish actual toast delivery.
- Verify public email delivery/confirmation with a reachable test inbox; record any actual SMTP/redirect limitation before proposing settings changes.
- Windows OS PWA standalone launch, physical Android/iOS/Safari installation, mobile memory/battery and macOS/Linux packaging remain untested. Unsigned Windows artifacts and browser storage eviction remain existing distribution/storage limitations.
- No pruning protection beyond the current unpruned feed is deployed. Indefinite edit/receipt/recovery growth, slow first large-account pull and the large Auth entry need monitoring and explicit future capacity decisions.

## 17. Recommended Phase 7 scope

Verify real email confirmation, visible Windows notification delivery and physical PWA/platform behavior, then choose an explicit signed distribution/release process before broad onboarding. Monitor actual project database/egress/Auth use and first-sync behavior with representative disposable accounts.

If measured history growth warrants retention, implement the separately approved versioned snapshot/receipt/fence protocol, compatibility rollout and proof suite from the retention proposal before enabling any floor or pruning. Preserve tombstone identities and historical deletion recovery; do not make silent cleanup a performance shortcut. Keep encrypted backups or unrelated product features outside this hardening PR.
