# Data and privacy

This describes Stride's technical behavior. It is not a formal privacy policy or a legal guarantee.

## Storage

| Data | On this device | Supabase |
| --- | --- | --- |
| Subjects, completed sessions, notes, recorded daily allocations | Account-specific IndexedDB cache | Synchronized account history |
| Minimum Day, daily goal, timer presets, week-start preference | Cached locally | Synchronized preferences |
| Running/paused timer and its checkpoints | Local only, including unsaved elapsed time | Not synchronized |
| Appearance, notification preference, onboarding state | Local only | Not synchronized |
| Pending operations, revisions/cursor, conflicts, recovery copies | Account-specific local safety state | Server has its own versions, change history, receipts, and tombstones; local recovery copies do not upload |
| JSON study/recovery exports | A file saved where you choose | Not uploaded by export |

Supabase Auth stores the account identity and authentication information. Its official client stores session credentials in the browser/WebView2 profile so eligible sessions can restore. Passwords are submitted to Supabase Auth over HTTPS and are not study records. Stride's study-backup/recovery exporters do not read Auth storage or include session tokens. A recovery export includes more local diagnostic study state than an ordinary backup, and should also be kept private.

The service worker caches only public application files and a non-private lifecycle marker. It does not cache Auth, RPC/API responses, exports, recovery data, or study history. Cloudflare serves the frontend; Supabase handles authentication and synchronization. The repository's publishable key identifies that public service and does not grant administrator access.

## Accounts and logout

Each signed-in user selects a separate IndexedDB database. Ownership of server changes is derived from authenticated identity and protected by server checks/RLS. The app does not show another account's cache when switching accounts or export another account's database.

Logout hides the workspace immediately and asks the official SDK to clear/revoke this device's session. It preserves account databases, unsynced operations, timers, conflicts, recovery copies, and anonymous legacy history. Logout is not erasure. A later login to the same account reopens that local state. A long-running logout offers a guarded **Reopen sign-in** action when the signed-out state was durably stored.

Local account separation is an application boundary, not encryption. Someone who can access your browser/Windows profile or developer tools may inspect IndexedDB and session storage. Backups are readable JSON. Protect your device, account, and exported files accordingly.

## Removal, reinstall, and recovery

- **Browser site-data clearing, profile removal, storage eviction, or device loss:** removes the affected local state. Signed-in devices can recover synchronized completed history from Supabase; unsynced changes, unsaved timers, local recovery copies, and local settings are not recoverable from cloud sync alone.
- **Windows installer uninstall:** the current Tauri NSIS template preserves application data by default. Selecting **Delete app data** removes the application's local/roaming data directories. Reinstall with retained storage can reopen the prior workspace after authentication. Removing data has the same local-only loss limits as browser clearing. This default is source-backed; actual candidate installer observations are recorded separately in the release report.
- **Portable:** deleting the extracted application folder normally leaves the Windows data profile. Ordinary portable and installer editions use the same app identity/profile; portable does not carry history in its ZIP.
- **Regular JSON backup:** includes the current account's study workspace and timer snapshot. It is an independent recovery file, not a cloud/credential backup. Import validates and stages records, requires a fresh backup, reconciles cloud state, then adds records or asks about divergent versions. Timers restore paused.
- **Local recovery copies:** retain versions removed by supported study actions, conflict resolution, and sync reconciliation. They survive logout and ordinary restart, but not deletion of the containing storage. Inspect/export them from Settings before clearing data.

An older anonymous workspace remains stored until explicitly imported or deferred. Stride does not silently adopt it into an account. There is no automated history, tombstone, feed, receipt, or recovery-copy pruning in this release.

## Reporting problems

Share the app/browser version, steps, and visible safe error when reporting a bug. Do not post passwords, authorization headers, tokens, private notes, or complete backup/recovery files in public issues. The [data-safety review](PHASE_7_DATA_SAFETY.md) distinguishes tested recovery behavior from unavoidable local-only loss.
