# Pre-v1.0 code review fixes

Baseline: `08391ac5cee8c433944c166b1a415fa932a8e40f` (latest fetched main). PRs #9, #10 and #11 were confirmed merged. The working tree was clean before creating `codex/v1-review-fixes`.

The unchanged baseline passed 204 unit tests, 20 SQL/RLS tests, six release configuration tests and the production build/credential checks. Before modifying implementation code, six new two-device browser regressions were run against that baseline: all six failed at the reported defect. The browser fixture uses two independent IndexedDB accounts, mocked Auth transport and the unchanged production sync SQL running in disposable PGlite. It does not claim to simulate real Supabase Auth/PostgREST; those are validated separately by integration CI.

## 1. P1 — Child uploads abandoned during a live subject conflict

**Original defect/root cause:** The subject resolution transaction removed pending child-session operations for every cloud/both choice, even when both parent versions were live. Independent local session records remained in IndexedDB but lost their only upload operations. An empty outbox could then report Synced while the other device and server lacked that history.

**Correction:** Broad child-operation removal is restricted to parent deletion or deletion reversal. A live/live subject edit retains independent original child operations, including their UUIDs and frozen requests. Explicit child conflicts continue through the existing separate resolution logic. Keep both retains its existing whole-tree clone with fresh record IDs and preserves uploads for independently edited/new original children. Parent/session/slice references and recovery copies remain in the existing transaction. Unknown frozen requests still block resolution until their outcome is known.

**Files:** `src/lib/sync/conflicts.ts`, `src/lib/sync/import-conflicts.test.ts`, `tests/sync-e2e/review-fixes.spec.ts`.

**Before:** Cloud and both choices left device A with independently edited/new sessions while device B lacked the new session and retained the old notes. Both cases failed the local-state comparison even after the outboxes became empty.

**After/regressions:** Cloud choice converges to two original sessions/four allocations on both devices and SQL. Both choice converges to four sessions/eight allocations under two valid subjects: the original history plus the existing full-tree clone. Tests compare both complete local histories and exact server timestamps, text, subject references, duration, mode, completion and calendar-day allocation values. Existing parent deletion, moved-child, lost-acknowledgment, recovery and frozen-operation tests remain applicable.

**Remaining risk:** Keep both deliberately duplicates the selected whole subject history, consistent with the existing product semantics. This patch does not attempt to repair already-abandoned operations in historical account databases without evidence about their server state; recovery copies remain available.

## 2. P1 — Stale editors overwrite downloaded changes

**Original defect/root cause:** React form state kept the fields displayed when the editor opened, but storage attached the latest database revision when saving. Newer downloaded description/notes could therefore be replaced without a concurrency conflict.

**Correction:** Each editor holds its original displayed payload and captures the matching record/revision in one read transaction. Session snapshots include sorted original allocation rows. A snapshot includes workspace generation. Save compares payload, revision, entity, ID and workspace inside the same read/write transaction as the mutation/outbox enqueue; any mismatch aborts before writing. Subject archive/restore/delete actions use the same guard. If data already changed before snapshot capture, saving stays disabled with guidance. A rejected save leaves typed fields intact and tells the user to copy desired edits, close the editor and reopen the current version. Editors remain mounted after remote deletion, including a session editor in a removed subject's detail screen, so deletion cannot silently erase the in-memory draft.

**Files:** `src/lib/local-database.ts`, `src/components/useEditSnapshot.ts`, `src/components/SubjectEditor.tsx`, `src/components/Sessions.tsx`, `src/pages/Subjects.tsx`, `src/lib/storage.test.ts`, `tests/sync-e2e/review-fixes.spec.ts`.

**Before:** Device A opened an editor and typed a name/title, B changed description/notes and synced, then A pulled and saved. The editor closed and B's fields were overwritten; both browser regressions failed because no draft-preservation alert existed.

**After/regressions:** Both forms retain the unsaved draft, display guidance and leave B's current values unchanged on both devices and SQL. Browser tests additionally cover remote subject archive, subject/session deletion and parent deletion while editing a child. Unit tests cover ordinary editing, unchanged text-only allocation preservation, changed/deleted/archived records, revision-only changes, allocation-only changes, initial stale fields, account switching and a concurrent newer write ahead of a stale save. Failed writes do not alter the outbox.

**Remaining risk:** Drafts remain in memory, as before; closing/reloading the editor without copying them discards that draft. Reconciliation is explicit copy/reopen rather than automatic field merging. Same-value revision changes conservatively require reopening.

## 3. P2 — Remote archive traps an existing timer

**Original defect/root cause:** `saveRunning` rejected every timer update on an archived subject, while subject restoration was disabled whenever any active timer referenced it. Remote archive therefore prevented Pause/Finish and blocked restoration.

**Correction:** The archive check distinguishes a new timer from an update to the persisted timer with the same ID and subject. Existing timers may pause/resume/finish; starting on an archived subject or changing a timer to an archived parent still fails. Restore is enabled for an archived subject with an active timer; archive/delete guards remain. The finish transaction still validates the completed session, preserves its recorded allocation dates, queues the upload and removes the checkpoint atomically.

**Files:** `src/lib/local-database.ts`, `src/components/SubjectEditor.tsx`, `src/lib/storage.test.ts`, `tests/sync-e2e/review-fixes.spec.ts`.

**Before:** B archived A's running subject, A pulled, and Pause failed: Resume never appeared.

**After/regressions:** A pauses, reloads its persisted checkpoint, finishes and saves while offline, then converges with B and SQL. A 23:50–00:10 session is exactly 1,200 seconds with 600 seconds on each of the two original local days. A second active timer exercises restoring the remotely archived subject. Unit tests also reject a new timer on the archived subject and preserve restart state. The separate existing PWA suite validates offline app-shell restart; this development-server regression reloads online before completing offline.

**Remaining risk:** Remote deletion still uses the existing protected-parent/recovery flow. This exception is limited to updating the already-persisted timer and does not make archived subjects available for new sessions.

## 4. P2 — Backward-clock resume creates overlapping intervals

**Original defect/root cause:** Resume assigned `Date.now()` without comparing it to the previously recorded segment end. A 10:00–10:10 segment followed by resuming at 10:05 and finishing at 10:15 counted 1,200 seconds in a 900-second span; completed-session validation rejected the result.

**Correction:** Resume and timer persistence enforce calendar ordering across segments, the initial start and the new running start. If the wall clock precedes the recorded end, resume is rejected with guidance to correct/wait for the clock or finish the paused session. No saved interval is shifted, duplicated or discarded. Focus save also checks ordering inside its existing error boundary. Previously overlapping timers remain intact, show export/recovery guidance and can be explicitly discarded into the existing recovery-copy flow, which retains the raw `discarded_timer`.

**Files:** `src/lib/timer.ts`, `src/pages/Focus.tsx`, `src/lib/local-database.ts`, `src/lib/storage.test.ts`, `tests/sync-e2e/review-fixes.spec.ts`.

**Before:** The 10:05 Resume succeeded and the expected clock warning was absent. Independent review confirmed the resulting overlapping 1,200-second session could not be saved.

**After/regressions:** Resume at 10:05 is blocked without changing the paused checkpoint. After correcting to 10:15/restarting, Finish saves the legitimate 600 seconds with its original 10:00–10:10 timestamps and matching allocation total on both devices and SQL. Unit coverage includes normal multiple pauses, midnight boundaries, countdown clipping, direct persistence rejection, database reopen and previously corrupted raw recovery copies.

**Remaining risk:** Time spent while resume is blocked is not recorded. Previously overlapping intervals require explicit recovery review because reconstructing the intended elapsed duration automatically would invent history. Invalid/excessive legacy intervals retain the existing bounded validation/export/discard behavior.

## Final validation

Executed final local validation:

| Suite | Passed | Skipped |
| --- | ---: | ---: |
| Unit (14 files, including timer/storage/sync tests) | 220 | 0 |
| SQL/RLS and deployed legal-receipt migration | 20 | 0 |
| Release configuration and credential guards | 6 | 0 |
| Existing isolated consent proposal checks | 3 | 0 |
| Browser workflow/restart | 7 | 0 |
| Authentication, legal consent and receipts | 41 | 0 |
| SQL-backed multi-device synchronization | 25 | 0 |
| Mobile/security hardening | 12 | 0 |
| Recovery | 3 | 0 |
| Stress | 17 | 0 |
| Production performance (100/1,000/10,000 sessions) | 6 | 0 |
| Production PWA | 6 | 1 |
| **Total** | **366** | **1** |

TypeScript and the production build passed, including intended public configuration and embedded-private-credential guards. The new coverage comprises 16 unit tests and 10 SQL-backed browser tests. The unchanged restart test initially failed to open its persistent profile in a deeply nested temporary path; all seven workflow tests passed from a shorter disposable checkout. No existing test was weakened. PWA's existing standalone-installation test skipped where automated installation is unsupported; shell caching, offline reopen, update handling and native-worker exclusion passed.

The review PR's final-head checks record real disposable Supabase Auth/PostgREST/client integration and both production and validation Windows builds, including packaging and corrupt-download rejection. Those CI checks and human review are required before merging.

### Paired 10,000-session measurements

Both runs used the same Windows host, Edge 154.0.4258.62, dependencies, fixture and minified-build path, with other remediation suites stopped. The baseline runtime was restored directly from `08391ac5cee8c433944c166b1a415fa932a8e40f`; the second run used the final fixed source. The workload contains 10,000 sessions and 12,000 original allocations. These are single local observations, with mocked Auth and PGlite RPC transport, rather than hosted or packaged-native latency measurements.

| Observation | Baseline | Fixed |
| --- | ---: | ---: |
| Cached account startup | 680 ms | 657 ms |
| First History navigation | 399 ms | 392 ms |
| First Insights navigation | 364 ms | 362 ms |
| Warm History navigation | 102 ms | 39 ms |
| Warm Insights navigation | 45 ms | 42 ms |
| Full SQL-backed pull | 36,158 ms | 35,357 ms |
| 100 incremental pushes including debounce | 2,960 ms | 2,982 ms |

Startup read/query counts are identical: 18 store gets, four index getAll, three store getAll and four cursor opens. Both runs record zero idle long tasks, 102 pull calls, 10,021 changes and 6,129,213 response bytes. Incremental pushes issue exactly 100 apply calls and two pull calls. Export/reimport preserves 10,100 sessions and 12,120 allocations with zero duplicate apply operations. No meaningful regression was observed; the 22 ms push difference and smaller navigation differences should not be treated as statistically significant. The existing large-entry-bundle warning remains.

Raw evidence: [browser baseline](measurements/pre-v1-review-browser-10000-baseline.json), [browser fixed](measurements/pre-v1-review-browser-10000-fixed.json), [sync baseline](measurements/pre-v1-review-sync-10000-baseline.json), [sync fixed](measurements/pre-v1-review-sync-10000-fixed.json).

No schema, migrations, Auth, RLS, private schema boundaries, legal receipts, sync wire protocol, deployment settings, manifests or dependencies were changed. No personal history, old recovery records or hosted accounts were used or pruned. No merge, tag, release or deployment is authorized by this remediation.
