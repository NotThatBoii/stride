# Phase 7 — Stride 1.0 release readiness

**GO FOR v1.0.** The required manual gaps are closed by the owner's October 6 reports: public signup with friends, Windows 11 / Stride 1.0.0 uninstall-reinstall retaining history and the signed-in session with **Delete app data unchecked**, and reopening the original confirmation email link into the signed-in web workspace. Phone PWA installation also works. The exact observation limits remain recorded below. Branch: `codex/phase-7-release`. PR #9 remains draft and unmerged; no tag, GitHub Release, production migration, pruning or agent Auth-setting change occurred. GO is a recommendation, not authorization to perform release actions.

Executed candidate checks identify source checkpoint `700d805e073b2c2752a3e7de7bb9846cab57fd91`. Later edits contain only documentation and measurements. PR checks identify their own head/merge ref; checkpoint results are not relabeled. [Sanitized live evidence](measurements/phase7-live-validation.json) records observed boundaries without credentials or raw study data. The manual evidence review below was reported on **October 6, 2026, Asia/Manila**; that is the report date, not an invented test date.

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

The later documentation head `7d1f29849fe63379330d38b5c91cbcbdd51a1cbb` also passed [frontend 37273070427](https://github.com/NotThatBoii/stride/actions/runs/37273070427), [real integration 37273070390](https://github.com/NotThatBoii/stride/actions/runs/37273070390), and [both Windows jobs 37273070393](https://github.com/NotThatBoii/stride/actions/runs/37273070393). Exact counts remained unchanged; integration cleanup succeeded. These are executed results for that head, not a claim that a later documentation edit has already completed CI.

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

WebView2 already installed; missing-runtime behavior source/config-backed. October 5 native automation blocked launching the owned uninstaller and was not bypassed. Tauri NSIS source preserves data by default; **Delete app data** removes app directories. Personal ordinary installation/profile was protected during agent testing.

**Owner-reported uninstall/install, retention and session restoration PASS, reported October 6:** the owner used uninstall followed by installation on **Windows 11 / Stride 1.0.0**, then explicitly confirmed that **Delete app data was unchecked** and previous subjects/completed sessions remained. Reopening Stride restored the signed-in workspace without asking for credentials. The earlier password-login observation also passed. This closes the ordinary reinstall/data-retention gate for that observed route. Previous installed version, independently compared allocation rows and a separate in-place installer-over-installer test were not supplied; no such extra observations are claimed.

## D. Web validation

Production [Stride](https://stride-89c.pages.dev) displayed **0.4.0**. Real disposable signup/confirmation, first-subject onboarding, authenticated refresh, logout hiding workspace and login passed. Dashboard/heatmap, History, Settings and Insights were exercised. [Candidate preview](https://codex-phase-7-release.stride-89c.pages.dev/) displayed **1.0.0**, accepted real login/fresh-device onboarding, pulled candidate history, restored on refresh and hid workspace on logout.

Both actual hosted origins had controlling workers and reopened saved authenticated workspaces offline. Cache enumeration contained same-origin static files/manifest/icons/lifecycle marker, no Supabase Auth/RPC responses. A production offline subject produced one pending operation, uploaded after reconnect and appeared in installed candidate. Production Settings reported offline shell ready. Automated tests separately cover safe updates; a genuinely newer hosted deployment/update was not forced.

## E. Email-confirmation validation

Owner witnessed **email received; real link opened production Stride successfully**. Hosted Auth showed confirmed account; machine clients completed login/onboarding/refresh/restart/logout/relogin. No address/password/confirmation URL/token or email body committed.

October 5 read-only Site URL: `https://stride-89c.pages.dev`; no additional redirects. Custom SMTP was disabled on that read. [Supabase default SMTP](https://supabase.com/docs/guides/auth/auth-smtp) is organization-team-only and not production delivery. The October 5 allowed-inbox success alone did **not** establish public onboarding. Owner chose direct SMTP configuration; agent changed no hosted settings. Those historical observations are not a fresh assertion about October 6 configuration.

**Owner-reported public signup PASS, reported October 6:** in response to the question about non-team inbox signup and confirmation redirect, the owner reported trying it with friends and that it works. This is accepted as owner-reported closure of the public signup gate, separate from the agent-observed October 5 allowed-inbox flow. Exact friend test dates/builds/provider settings were not supplied; no mailbox addresses or tokens are recorded and no independent SMTP recheck is claimed.

**Owner-reported actual reused-link PASS, reported October 6:** after being asked specifically to reopen the original signup confirmation link from email for an already-confirmed disposable account, the owner reported that Stride's web version opened with the account already logged in. That is the exact observed result: normal signed-in access, without a reported loop or blocking error. It does not establish that a fresh session was issued, that an error-guidance screen was displayed, or that expiry was deliberately forced. Candidate actual-SDK fixtures separately pass failed query/hash, valid callback/reload and delayed restoration. Production has not received candidate fixes.

The Windows 11 / Stride 1.0.0 observation also reports password login without a new confirmation email. That is expected for an already-confirmed account: the sign-in path uses `signInWithPassword`, while account creation separately uses `signUp`. That login observation is distinct from the subsequently reported original-link reopening above. No URL/token was shared or committed.

If a further Auth/configuration change proves necessary, obtain separate explicit approval before modifying it. Credentials stay in Supabase; preserve confirmation/Site URL/templates. SMTP rollback returns to team-only delivery. No paid service or new agent configuration change was made.

## F. PWA/mobile validation

**Owner-reported phone PWA installation PASS, reported October 6:** the owner said installing the web app onto the phone works. Android was the earlier available-device context; phone model, OS/browser version, actual install method and tested app build were not supplied. Stride's phone installation is the website/PWA, not an APK. Only installation is marked passed: standalone persistence, physical offline queue/reconnect and hosted update were not individually reported. The remaining exact [phone checklist](RELEASE_CHECKLIST.md#physical-pwa-checklist) stays available for recording those limits. Hardware cannot be controlled here; iPhone Safari remains physically untested. Desktop/mobile viewport automation is not a phone pass. These unobserved device cases are not newly inferred product failures.

## G. Upgrade validation

Latest published [v0.4.0](https://github.com/NotThatBoii/stride/releases/tag/v0.4.0), commit `27483639c652156af0dbb7fb48e6c4404649f5dc`, predates Auth/cloud. Official portable ZIP SHA `30aef494337229dd7c18af3ebd56842b97b87d5b7032fdf1cd9f6181da83b1cd`. Actual executable created one subject, saved a 204-second session and exported version 1 JSON via Save As.

**Published ordinary portable → candidate ordinary portable:** same owned profile, confirmed login and explicit reviewed/backup-gated legacy import. Original subject/session/allocation day exact; original anonymous database also retained them. Portable restart retained all session IDs/allocations; only title difference was the expected production reverse edit being pulled.

**Installed authenticated Phase 6 validation → candidate validation installer:** verified NSIS upgrade exit 0, PE product/file version 1.0.0. Reopened offline before reconciliation: exact four subjects, one session/allocation, two pending operations/UUIDs, one conflict, three recovery copies, paused timer, preferences, revisions and cursor. Candidate finished saved timer offline, reconnected/uploaded safely.

Distinct scenarios: published v0.4.0 had no Auth outbox/recovery. The October 6 owner report adds the ordinary uninstall → install route on Windows 11 / Stride 1.0.0, with **Delete app data unchecked**, previous subjects/sessions retained and authenticated workspace automatically restored. The prior installed version and a direct installer-over-installer run were not specified; neither is invented. Original allocation-day invariants remain established by the exact agent tests above, not by an assumed manual row comparison. The agent's personal-profile protection prevented its own ordinary-install setup. No identifier/schema change.

## H. Multi-device acceptance

Real installed Windows and independent production browser, same disposable account. Initial installed Phase 6 subject/session transferred to web and received reverse edit. Offline queue/timer/concurrent edit retained through upgrade. Candidate reconnect exposed both conflict versions; explicit **Keep both** retained each and both appeared in production History with candidate's saved offline timer.

Additional actual 1.0 uploads reached production; production edited candidate-created session and Windows received it; production offline subject reached Windows after reconnect. Final installed state: six subjects, seven sessions/seven allocations, zero pending/unresolved conflicts, six recovery copies. Resolved conflict record retained. No silent version loss observed. SQL-backed automated fixtures remain separate evidence.

## I. Security results

Independent checkpoint scan: 165 text files, zero actual credentials; final documentation-head scan: **178 tracked text files**, the same seven known negative-fixture matches and zero actual credentials. Only `.env.example` tracked. Production/PWA bundle scans passed without source maps; no runtime console logging found. Evidence excludes emails/account IDs/credentials/tokens/raw records/profile files.

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

Unsigned x64/WebView2; eligible saved session needed offline. Active timers/recovery/pending work device-local; storage removal can lose unsynced work. Large first sync honest Syncing status. No physical iOS claim, password-reset screen, encrypted backups, automatic pruning or cross-device timer transfer. Ordinary uninstall/install/history/session retention passes on the owner-reported Windows 11 route. Phone installation passes; additional phone offline/update/standalone cases remain unreported manual limits.

## M. Release artifacts

Verified checkpoint Windows run 37267882810:

| Asset | Ordinary SHA-256 | Validation SHA-256 |
| --- | --- | --- |
| Outer CI ZIP | `94dd0d491ea2fc85c9044c01baf7b4babf22000b53f03a6a5788023b10b5dccb` | `6fd75350f67bb6c97818403ab2188290ed59ea1e4da4d7d478c7b39380dd9281` |
| Installer | `fffdc901fd3b4138c9d2c7d0deea06156f4e0bb2b00101e09a003fb5fe45894b` | `304d950b2c443d13630bd2c45f4f7caa9985eec26922ad0826a3bf8e7d92ef1d` |
| Portable ZIP | `cc76e42189246523df67b0116d78d9c68079fb0c5326d482e5b9bb0cdb6d76af` | `8a36779fa912d7b932b49d0f3047386f8da858bd5545224a01e4ea3ff6204be2` |

CI IDs ordinary **11326349813**, validation **11326809081**. Ordinary files: `Stride_1.0.0_x64-setup.exe` 2,033,601 bytes, `Stride_1.0.0_Windows-x64-portable.zip` 2,612,429 bytes, `SHA256SUMS.txt`. x64 PE/product/version/checksums/archive allowlist passed. Portable only executable/README/LICENSE. Validation product/files cannot publish as ordinary. Public endpoint/key and no development secrets/maps/debug files verified. Hashes identify exercised checkpoint files, not a future rebuild. Any merge/tag build must be independently verified. No tag/release created.

Later head `7d1f298` produced [Windows run 37273070393](https://github.com/NotThatBoii/stride/actions/runs/37273070393), ordinary artifact **11328833391** and validation **11329387173**. Both downloads independently passed local outer-digest, inner-checksum, PE version/product/x64 and archive-content verification. Both portable executables launched in signed-out disposable profiles, required sign-in and hid retained history, then closed. Rebuilt binaries differ from checkpoint hashes; longer login/notification/upgrade tests above remain attributed to the checkpoint packages.

| Later ordinary asset offered for owner testing | SHA-256 |
| --- | --- |
| `Stride_1.0.0_x64-setup.exe` (2,032,810 bytes) | `0e96ee418ee50ab4cf1ff8db12d9142a9faee585623690590a4dbb5fad7e3a5b` |
| `Stride_1.0.0_Windows-x64-portable.zip` (2,612,439 bytes) | `65eb70c79bbb5e34d1ee58c333f559b963fb8e1c9cb080d5398b20d8ce82a65b` |

The verified installer was provided to the owner on October 6. The owner subsequently reported uninstall/install, history retention with app-data removal unchecked, and restored login working on Windows 11 / Stride 1.0.0. No new independently observed install or owner-supplied checksum comparison is claimed; longer agent observations remain tied to their exact builds above.

## N. Remaining blockers

| Gate | Latest evidence | Disposition |
| --- | --- | --- |
| Public signup with non-team inbox/confirmation redirect | Owner reported signup works with friends on October 6; test build/date details not supplied | OWNER-REPORTED PASS; independent provider/configuration verification not claimed |
| Ordinary uninstall/install, launch and password login | Owner reports working on Windows 11 / Stride 1.0.0 | OWNER-REPORTED PASS for this route |
| Ordinary reinstall preserving history/session | Owner explicitly confirms previous subjects/completed sessions remained, Delete app data unchecked, workspace opens signed in | OWNER-REPORTED PASS; previous version/in-place replacement not claimed |
| Actual reused confirmation-link behavior | Original email link reopened Stride's web workspace already signed in | OWNER-REPORTED PASS for normal access; no forced-expiry/error-screen claim |
| Physical phone PWA installation | Owner reports installing the web app onto the phone works | OWNER-REPORTED INSTALL PASS; other phone checklist cases remain manual |
| Physical iPhone Safari | No available-device test reported | MANUAL REQUIRED — no support claim |

**No remaining demonstrated release blocker.** The two recorded manual gaps are closed by the clarified owner observations, alongside the prior automated/CI/hosted evidence. Owner-reported results remain distinct from independent machine observations. No new public-delivery failure is inferred from historical SMTP settings or absence of mail during password login. Final reviewed-head CI must still be green before marking ready/merging; a later failing check would reopen the decision.

Additional Android standalone/offline/update and iPhone cases remain **MANUAL REQUIRED / UNTESTED**, with the exact checklist supplied; phone installation itself passed. Optional later: smaller bundles, broader assistive-technology coverage, separately approved retention protocol. No demonstrated data-loss/performance bug.

Cleanup passed: one disposable Auth user deleted after every test client signed out. A read-only query scoped to that user returned zero in all nine categories: Auth user, subjects, sessions, allocations, preferences, versions, clocks, feed and receipts. Native windows/owned browser closed; ignored credential file removed. Personal account/history/profile untouched. Disposable CI cleanup also succeeded.

## O. Recommendation

**GO FOR v1.0.** Public signup, ordinary Windows reinstall/history/session retention and original confirmation-link reopening pass on the owner's reported evidence. Automated source tests, real disposable integration, hosted sync/data-preservation and Windows package/notification evidence remain intact. Phone installation passes with the additional manual limits stated above. Keep PR #9 draft and unmerged for the owner's review; GO does not perform or authorize merge/tag/publication. No release action was executed.

### Exact owner release sequence

Perform these only after accepting this GO decision and approving release. Run commands from a clean repository checkout, one at a time, and stop on any failure. **Pushing `v1.0.0` automatically creates the GitHub Release after the Windows workflow succeeds.** Do not push it before the main checks below pass.

1. **Mark PR #9 ready for review.** Open [PR #9](https://github.com/NotThatBoii/stride/pull/9), verify this report/description and all three workflows for its final reviewed head, then select **Ready for review**. Record that head SHA. Review is still required; this documentation update leaves it draft.
2. **Merge PR #9.** After review and required checks pass, merge using the repository's configured GitHub merge method. Record the resulting main commit SHA; it need not equal the PR head.
3. **Verify main CI and deployment.** On that exact SHA, confirm **Verify Stride**, **Verify local Supabase integration**, and both ordinary/validation jobs in **Build Windows app** pass. If a path-filtered workflow has no run, dispatch it on that exact main state through Actions. Confirm Cloudflare production deployment corresponds to that SHA and Settings at `https://stride-89c.pages.dev` shows **1.0.0**. Smoke-test real signup/confirmation/login, history/sync, offline/reconnect and logout. Phase 7 needs no new production schema migration or Auth configuration change; stop for separate approval if one becomes necessary.
4. **Create and push the annotated tag at the approved main SHA.** Fetch main/tags, check out that exact remote-main state and compare it with the recorded merge SHA. Detached checkout works even when this workspace has no local main branch. Verify release metadata and absence of the tag before creating it:

   ```powershell
   git status --short
   # Require no local changes before continuing.
   git fetch origin main --tags
   # Stop if fetching fails.
   git switch --detach origin/main
   # Stop if switching fails.
   $approvedReleaseCommit = '<main merge SHA recorded in step 2>'
   if ((git rev-parse HEAD).Trim() -ne $approvedReleaseCommit) { throw 'Main differs from the approved commit.' }
   node scripts/release-version.mjs v1.0.0
   if ($LASTEXITCODE -ne 0) { throw 'Release version/tag guard failed.' }
   git tag --list v1.0.0
   git ls-remote --tags origin refs/tags/v1.0.0 'refs/tags/v1.0.0^{}'
   # Both tag lookups must succeed and return no matches. Never replace an existing tag.
   git tag -a v1.0.0 $approvedReleaseCommit -m 'Stride v1.0.0'
   if ($LASTEXITCODE -ne 0) { throw 'Tag creation failed.' }
   git push origin refs/tags/v1.0.0
   if ($LASTEXITCODE -ne 0) { throw 'Tag push failed.' }
   git rev-parse 'v1.0.0^{}'
   git ls-remote --tags origin refs/tags/v1.0.0 'refs/tags/v1.0.0^{}'
   # Local peeled SHA and remote ^{} SHA must equal the approved merge SHA.
   ```

5. **Verify the tag release workflow.** In Actions, open **Build Windows app** for `v1.0.0` and that approved SHA. Both matrix jobs and **publish** must succeed; **Verify Stride** also runs for the tag. Integration is checked on main, not expected as a tag-triggered run. Confirm the generated release targets the tag and has the intended 1.0.0 title/notes. Only ordinary **Stride-Windows-x64** assets may be published.
6. **Verify the published Windows downloads.** From the actual GitHub Release download exactly `Stride_1.0.0_x64-setup.exe`, `Stride_1.0.0_Windows-x64-portable.zip`, and `SHA256SUMS.txt` into a fresh folder. From the approved main checkout run:

   ```powershell
   ./scripts/verify-windows-artifacts.ps1 -Directory '.\work\release-v1.0.0-downloads' -Version 1.0.0
   ```

   This verifies both hashes, installer product/version, portable Windows x64 product/version and ZIP contents limited to `stride.exe`, `README.txt`, `LICENSE`. Compare with the ordinary artifact from the **same tag run**, not earlier candidate hashes. No validation/debug package should be in the release.
7. **Post-release web + Windows smoke.** Use disposable accounts and a clean Windows user/VM with the actual published installer and portable downloads. Check 1.0.0, real email confirmation/login, restart/history persistence, two-client subject/session transfer and reverse edit, offline completion/queue/reconnect, conflict **Keep both**, native export/reviewed import, visible/disabled/stale countdown notification and logout hiding history. Confirm production PWA shell/installation; record physical phone offline/update cases only if actually tested. Clean up disposable data and record results. If a material failure appears, stop distribution and follow the separately approved rollback/recovery plan without deleting histories or synchronization state.
