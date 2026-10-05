# Stride 1.0.0 — candidate release notes

Stride brings account-based, local-first study tracking to Windows and the web. Publication requires the owner's approval and completion of the release gates; changing version metadata does not certify those gates.

## Install and upgrade

Windows 10/11 x64. Download **Stride_1.0.0_x64-setup.exe**, or extract **Stride_1.0.0_Windows-x64-portable.zip** and open `stride.exe`. The installer can download WebView2 when missing; portable requires it already installed. Verify both downloads against `SHA256SUMS.txt`. Builds are unsigned.

Export a JSON backup before upgrading and keep it outside the app profile. The ordinary application identifier and data profile are unchanged. Published v0.4.0 history was anonymous: the new account-required edition asks you to sign in and explicitly import that retained history. It is not imported automatically.

## Study and synchronize

- Subjects, stopwatch/countdown sessions, history, streaks, heatmaps, and insights.
- Email/password account, confirmation, and separate local account workspaces.
- Locally saved study actions, offline queue, and cloud synchronization of completed history and shared preferences.
- Preserved conflicts with explicit version selection or **Keep both**.
- Reviewed additive backup/legacy imports and local recovery-copy inspection/export.
- Offline web shell and explicit updates that wait for unsaved work and timers.
- Faster large-history views, practical keyboard fixes, and safe file-error messages.

## Data and limits

Active timers and recovery copies stay on their device. Sign-out hides history but preserves the local cache. Browser storage removal or **Delete app data** during uninstall can lose unsynced changes, timers, and local recovery copies. Synced completed history can download again after sign-in. Backups contain readable private study data.

Phone installation and standalone behavior require the physical-device checklist. Notifications require the app to remain open. Large first syncs may take time. No change-feed/receipt pruning, database migration, or application identifier change is part of Phase 7.

Read [data behavior](DATA_AND_PRIVACY.md), [the release validation report](PHASE_7_RELEASE.md), and [the reusable release checklist](RELEASE_CHECKLIST.md). Use [GitHub Issues](https://github.com/NotThatBoii/stride/issues) for bugs without passwords, tokens, or private backups.
