# Data & Privacy Notice

Privacy Version: 2026-10-06

This describes Stride's technical behavior. It is not a formal legal privacy policy, compliance certification or guarantee of security. Read it before creating an account and when deciding how to protect your study data.

## Storage

| Data | On this device | Supabase |
| --- | --- | --- |
| Subjects, completed sessions, notes, recorded daily allocations | Account-specific IndexedDB cache | Synchronized account history |
| Minimum Day, daily goal, timer presets, week-start preference | Cached locally | Synchronized preferences |
| Running/paused timer and its checkpoints | Local only, including unsaved elapsed time | Not synchronized |
| Appearance, notification preference, onboarding state | Local only | Not synchronized |
| Pending operations, revisions/cursor, conflicts, recovery copies | Account-specific local safety state | Server has its own versions, change history, receipts and tombstones; local recovery copies do not upload |
| JSON study/recovery exports | A file saved where you choose | Not uploaded by export |

Supabase Auth stores the email address, account identity and authentication information. Its official client persists session credentials in the browser/WebView2 profile so eligible sessions can restore. Passwords are submitted to Supabase Auth over HTTPS and are not saved as Stride study records, backups, recovery records or synchronization payloads. Stride does not implement password hashing.

Study-backup and recovery exporters do not read Auth storage or include the app's access/refresh tokens. Backup and recovery files are readable JSON; they contain your study data, notes and, for recovery exports, additional local diagnostic study state. Do not share them publicly. If you put sensitive information into a study field yourself, that information remains part of its exported content.

## Providers and application requests

Cloudflare serves the frontend; Supabase handles authentication and synchronization. These providers receive the network requests needed to deliver their services, including account/authentication requests to Supabase and ordinary request headers/network information. Their operational processing, logs and retention depend on their own services and configured settings. This notice does not assert that those providers collect no data.

Stride's code does not include an advertising SDK, analytics collector, browser/device fingerprint collector or custom telemetry endpoint. Hosting and authentication providers may still process operational request data.

The repository's Supabase publishable key identifies the public service and does not grant administrator access. Server access is controlled by authenticated ownership and database permissions/RLS, rather than secrecy of that public key or CORS alone.

## PWA caches and offline use

The service worker caches only public application files and a non-private lifecycle marker. It does not intentionally cache authenticated Supabase Auth/API/RPC responses, exports, recovery data or study history. Local study history lives separately in IndexedDB. First sign-in and expired sessions needing renewal require internet access; eligible saved sessions can reopen a cached workspace offline.

Browser storage can be evicted or removed by the browser, operating system or user. PWA installation does not provide an independent cloud backup or guarantee storage persistence. Android/iPhone behavior depends on the device/browser; physical iPhone validation is not claimed.

## Accounts and logout

Each signed-in user selects a separate IndexedDB database. Server changes derive ownership from authenticated identity and are protected by server checks and row policies. The app does not select another account's cache or export another account's database when switching accounts.

Logout hides the workspace immediately and asks the official SDK to clear/revoke this device's session. It preserves account databases, unsynced operations, timers, conflicts, recovery copies and anonymous legacy history. Logout is not erasure. Later login to the same account can reopen that local state. A long-running logout offers a guarded Reopen sign-in action when the signed-out state was durably stored.

Local account separation is an application boundary, not local encryption. Someone who controls your Windows/browser OS profile or developer tools may inspect IndexedDB, session storage and exported files. Protect your device, account and backups accordingly. Stride does not claim end-to-end encryption or zero-knowledge cloud storage.

## Removal, reinstall and recovery

- Browser site-data clearing, profile removal, storage eviction or device loss removes affected local state. Signed-in devices can recover synchronized completed history from Supabase; unsynced changes, unsaved timers, local recovery copies and local settings are not recoverable from cloud sync alone.
- Windows installer uninstall preserves application data by default in the current Tauri NSIS setup. Selecting Delete app data removes the app's local/roaming data directories. Reinstall with retained storage can reopen the prior workspace after authentication. Data removal has the same local-only loss limits as browser clearing; keep an external backup first.
- Deleting the extracted portable app normally leaves the Windows data profile. Ordinary portable and installer editions use the same app identity/profile; the ZIP does not carry your study history.
- Regular JSON backup includes the current account's study workspace and timer snapshot. Import validates/stages records, requires a fresh backup, reconciles cloud state, then adds records or asks about divergent versions. Timers restore paused. The current single-file import limit is 25 MiB, checked before reading a browser or native file. Large exports can contain otherwise valid data yet exceed this limit; verify important backups before relying on them. Oversize rejection leaves the current workspace unchanged.
- Local recovery copies preserve versions removed by supported study actions, conflict resolution and synchronization. They survive logout and ordinary restart, but not deletion of their containing storage. Inspect/export them before clearing data.

An older anonymous workspace stays stored until explicitly imported or deferred. Stride does not silently adopt it into an account. This version does not automatically prune study history, tombstones, change-feed entries, operation receipts or recovery copies.

Stride has no self-service account-deletion screen. Deleting browser/Windows data or signing out does not delete cloud history or the Supabase account. Ask the maintainer through the reporting mechanism about account/data requests without posting private records publicly.

## Signup acknowledgement

New signup in this build requires an unchecked-by-default control agreeing to the current Terms of Service and acknowledging this notice. Existing accounts can sign in without repeating signup. This is an app-side acknowledgement; it is not a durable server audit record or a claim that other clients are prevented from submitting signup directly to Supabase.

Stride currently stores no terms/privacy acceptance version or acceptance timestamp in Auth metadata or a new database table. Durable recording is a separate proposal requiring owner approval and an intentional acceptance design. No IP address, browser/device fingerprint or other additional identifier is collected by Stride solely as consent evidence.

## Reporting problems

Share the app/browser version, steps and visible safe error when [reporting a bug](https://github.com/NotThatBoii/stride/issues). Do not post passwords, authorization headers, tokens, private notes or complete backup/recovery files publicly. The [data-safety review](https://github.com/NotThatBoii/stride/blob/main/docs/PHASE_7_DATA_SAFETY.md) distinguishes tested recovery behavior from unavoidable local-only loss.

This technical notice does not replace any legally required privacy information. Legal review is advisable before broad public use. Provider privacy information is available from [Supabase](https://supabase.com/privacy) and [Cloudflare](https://www.cloudflare.com/privacypolicy/).
