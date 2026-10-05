# Release checklist

Use this for each release. Record the source/merge commit, environment, exact counts, and evidence; distinguish automated checks from manual observations. A previous release's result is not a candidate result.

## Before approval

- [ ] Fetch main, confirm expected previous merge, and start with a clean tree.
- [ ] Run the existing baseline; diagnose failures before implementation.
- [ ] Review the full diff for data safety, account isolation, narrow permissions/CSP, and unchanged server-derived ownership.
- [ ] Align package/lock, Tauri, Cargo/lock, Settings display, and installer versions. Run the version/tag guard.
- [ ] Run `npm test`, `npm run test:release-config`, `npm run test:db`, and `npm run build`.
- [ ] Run complete `test:e2e`, `test:e2e:auth`, `test:e2e:sync`, `test:e2e:hardening`, `test:e2e:recovery`, `test:e2e:stress`, `test:e2e:pwa`, and `test:e2e:performance` scripts. Explain skips and retained/additional coverage.
- [ ] Run `npm run test:integration` against disposable local Supabase, or record the candidate's real disposable CI Auth/PostgREST and SDK results. Never point the local reset harness at hosted production.
- [ ] Confirm frontend, disposable integration, and both Windows matrix jobs pass for the reviewed source.
- [ ] Download candidate installer, portable ZIP, and checksums from CI; verify SHA-256, architecture, filenames, version, included docs/license, public endpoint/config, and package launch.
- [ ] Run source and compiled-bundle secret scans. Only intended public Supabase configuration may ship; no tokens, credentials, private keys, `.env` files, debug output, or private source maps.
- [ ] Test isolated installed and portable clients: login, persistence/restart, completed history sync, native backup/import, notification, and default uninstall/reinstall data behavior.
- [ ] Test latest published version → candidate with retained history; distinguish anonymous legacy import from an authenticated cache upgrade. Preserve app identity and original recorded days.
- [ ] Complete real disposable-inbox signup, received-mail link, correct production redirect, login, refresh/restart, logout/login, and used/expired-link behavior. Administrative confirmation is not equivalent.
- [ ] Test production web and candidate preview, worker-controlled online/offline reload, queue/reconnect, safe update with unsaved activity, and no private worker cache entries.
- [ ] Run Windows + web same-account acceptance: subject/session transfer, reverse edit, offline completion/reconnect, deliberate conflict, and explicit resolution preserving both versions.
- [ ] Check keyboard/focus/dialog/Escape, labels/errors, light/dark, narrow layout, and practical touch targets.
- [ ] Review first sync with a large account: honest Syncing status and usable navigation. Compare performance with the same methodology; investigate large regressions.
- [ ] Observe hosted database/feed/receipt/request/egress/Auth usage using disposable workloads only. Record unavailable measurements; do not infer per-test traffic from aggregate dashboard totals.
- [ ] State migration status. Any production schema or Auth/SMTP/redirect/template change requires separate owner approval. Retention remains deferred.
- [ ] Update ordinary-user README, portable instructions, notes, data behavior, and the release report. Separate blockers from optional work and state one GO/NO-GO.
- [ ] Remove disposable test users/data and close owned test clients. Confirm personal history and profiles were untouched.
- [ ] Open an unmerged PR with exact source, tests, manual limits, artifact evidence, and decision. No release/tag before explicit approval.

## Physical PWA checklist

**Android available — MANUAL REQUIRED.** Use a disposable account and the production app after the approved deployment. Record phone model, Android version, Chrome/Edge version, date, and actual install method. Repeat on iPhone Safari only if available; never label desktop emulation as a phone pass.

1. Visit `https://stride-89c.pages.dev`, complete email confirmation, and sign in. Record the app version and complete onboarding.
2. Install from the browser menu / Add to Home screen. Launch the home-screen icon. Check the Stride name/icon, standalone window, readable light/dark layouts, keyboard, and narrow/touch controls.
3. Create a subject, record/save a completed session, and confirm dashboard, History, heatmap, and Insights. Wait for sync; verify the same history on an independent client.
4. Close the app fully and reopen its icon. Confirm IndexedDB history and the eligible account session restore. Pause a timer and repeat close/reopen; it remains device-local.
5. Wait for **offline shell ready** in Settings. Turn on airplane mode, close/reopen the standalone app, and verify the shell/local workspace. Complete a session offline; note the pending status.
6. Reconnect. Wait for pending changes to clear and confirm the session on the other client. Test a deliberate conflict and **Keep both** without losing either version.
7. After a genuinely newer approved deployment, use Check for updates. While an unsaved/paused timer exists, verify reload stays blocked. Save or discard it, close other windows, accept the update, and verify history/pending work remain.
8. Sign out: workspace disappears. Close/reopen while offline: sign-in remains required. Reconnect and sign back in: synchronized history returns. Export/import a small backup through the real file UI.
9. Record failures and device limitations, then remove disposable test data. Do not clear personal site data to run this checklist.

## Remaining ordinary Windows checks for Phase 7

Use a clean Windows user or disposable VM with no personal Stride history. Keep the normal app identity and default data location; do not run these against an existing personal installation.

1. Install the official published v0.4.0 installer. Create a subject/session and save a JSON backup outside the app folders.
2. Install the reviewed ordinary 1.0.0 candidate over that installation. Confirm version, sign in with a disposable confirmed account, explicitly review/import legacy history, and verify the original session and recorded day remain.
3. Complete a session, sync to a second client, restart and verify history/session restoration. Exercise native Open/Save As and one enabled/disabled countdown notification.
4. Uninstall with **Delete app data** left unchecked. Reinstall the same candidate and verify retained cache/history after authentication. Record the observed default and installer version.
5. If testing data removal, use only this disposable profile: export all local work first, explicitly select **Delete app data**, reinstall/sign in, and verify cloud-completed history returns. Unsynced work/timers/recovery copies may be lost as documented.
6. Record WebView2 presence, Windows version, installer hashes and results; remove the disposable account afterward. Missing-WebView2 setup requires a disposable VM, never removing the runtime from this user's machine.

## After owner approves and merges

Do these only after a GO decision and explicit release approval:

1. Fetch the actual merged main commit; rerun/confirm required CI for that state. Verify the approved release version (Phase 7: `1.0.0`) and release notes, and archive the reviewed artifact/checksum evidence.
2. Confirm production Cloudflare serves that approved version and required approved Supabase settings/migrations are in place. Complete the production signup/sync/offline smoke test again.
3. Create/push `v<releaseVersion>` (Phase 7: `v1.0.0`) at that approved commit. Verify the tag resolves to the intended commit and the release guard passes. The existing tag workflow publishes only after Windows builds/checksums succeed.
4. Review the generated GitHub release assets and notes: normal installer, portable ZIP, SHA256SUMS; no validation/debug package. Download from the release and verify checksums again.
5. Repeat a clean Windows launch, real login/confirmation, two-client sync, native export/import, notification, and hosted PWA smoke test. Record exact results.

## Rollback

Retain previous installers/portable files and independent JSON backups. A frontend rollback does not roll back user/cloud data. Do not delete caches, queues, change history, tombstones, or receipts to make an older build run. Never assume an older anonymous build can open an authenticated database. If a release fails, stop distribution, report the exact failure, restore an approved compatible deployment/package, and use separately reviewed recovery/migration steps if needed. SMTP rollback disables custom SMTP and restores its prior values; this returns to team-only delivery and is not a public-signup solution.
