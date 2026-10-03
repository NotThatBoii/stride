# Phase 4.1: required authentication before entry

Stride now requires a Supabase email/password session before it opens study data. The initial welcome/guest path has been replaced by the authentication screen. The account's study records still live in its local Dexie/IndexedDB cache. This change does not implement cloud synchronization or import legacy anonymous history.

## Entry and workspace selection

`src/main.tsx` mounts `AuthProvider`, then `AuthGate`, then the data `Provider` and `App`. This keeps the workspace loader outside all signed-out and configuration-error states.

1. During official-client session restoration, show the bootstrap/loading screen.
2. Without a session, show sign-in or account creation. A missing or invalid Supabase configuration shows an actionable configuration error and blocks entry.
3. After a session is established, select `stride-account-<Supabase user UUID>` before mounting the data provider.
4. If that account has not completed onboarding, show subjects and Minimum Day setup. Otherwise open the main app.

An existing authenticated session skips the login screen after bootstrap. The account's own onboarding setting determines the next view; another account's setting cannot skip onboarding. The data provider's workspace generation guards and UI remount discard the previous account's snapshot and navigation state when the selected account changes.

## Authentication, confirmation, and offline behavior

The official Supabase client continues to handle session persistence and token refresh. There is no custom token, password storage, offline login scheme, or guest fallback. A valid unexpired cached session can restore using the SDK's normal behavior. A fully signed-out user cannot open the workspace offline. A failed refresh, network error, or eight-second bootstrap timeout leaves study data hidden and displays an authentication error. Late restoration cannot reopen a workspace after the failure barrier or an explicit sign-out.

Sign-in and account creation provide loading and validation/error feedback. If Supabase requires email confirmation and returns no session, the authentication screen tells the user to check their email and allows a return to sign-in. A returned user object alone is insufficient to open the workspace. Hosted Email Auth, confirmation settings, Site URL, redirect allowlist, schema, ownership rules, and RLS remain unchanged.

## Sign-out and retained data

Sign-out hides account data synchronously before awaiting Supabase, unmounts the workspace UI, and returns directly to authentication. A failed or offline sign-out cannot restore the account view. The existing signed-out marker protects reloads, and the SDK credential is removed by storage key without reading or logging its value. Explicit successful sign-in clears that marker.

Sign-out does not delete IndexedDB databases, account caches, active timer recovery, backups, or legacy history. A running account timer retains the same elapsed-time/recovery rules as app closure; users should pause it before sign-out if they do not want it to continue counting.

Legacy anonymous records remain in `stride` IndexedDB and, where present, the original `stride-browser-preview-v1` localStorage dataset. This entry flow does not open, scan, migrate, merge, upload, or delete either dataset. There is no anonymous workspace UI, automatic import, or anonymous-history decision prompt. Existing stored data remains available for a future explicit recovery/import flow; Phase 4.1 does not provide that UI.

JSON backup/export/restore stays available for the signed-in account's local workspace. Other account caches remain distinct, and app-level account isolation does not encrypt data against someone with direct access to the browser or Windows profile.

## Web and Windows configuration

Both web and Tauri builds require `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` at build time. See [local and production setup](PHASE_4_AUTH.md#local-setup). They are public client configuration; secret/service-role keys must never be embedded in the frontend. An unconfigured build still compiles, but displays the configuration error when opened.

The Tauri CSP remains restricted to the exact existing Supabase project origin and IPC origins. Native capabilities, IndexedDB support, file dialogs, notifications, and the Windows application shell are unchanged. Email confirmation opens the configured web Site URL; the user can then sign in in the Windows app. No desktop deep-link handler is added.

Windows release CI must provide the public variables before compiling the embedded frontend. Historical release notes and prior Windows validation records describe the builds they originally tested; they do not establish validation of this entry-flow change.

## Validation scope and deferred work

Run the following suites and report their actual results in the PR:

```sh
npm test
npm run test:db
npm run test:e2e
npm run test:e2e:auth
npm run build
```

Auth browser coverage uses intercepted Supabase responses. It should cover logged-out entry, no guest path, successful sign-in/sign-up, pending email confirmation, cached-session bootstrap, sign-out, account isolation, preserved legacy data, missing configuration, and network failures. Existing storage/timer/backup tests continue to check local persistence. These checks do not verify hosted email delivery or real hosted account access. A native build uses `npm run desktop:build` when Rust and Tauri prerequisites are available; compilation is separate from packaged-app sign-in and installer validation. `npm run test:integration` requires the disposable local Supabase stack described in [Phase 3](PHASE_3_SUPABASE.md#local-verification-and-migration-procedure), never the hosted project.

Final validation on 2026-10-03:

| Command | Actual result |
| --- | --- |
| `npm test` | 55 passed, 5 test files, 0 failed |
| `npm run test:db` | 13 passed, 0 failed |
| `npm run test:e2e` | 7 passed, 0 failed |
| `npm run test:e2e:auth` | 14 passed, 0 failed: 13 configured Auth checks and 1 missing-configuration check |
| `npm run build` | Strict TypeScript and Vite production build passed; existing dependency annotation and large-chunk warnings remain |
| `npm run desktop:build` | Attempted; could not obtain Cargo metadata because Rust/Cargo is unavailable |
| `npm run test:integration` | Attempted; disposable local Supabase stack is unavailable, so its integration checks did not run |

Browser checks ran in installed Microsoft Edge with isolated profiles and intercepted official Supabase Auth endpoints. They cover entry restrictions, sign-in/sign-up/confirmation, invalid credentials and offline failures, cached session and delayed refresh without login/legacy flashes, immediate and failed logout, account isolation, legacy database/timer/recovery preservation, backup round-trip, and authenticated timer/storage workflows. Desktop and 390-pixel-wide authentication screenshots were visually checked. No hosted users were created and no study synchronization was performed. These results do not establish hosted email delivery, real hosted sign-in, or packaged Windows behavior.

The baseline before implementation also passed: 48 unit tests, 13 database-contract tests, 7 browser regression tests, 3 Auth browser tests, and the production build. The initial sandbox could not load Vite configuration; successful baseline and final frontend runs used the approved execution environment.

## Files changed

- Entry/auth: `src/main.tsx`, `src/App.tsx`, new `src/auth/AuthGate.tsx`, `src/auth/auth-session.ts`, `src/auth/auth-session.test.ts`, `src/lib/supabase.ts`.
- Interface: new `src/components/AuthenticationScreen.tsx`, `src/components/AccountPanel.tsx`, `src/components/Onboarding.tsx`, `src/pages/Settings.tsx`, `src/styles.css`.
- Browser checks: `playwright.config.ts`, `playwright.auth.config.ts`, new `tests/auth-mock.ts`, `tests/auth-e2e/auth.spec.ts`, new `tests/auth-unconfigured/auth-unconfigured.spec.ts`, `tests/e2e/countdown.spec.ts`, `tests/e2e/dashboard.spec.ts`, `tests/e2e/design.spec.ts`, `tests/e2e/persistence.spec.ts`, `tests/e2e/workflow.spec.ts`, `tests/e2e/workspace.spec.ts`.
- Documentation: `README.md`, `docs/PHASE_4_AUTH.md`, new `docs/PHASE_4_1_AUTH_REQUIRED.md`, `docs/PORTABLE.txt`.

No Tauri configuration/capability, Dexie schema, backup/timer implementation, dependency, hosted Auth setting, or production database file changed. The existing Windows release workflow still needs public Supabase build variables supplied before an account-capable native artifact can be produced.

Phase 5 remains responsible for explicit legacy import, study-record upload/download, sync outbox processing, `get_sync_changes`, `apply_sync_operation`, conflict handling, realtime subscriptions, and recovery on a new device. None of that work, or a production database schema change, belongs to this entry-flow refinement.
