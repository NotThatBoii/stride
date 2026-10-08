# Stride

**Build consistency, one session at a time.**

Stride is a study tracker for Windows and the web. Organize subjects, record stopwatch or countdown sessions, and see your progress in history, streaks, heatmaps, and insights.

## Open Stride

- **Web:** [stride-89c.pages.dev](https://stride-89c.pages.dev).
- **Windows:** [published downloads](https://github.com/NotThatBoii/stride/releases/latest). Windows 10/11 x64 and Microsoft Edge WebView2 are required. The installer can download WebView2 when missing; the portable executable requires it already installed. No terminal or local server is needed.

This branch prepares **1.0.0**. It is a release candidate until its [release gates](docs/PHASE_7_RELEASE.md) are complete and the owner approves publication. The current published v0.4.0 predates the account and synchronization behavior described below. Windows builds are unsigned.

## Your account and study history

Create an email/password account, confirm the email, then sign in. An account is required to open a workspace. If confirmation mail does not arrive, check spam and report the problem; do not clear your study data to troubleshoot sign-in.

Signup requires an unchecked agreement to the [Terms of Service](docs/TERMS_OF_SERVICE.md) and acknowledgment of the [Data & Privacy Notice](docs/DATA_AND_PRIVACY.md), both version **2026-10-06**. Read either document directly from the signup screen or account settings. Existing accounts can sign in normally. The checkbox is an application requirement; durable server receipt recording remains a [proposal awaiting owner approval](docs/proposals/CONSENT_RECORDING.md).

Study actions save locally first. When connected, Stride synchronizes subjects, completed sessions, their recorded study days, and shared study preferences. Sign into the same account on another device to receive that history. **Settings → Cloud synchronization** shows syncing, pending changes, conflicts, and the last successful sync. Wait for synchronization to finish before retiring a device.

You can continue studying offline after an eligible saved session restores. First sign-in and expired sessions that need renewal require internet access. Offline changes queue until reconnect. A running or paused timer belongs to its device and does not appear on another device until saved as a completed session. Notifications require Stride to remain open.

Signing out hides your workspace and preserves its local history, pending changes, timer, and recovery copies. Sign back into the same account to reopen it. Each account has a separate local workspace. Someone with access to your Windows or browser profile can still access its storage; account separation does not encrypt it.

## Install the web app

On Android Chrome or Edge, open the web app and choose **Install app / Add to Home screen** from the browser menu, or use **Settings → Install Stride** when offered. On iPhone Safari, use **Share → Add to Home Screen**. Installation options vary by browser.

After **Settings** reports the offline shell is ready, the app can reopen its saved interface offline. Sign-in rules still apply. An update waits for your choice: save open edits and save or discard any timer, close other Stride windows, then choose **Reload to update**. Physical phone validation is tracked separately in the [Android/iOS checklist](docs/RELEASE_CHECKLIST.md#physical-pwa-checklist).

## Backups, import, and recovery

Use **Settings → Export JSON** regularly, especially before upgrading, clearing site data, uninstalling, or moving computers. Store exports somewhere outside the app profile. They contain readable study data and notes; keep them private.

**Import JSON** reviews a valid backup, requires a new backup download, reconciles cloud history, then adds records. Identical records are deduplicated; different versions need your choice. Unrelated account history is retained. Imported timers restore paused and do not replace an existing timer. Finish or discard your current timer before importing.

Imports are limited to **25 MiB**, checked before reading the file. A reference backup containing 10,000 sessions fits, but text-heavy valid exports can exceed the limit. Check backup size and import compatibility before retiring the original device.

An older anonymous workspace offers **Import into my account** or **Keep it stored for later** after sign-in. Import is explicit and retains the source. If two devices edit the same record, review the preserved versions and choose one or **Keep both**. **Settings → Recovery and sync issues** lets you inspect and export preserved copies and changes needing attention. Keep a backup before repair.

Synced completed history can download again from the cloud. Unsynced changes, active timers, local recovery copies, and device settings can be lost if local storage is removed. See [Data and privacy](docs/DATA_AND_PRIVACY.md) for exact storage and uninstall behavior.

## Current limits and help

- Windows x64 builds are unsigned. Portable app files use the same normal Windows data profile as the installer; the ZIP is not a portable data container.
- Large first syncs can take time. Navigation remains available while **Syncing…** is shown.
- Phone installation and offline behavior depend on browser storage and operating-system support. iOS physical validation is not yet claimed.
- Recovery copies stay local. There is no automatic pruning, encrypted backup, password-reset screen, or transfer of active timers between devices.

[Report a bug](https://github.com/NotThatBoii/stride/issues): include app version, Windows/browser version, steps, expected behavior, and the visible error. Remove account addresses and private notes from screenshots. Do not attach passwords, access tokens, or full backups to a public issue.

## Development and release

React 19, TypeScript, Vite, Tauri 2, Dexie/IndexedDB, and Supabase Auth/PostgreSQL. Use Node.js 22.12+; native builds also require the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/).

```sh
npm ci --legacy-peer-deps
npm test
npm run test:release-config
npm run test:db
npm run test:consent-proposal
npm run build
```

Development configuration and architecture live in [Auth setup](docs/PHASE_4_AUTH.md), [synchronization](docs/PHASE_5_SYNC.md), [data safety](docs/PHASE_7_DATA_SAFETY.md), and [performance evidence](docs/PHASE_6_PERFORMANCE.md). The [release checklist](docs/RELEASE_CHECKLIST.md) lists the complete browser, integration, package, and release checks. Tests use disposable contexts and databases, never a personal study profile. Production wrappers embed only the checked-in intended public Supabase configuration and scan the compiled output.

The [v1 security audit](docs/SECURITY_AUDIT_V1.md) records demonstrated fixes, remaining limits, dependency results, and approval boundaries. The consent proposal test uses an isolated PostgreSQL engine; it does not apply a hosted migration.

## After v1.0

A possible later direction is activities and tracked entries, with duration, count, completion, or measurement entries. This is a non-binding product idea. The present release remains a study tracker with subjects and sessions; its schema and terminology are unchanged.

## License

[MIT](LICENSE).

Optional post-confirmation legal receipts are prepared separately for review. See [implementation and deployment boundaries](docs/CONSENT_RECORDING_REVIEW.md); production database deployment still requires explicit approval.
