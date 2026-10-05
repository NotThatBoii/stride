# Phase 7 — Stride 1.0 release readiness

**Candidate validation in progress; publication is not approved.** This report separates executed checks from remaining manual gates. The branch is `codex/phase-7-release`; no merge, tag, GitHub release, production migration, or agent Auth-setting change has occurred.

## A. Changes made

- Prepare version 1.0.0 across package/lock, Tauri, and Cargo/lock. Settings derives the package version. Builds reject drift; tag builds reject the wrong tag.
- Package ordinary and validation Windows installer/portable/checksum downloads in non-publishing CI. Verify filenames, x64 executable/product/version, ZIP allowlist, and SHA-256 before upload and again before tag publication. Publication consumes those exact files.
- Add Phase 7 Windows/integration push coverage so candidate packages and real disposable integration can be checked before release approval.
- Fix demonstrated keyboard focus/Tab behavior and raw native/invalid-JSON errors. Failed account links now show fixed safe guidance; failed callback keys are cleaned only after signed-out bootstrap settles, while valid callbacks remain owned by the official SDK.
- Add a cloud-rehydration acceptance case and the [18-case data-loss audit](PHASE_7_DATA_SAFETY.md).
- Update ordinary-user README, portable instructions and release notes; add [data transparency](DATA_AND_PRIVACY.md) and the [reusable release checklist](RELEASE_CHECKLIST.md).

App identities, IndexedDB schema, Auth/SDK lifecycle, server schema/RLS/RPC, idempotency, conflict preservation, allocation days, static-only PWA caching, and narrow desktop security remain unchanged. No generalized activity/habit expansion or pruning is implemented.

## B. Tests executed

Baseline source: merged main `5306cce4554b4d5ca1132905b7f0ce59dfb73b17`, confirmed as PR #8. The supplied merge hash had a one-character typo. Tree was clean and all locally available baseline checks passed before the branch was created.

| Suite | Merged-main local baseline | Candidate final status |
| --- | ---: | --- |
| Unit | 181 | 181 passed after the final UI changes |
| SQL contracts | 13 | 13 passed |
| Public release configuration/version | 3 | 6 passed |
| Existing browser | 7 | 7 passed |
| Auth browser | 15 | 19 passed, retaining the original 15 |
| Sync browser | 15 | 15 passed |
| Mobile/hardening | 3 | 6 passed |
| Recovery | 3 | 3 passed |
| Stress | 16 | 17 passed |
| Performance | 6 | Final six pending |
| PWA | 5 + 1 optional skip | 5 passed + 1 optional OS-install skip |
| Windows artifact rejection cases | Not previously a standalone gate | 4 passed against real Phase 6 validation binaries; candidate binaries pending |

Production web build and configured bundle scan passed. Root and PWA fixture builds generated no source maps. Local Supabase integration was attempted and unavailable because this computer has no running disposable stack; no hosted reset was attempted. Candidate CI Auth/PostgREST/SDK and Windows results will be recorded when the source checkpoint finishes.

Merged-main CI baseline: [frontend 37218953899](https://github.com/NotThatBoii/stride/actions/runs/37218953899), [Windows 37218953904](https://github.com/NotThatBoii/stride/actions/runs/37218953904), both successful. Real integration's last existing Phase 6 PR result [37217741659](https://github.com/NotThatBoii/stride/actions/runs/37217741659) passed 13 SQL, 9 TAP (including parent/subtests), and 6 SDK checks; that prior PR run is not claimed as new merged-main/candidate execution.

An initial expanded stress run was disrupted by development hot reload while separate approved source edits completed. Its failed attempt is retained; a fresh stable-source run passed 17/17 without relaxing assertions. Historical Phase 5 screenshots and Phase 6 measurements/recovery screenshots are restored byte-for-byte after generated test output is separately retained.

## C. Windows validation

Candidate CI packages and actual installed/portable smoke tests are pending. The existing Phase 6 validation installation is being exercised using a fresh owned WebView2 profile; ordinary personal Stride folders are not used. WebView2 exists on this machine. Missing-runtime behavior is configuration/source-backed, not a removal test on this computer.

Actual visible toast delivery, duplicates/disabled/restart checks and default uninstall/reinstall remain required until individually observed. Do not substitute a successful notification API call for a visible Windows toast.

## D. Web validation

Production `https://stride-89c.pages.dev` accepted a real disposable signup. The confirmed account signed in, completed onboarding, created its first subject, and restored its authenticated workspace after refresh. Production still reports 0.4.0 at this checkpoint; candidate preview and additional smoke results are pending.

The production PWA Settings screen reports its offline shell ready. Automated candidate worker tests passed static-only caching, offline restore/reconnect, safe updates, native exclusion, and registration recovery. Actual production offline/cache inspection is tracked separately from these fixtures.

## E. Email-confirmation validation

The owner supplied a disposable inbox and directly witnessed **email received; real link opened production Stride successfully**. The isolated machine client subsequently signed into that confirmed account, completed onboarding, restored it after refresh, signed out with the workspace hidden, and signed back in successfully. No confirmation token, credential, inbox address, or email body is committed.

Read-only hosted observations: Site URL is exactly `https://stride-89c.pages.dev`; there are no additional redirect URLs; custom SMTP remains disabled on the subsequent read. Supabase's [default SMTP documentation](https://supabase.com/docs/guides/auth/auth-smtp) restricts mail to organization-team addresses and states it is not production delivery. A successful allowed-inbox confirmation does not establish public onboarding. The owner chose to configure SMTP directly; the agent has not changed settings. Public non-team delivery and actual used-link checks remain pending; callback failure/valid-link behavior separately passes actual-SDK browser fixtures.

If settings are needed: enable an owner-selected SMTP provider and verified sender while retaining confirmation, current Site URL and templates. Credentials stay in Supabase. Failure can block delivery; disable custom SMTP/restore prior values to roll back (returning to team-only delivery). Verify a fresh non-team disposable signup, receipt/link/redirect, confirmed login/restart/logout/login and used/expired-link behavior. No paid service or provider account is created by this task.

## F. PWA/mobile validation

Android is available to the owner; physical hardware cannot be controlled from this environment. **MANUAL REQUIRED:** execute the exact [phone checklist](RELEASE_CHECKLIST.md#physical-pwa-checklist) and record Android/browser/install/standalone details. iPhone Safari is not physically validated. Desktop Edge/mobile viewport automation is not labeled a physical-phone pass.

## G. Upgrade validation

Latest published release is [v0.4.0](https://github.com/NotThatBoii/stride/releases/tag/v0.4.0), commit `27483639c652156af0dbb7fb48e6c4404649f5dc`, predating Auth and cloud sync. Its official portable ZIP was downloaded and SHA-256 verified (`30aef494337229dd7c18af3ebd56842b97b87d5b7032fdf1cd9f6181da83b1cd`). Actual published executable created a synthetic subject, saved one 204-second session, and exported a valid version 1 backup with its one original allocation through native Save As.

Published anonymous history → candidate explicit legacy import and authenticated Phase 6 cache → candidate queue/recovery upgrade are distinct scenarios. Both are in progress. Published v0.4.0 could not have Auth outbox/recovery state; no such upgrade claim is fabricated. Ordinary existing install/profile folders were detected and are protected from test installation/uninstall.

## H. Multi-device acceptance

An installed Phase 6 test client signed into the same confirmed production account and received the web-created subject. It created another subject and saved a completed session, both visibly received by production History. Final candidate installed Windows + production browser reverse-edit/offline/reconnect/conflict resolution sequence is pending. Automated SQL-backed independent-client sync/stress checks have passed; they are not substitutes for this real hosted acceptance.

## I. Security results

Independent scan covered 165 text files, with zero actual credential findings; seven secret-shaped matches were exact documented negative fixtures. Only `.env.example` is tracked. Configured production/PWA bundles passed public-configuration/credential-pattern checks; no generated source maps. No runtime console logging was found.

Ordinary identity remains `com.philippaglinawan.stride`; the existing separate validation identity is unchanged. CSP and selected-file/stat/dialog/notification capabilities remain narrow. Auth/SDK/server/RPC/RLS/private-schema/recovery-export/PWA code boundaries are unchanged. Server ownership uses authenticated identity; private schema remains ungranted. Export tests exclude injected Auth/unapproved metadata and exports read only the selected account's study database.

## J. Performance regression results

All six unchanged merged-main benchmark cases passed before implementation. 10,000-session cached startup was approximately 726 ms. Final 100/1,000/10,000 production-loopback rerun and comparison are pending. Benchmarks use synthetic isolated IndexedDB, mocked Auth and unchanged SQL in PGlite; they do not claim hosted or native latency.

Configured final candidate entry bundle after callback guidance: approximately 729.10 kB raw / 212.99 kB gzip, effectively unchanged from Phase 6's roughly 728 kB / 213 kB. Bundle-size warnings are an optional future optimization, not evidence of a release blocker.

## K. Free-tier observations

Current hosted aggregate size/feed/receipt/Auth/request/egress observations are pending. Large workloads stay disposable/local; no test load is added to personal history. Phase 6's local growth estimates remain estimates, not hosted usage. No retention/pruning/schema change is authorized or implemented.

## L. Known limitations

Unsigned x64 Windows packages; WebView2 required. Eligible saved Auth session needed offline. Active timers/recovery copies/unsynced work remain device-local. Storage removal can cause expected local-only loss. Large first syncs take time but remain visibly Syncing and navigable. Phone behavior is MANUAL REQUIRED; no iOS claim. No password-reset screen, encrypted backups, automatic pruning, or device-transfer of active timers.

## M. Release artifacts

Expected candidate ordinary assets: `Stride_1.0.0_x64-setup.exe`, `Stride_1.0.0_Windows-x64-portable.zip`, `SHA256SUMS.txt`. Candidate CI digest/metadata/archive verification and live validation will be added here. Ordinary publication cannot accept validation-named/product assets and never repackages after candidate verification. No tag/release has been created.

## N. Remaining blockers

Concrete gate at this checkpoint: hosted SMTP remains team-only, so ordinary public signup has not passed. Required candidate Windows/upgrade/visible-toast and real multi-client acceptance are still unfinished validation gates; their exact final disposition must be recorded before a stable release. Android/iOS hardware absence is an explicit manual checklist, not an invented failure or automated pass.

Optional later work: bundle reduction, broader browser/assistive-technology coverage and separately approved retention protocol. These do not expand Phase 7.

## O. Recommendation

**NO-GO FOR v1.0 at this checkpoint.** Complete the concrete gates above, then update this one recommendation from observed results. Version preparation and passing automated suites do not waive public onboarding or native distribution checks. Review the unmerged PR; do not tag/publish until the owner approves and the release checklist is complete.
