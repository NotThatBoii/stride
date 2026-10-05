# Phase 7 — Stride 1.0 release readiness

**NO-GO FOR v1.0.** Public confirmation delivery and the remaining ordinary installer checks must pass before publication. Branch: `codex/phase-7-release`. No merge, tag, GitHub release, production migration, pruning or agent Auth-setting change occurred.

Executed candidate checks identify source checkpoint `700d805e073b2c2752a3e7de7bb9846cab57fd91`. Later edits contain only documentation and measurements. PR checks identify their own head/merge ref; checkpoint results are not relabeled. [Sanitized live evidence](measurements/phase7-live-validation.json) records observed boundaries without credentials or raw study data.

## A. Changes made

- Align package/lock, Tauri, Cargo/lock and Settings at 1.0.0. Build guards reject version drift and an incorrect tag.
- Prepare installer/portable/checksum files in ordinary and validation non-publishing CI. Verify filenames, x64/product/version, ZIP allowlist and SHA-256 before upload and publication. Publish the exact verified downloads.
- Add Phase 7 Windows/integration push coverage.
- Fix demonstrated keyboard dialog focus/Tab behavior and raw native/invalid-JSON errors. Failed account links show fixed guidance, with failed callback cleanup only after signed-out bootstrap settles. Valid callbacks remain handled by the official SDK.
- Add missing-cache cloud-rehydration acceptance and the [18-case data-loss audit](PHASE_7_DATA_SAFETY.md).
- Finalize user README, portable/release notes, [data transparency](DATA_AND_PRIVACY.md) and [release checklist](RELEASE_CHECKLIST.md).

App identities, IndexedDB schema, Auth/SDK lifecycle, server schema/RLS/RPC, idempotency, explicit conflicts, original allocation days, static-only worker caching and narrow desktop security remain unchanged. No generalized tracker expansion or pruning.

## B. Tests executed

Baseline: merged main `5306cce4554b4d5ca1132905b7f0ce59dfb73b17`, merged PR #8. The supplied hash had a one-character typo. Clean tree and all available local baseline checks passed before branch creation.

| Suite | Local baseline | Final candidate |
| --- | ---: | ---: |
| Unit | 181 | 181 passed |
| SQL contracts | 13 | 13 passed |
| Release configuration/version | 3 | 6 passed |
| Existing browser | 7 | 7 passed |
| Auth browser | 15 | 19 passed |
| Sync browser | 15 | 15 passed |
| Mobile/hardening | 3 | 6 passed |
| Recovery | 3 | 3 passed |
| Stress | 16 | 17 passed |
| Performance | 6 | 6 passed |
| PWA | 5 + 1 optional skip | 5 passed + 1 optional OS-install skip |
| Artifact rejection regression | No standalone gate | 4 passed against actual candidate files; repeated in each Windows matrix job |
| Real Auth/PostgREST TAP | Local runtime unavailable | 9 CI passes, including parent/subtests |
| Real official-SDK integration | Local runtime unavailable | 6 CI passes |

**78 unique browser cases**, including six local performance cases; standard CI executes 72. One justified additional isolated 10k repeat investigated a slow first observation. All prior coverage retained.

Checkpoint builds/scans and all three workflows succeeded:

- [Frontend 37267882749](https://github.com/NotThatBoii/stride/actions/runs/37267882749): unit/config/build, 72 standard browser passes and stated optional skip.
- [Disposable integration 37267882770](https://github.com/NotThatBoii/stride/actions/runs/37267882770): 13 SQL, 9 TAP, 6 SDK; disposable cleanup succeeded.
- [Windows 37267882810](https://github.com/NotThatBoii/stride/actions/runs/37267882810): both ordinary/validation jobs passed tests/build/metadata/SHA and four artifact regression cases each. Publish skipped.

Baseline [frontend 37218953899](https://github.com/NotThatBoii/stride/actions/runs/37218953899) and [Windows 37218953904](https://github.com/NotThatBoii/stride/actions/runs/37218953904) succeeded. Prior Phase 6 [integration 37217741659](https://github.com/NotThatBoii/stride/actions/runs/37217741659) is historical evidence. Local integration was attempted but no disposable Supabase/Docker runtime exists here; no hosted reset.

Initial expanded stress run overlapped source edits: eight passes/nine setup-navigation failures from live module replacement. Failed attempt retained; frozen-source restart passed 17/17 without relaxed assertions. Historical Phase 5 screenshots/Phase 6 measurements and screenshots restored byte-for-byte.

## C. Windows validation

CI-built **ordinary portable 1.0.0** and **installed validation 1.0.0** ran with separate owned WebView2 profiles. Both performed real confirmed-account login, restart persistence and production synchronization. Installed candidate used real Save As/Open dialogs: valid current-workspace export and reviewed matching old-backup import, preserving **five subjects/four sessions exactly without duplicates**. Required import download preserves the staged incoming source; the separate current-workspace export was independently verified.

Installed validation notification observations:

- Enabled one-minute countdown: visible Windows toast at 61.89 seconds, same toast at 67.18 seconds. Title **Focus session complete**, visible body **Open Stride to save your study…**; configured full body **Open Stride to save your study session.** Capture clipped its right edge.
- No duplicate seen in that capture window or subsequent navigation. Bounded visual observation plus persisted notified flag, not an OS notification-history count.
- Disabled one-minute countdown: no toast at 61.02/63.91-second completion captures.
- Re-enabled preference, closed/reopened with completed notified timer: no stale toast, exact retained subjects/sessions/allocations/timer/recovery. Timer was subsequently saved and reached production.

First capture at 74 seconds was too late to establish delivery; timed repeat supplied the actual evidence. No notification permission/CSP expansion. Portable/development visible toast differences are untested; this visual result applies to installed validation.

WebView2 already installed; missing-runtime behavior source/config-backed. **MANUAL REQUIRED:** default uninstall/reinstall. Native automation blocked launching the owned uninstaller and was not bypassed. Tauri NSIS source preserves data by default; **Delete app data** removes app directories. This is not an observed uninstall result. Personal ordinary installation/profile protected.

## D. Web validation

Production [Stride](https://stride-89c.pages.dev) displayed **0.4.0**. Real disposable signup/confirmation, first-subject onboarding, authenticated refresh, logout hiding workspace and login passed. Dashboard/heatmap, History, Settings and Insights were exercised. [Candidate preview](https://codex-phase-7-release.stride-89c.pages.dev/) displayed **1.0.0**, accepted real login/fresh-device onboarding, pulled candidate history, restored on refresh and hid workspace on logout.

Both actual hosted origins had controlling workers and reopened saved authenticated workspaces offline. Cache enumeration contained same-origin static files/manifest/icons/lifecycle marker, no Supabase Auth/RPC responses. A production offline subject produced one pending operation, uploaded after reconnect and appeared in installed candidate. Production Settings reported offline shell ready. Automated tests separately cover safe updates; a genuinely newer hosted deployment/update was not forced.

## E. Email-confirmation validation

Owner witnessed **email received; real link opened production Stride successfully**. Hosted Auth showed confirmed account; machine clients completed login/onboarding/refresh/restart/logout/relogin. No address/password/confirmation URL/token or email body committed.

Read-only Site URL: `https://stride-89c.pages.dev`; no additional redirects. Custom SMTP remained disabled on final read. [Supabase default SMTP](https://supabase.com/docs/guides/auth/auth-smtp) is organization-team-only and not production delivery. Allowed-inbox success does **not** prove public non-team onboarding. Owner chose direct SMTP configuration; agent changed no hosted settings.

**BLOCKER:** real public confirmation delivery remains unverified. Actual reused/expired email-link observation **MANUAL REQUIRED**; owner asked to reopen original link, no result received at this checkpoint. Candidate actual-SDK fixtures separately pass failed query/hash, valid callback/reload and delayed restoration. Production has not received candidate fixes.

Approved change needed: owner-selected SMTP/verified sender, retaining confirmation/Site URL/templates. Credentials stay in Supabase. Failed delivery blocks signup; disable custom SMTP/restore prior values for rollback to team-only delivery. Verify fresh non-team inbox receipt/link/production redirect, confirmed login/restoration/logout/login and used/expired guidance. No paid service created.

## F. PWA/mobile validation

**Android available — MANUAL REQUIRED:** exact [phone checklist](RELEASE_CHECKLIST.md#physical-pwa-checklist), recording phone/OS/browser/install/standalone results. Hardware cannot be controlled here. iPhone Safari physically untested. Desktop/mobile viewport automation is not a phone pass. Phone install/standalone persistence/hosted update remain manual; unavailable hardware is not itself a demonstrated defect.

## G. Upgrade validation

Latest published [v0.4.0](https://github.com/NotThatBoii/stride/releases/tag/v0.4.0), commit `27483639c652156af0dbb7fb48e6c4404649f5dc`, predates Auth/cloud. Official portable ZIP SHA `30aef494337229dd7c18af3ebd56842b97b87d5b7032fdf1cd9f6181da83b1cd`. Actual executable created one subject, saved a 204-second session and exported version 1 JSON via Save As.

**Published ordinary portable → candidate ordinary portable:** same owned profile, confirmed login and explicit reviewed/backup-gated legacy import. Original subject/session/allocation day exact; original anonymous database also retained them. Portable restart retained all session IDs/allocations; only title difference was the expected production reverse edit being pulled.

**Installed authenticated Phase 6 validation → candidate validation installer:** verified NSIS upgrade exit 0, PE product/file version 1.0.0. Reopened offline before reconciliation: exact four subjects, one session/allocation, two pending operations/UUIDs, one conflict, three recovery copies, paused timer, preferences, revisions and cursor. Candidate finished saved timer offline, reconnected/uploaded safely.

Distinct scenarios: published v0.4.0 had no Auth outbox/recovery. **MANUAL REQUIRED:** published ordinary NSIS → ordinary candidate in a clean Windows user/profile, plus default uninstall/reinstall. Existing personal ordinary installation prevented that setup here. No identifier/schema change.

## H. Multi-device acceptance

Real installed Windows and independent production browser, same disposable account. Initial installed Phase 6 subject/session transferred to web and received reverse edit. Offline queue/timer/concurrent edit retained through upgrade. Candidate reconnect exposed both conflict versions; explicit **Keep both** retained each and both appeared in production History with candidate's saved offline timer.

Additional actual 1.0 uploads reached production; production edited candidate-created session and Windows received it; production offline subject reached Windows after reconnect. Final installed state: six subjects, seven sessions/seven allocations, zero pending/unresolved conflicts, six recovery copies. Resolved conflict record retained. No silent version loss observed. SQL-backed automated fixtures remain separate evidence.

## I. Security results

Independent scan: 165 text files, zero actual credentials; seven secret-shaped matches were exact negative fixtures. Only `.env.example` tracked. Production/PWA bundle scans passed without source maps; no runtime console logging found. Evidence excludes emails/account IDs/credentials/tokens/raw records/profile files.

Ordinary ID `com.philippaglinawan.stride` and separate validation identity unchanged. CSP and selected-file/stat/dialog/notification permissions narrow. Auth/server/RPC/RLS/private schema/recovery-export/PWA boundaries unchanged. Ownership authenticated; private schema ungranted; exports selected account study DB only, tested against injected Auth/unapproved metadata.

## J. Performance regression results

Same production-minified loopback Edge 154.0.4258.53, synthetic IndexedDB/mocked Auth and unchanged PGlite SQL. No hosted/native latency claim.

| Sessions | Cached startup | First History | First Insights | Full pull | Push 100 |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 535 ms | 404 ms | 239 ms | 900 ms | 2,994 ms |
| 1,000 | 580 ms | 416 ms | 280 ms | 5,026 ms | 2,976 ms |
| 10,000 | 796 ms | 454 ms | 145 ms | 34,349 ms | 4,022 ms |

Six final unique cases passed. [Browser](measurements/phase7-browser-10000.json)/[sync](measurements/phase7-sync-10000.json) evidence records methods. 10k merged-main startup/History/Insights ~726/392/77 ms; Phase 6 historical ~771/411/267 ms. Major gains retained; small timings vary. Warm History/Insights 67/79 ms; no idle long tasks.

First candidate 10k pull 49,187 ms versus main 39,917 ms. Identical 102 pages/10,021 changes/6,129,213 response bytes/query counts prompted isolated repeat: **34,349 ms**, versus Phase 6 historical 36,427 ms. First observation preserved; no repeatable regression demonstrated. Export 672 ms; reviewed matching import 8,475 ms, zero duplicate writes. Bundle ~729.10 kB raw/~212.99 kB gzip, effectively unchanged.

## K. Free-tier observations

Read-only post-workload aggregate October 5, around 14:22 Asia/Manila: database **11,832,467 bytes**, two Auth users including disposable, six subjects, seven sessions/seven allocations, **17 feed rows/17 receipts**. Earlier 08:16 aggregate 11,816,083 bytes, three feed/receipts; whole DB growth 16,384 bytes. Feed/receipt relation storage observed 49,152/32,768 bytes including indexes/page overhead.

Largest observed tables: private clocks 57,344 bytes; private versions/feed/public sessions 49,152 each; private receipts/public allocations/preferences/subjects 32,768 each. Personal row contents not inspected. Workload-attributable request/egress metrics **unavailable**; not inferred from local payload estimates or pooled totals.

[Current free plan](https://supabase.com/pricing): 500 MB DB, 50,000 MAU, 5 GB egress + 5 GB cached egress, unlimited API requests. SQL database ~2.4% of 500 MB is not billing-meter usage. Small workload does not establish Phase 6's local ~17.5 MB/10k estimate or sustained traffic capacity. Large workloads stayed local/disposable. No pruning; account cleanup is not feed retention.

## L. Known limitations

Unsigned x64/WebView2; eligible saved session needed offline. Active timers/recovery/pending work device-local; storage removal can lose unsynced work. Large first sync honest Syncing status. No physical iOS claim, password-reset screen, encrypted backups, automatic pruning or cross-device timer transfer. Clean ordinary installer/uninstall and physical phone checks remain manual.

## M. Release artifacts

Verified checkpoint Windows run 37267882810:

| Asset | Ordinary SHA-256 | Validation SHA-256 |
| --- | --- | --- |
| Outer CI ZIP | `94dd0d491ea2fc85c9044c01baf7b4babf22000b53f03a6a5788023b10b5dccb` | `6fd75350f67bb6c97818403ab2188290ed59ea1e4da4d7d478c7b39380dd9281` |
| Installer | `fffdc901fd3b4138c9d2c7d0deea06156f4e0bb2b00101e09a003fb5fe45894b` | `304d950b2c443d13630bd2c45f4f7caa9985eec26922ad0826a3bf8e7d92ef1d` |
| Portable ZIP | `cc76e42189246523df67b0116d78d9c68079fb0c5326d482e5b9bb0cdb6d76af` | `8a36779fa912d7b932b49d0f3047386f8da858bd5545224a01e4ea3ff6204be2` |

CI IDs ordinary **11326349813**, validation **11326809081**. Ordinary files: `Stride_1.0.0_x64-setup.exe` 2,033,601 bytes, `Stride_1.0.0_Windows-x64-portable.zip` 2,612,429 bytes, `SHA256SUMS.txt`. x64 PE/product/version/checksums/archive allowlist passed. Portable only executable/README/LICENSE. Validation product/files cannot publish as ordinary. Public endpoint/key and no development secrets/maps/debug files verified. Hashes identify exercised checkpoint files, not a future rebuild. Any merge/tag build must be independently verified. No tag/release created.

## N. Remaining blockers

1. **Public onboarding:** custom SMTP disabled; owner-configured non-team email confirmation must pass. Actual used/expired-link guidance remains a manual email check.
2. **Ordinary Windows distribution:** clean NSIS upgrade/default uninstall-reinstall observations required. Validation installer/source evidence does not substitute for these actual checks.

Android/iPhone install/standalone/update **MANUAL REQUIRED**, exact checklist supplied; no fabricated hardware failure. Optional later: smaller bundles, broader assistive-technology coverage, separately approved retention protocol. No demonstrated data-loss/performance bug.

Cleanup passed: one disposable Auth user deleted after every test client signed out. A read-only query scoped to that user returned zero in all nine categories: Auth user, subjects, sessions, allocations, preferences, versions, clocks, feed and receipts. Native windows/owned browser closed; ignored credential file removed. Personal account/history/profile untouched. Disposable CI cleanup also succeeded.

## O. Recommendation

**NO-GO FOR v1.0.** Review the unmerged PR, complete email/ordinary installer gates and record phone results. Tests/version preparation/validation-product toast success do not waive those observations. Only after an accepted GO and explicit owner approval perform [manual release steps](RELEASE_CHECKLIST.md#after-owner-approves-and-merges).
