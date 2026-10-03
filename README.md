# Stride

**Build consistency, one session at a time.**

Stride is a study tracker for Windows and the web, built around subjects, real study sessions, streaks, and GitHub-style contribution heatmaps. A Supabase email/password account is required to enter the app. Study data stays in an account-scoped local IndexedDB workspace on each device; cloud synchronization is not implemented yet.

## Windows app — no server required

**[Download Stride for Windows](https://github.com/NotThatBoii/stride/releases/latest)** — choose the Windows setup executable under Assets, run it, and open Stride from Start. Share that release link with friends; no GitHub account is needed to download from this public repository. Published releases may predate the account-required entry flow described here.

Windows 10/11 x64 only. The installer downloads WebView2 if missing (internet required for that initial download). A portable ZIP and SHA-256 checksums are available on the same release. Portable means no installation; study data still lives in your Windows user profile. Builds are currently unsigned.

Once installed, open **Stride** from Start. Normal use needs no terminal, Node.js, or local server. The application files are embedded in the executable. Signing in requires a connection to Supabase. An existing unexpired session can restore through the official Supabase client while offline; a signed-out device or a session that cannot refresh stays at the authentication screen.

To move an authenticated workspace's history, choose **Settings → Export JSON** in the source app, then sign in and use **Settings → Import JSON** in the destination app. Web and desktop have separate local caches, even for the same account. Imports validate the file and ask before replacing that account's local data. Keep the export as a backup. Earlier anonymous history remains stored internally, but this entry flow does not expose or import it; explicit legacy recovery is deferred to Phase 5.

### Build the Windows app

Install the [Tauri Windows prerequisites](https://v2.tauri.app/start/prerequisites/): stable Rust, Visual Studio C++ Build Tools, a Windows SDK, and WebView2.

Configure the public Supabase variables described in [authentication setup](docs/PHASE_4_AUTH.md#local-setup) before building. Vite embeds them in the Windows executable; a build with missing or invalid configuration displays a configuration error and cannot open a study workspace. Release CI must supply the same public variables at build time.

```powershell
npm.cmd ci --legacy-peer-deps
npm.cmd run desktop:build
```

The installer is written to `src-tauri/target/release/bundle/nsis/`; the standalone executable is `src-tauri/target/release/stride.exe`. `npm.cmd run desktop:dev` starts the development server automatically. Only development needs a server. GitHub Actions builds an installer for source changes on `main` and retains development artifacts for 30 days. Pushing a version tag such as `v0.4.0` also publishes a permanent GitHub Release with the Windows installer, portable ZIP, and checksums. Update the package, Tauri, Cargo, and display versions together before tagging.

## Screenshots

![Stride overview](docs/screenshots/home-reference.png)

[Subjects](docs/screenshots/subjects.png) · [Subject activity](docs/screenshots/subject.png) · [Focus](docs/screenshots/focus-active.png) · [History](docs/screenshots/history.png) · [Insights](docs/screenshots/insights.png) · [Settings](docs/screenshots/settings.png) · [Light theme](docs/screenshots/narrow-light.png)

Populated screenshots use an isolated test fixture. Stride never adds sample study records to your workspace. [A fresh workspace](docs/screenshots/home-empty.png) starts with an empty activity graph.

## Features

- Create, rename, color, archive, restore, and delete subjects.
- Stopwatch and countdown sessions with pause/resume, titles, notes, and recovery after reopening.
- Overall and subject-specific heatmaps with intensity levels, year selection, tooltips, selected days, and keyboard navigation.
- Configurable Minimum Day, current and longest streaks, and daily progress.
- Date-grouped history with subject/date filters, editing, deletion, and incremental loading.
- Weekly comparisons, monthly totals, subject distribution, and eight-week trends.
- Neutral dark/light themes, compact subject rows, and a distraction-reduced active timer.
- Required sign-in or account creation, session restoration, and account-scoped local workspaces.
- Two-step account onboarding for subjects and Minimum Day, quick actions (`Ctrl/Cmd + K`), and recent-subject selection.
- IndexedDB persistence, JSON export, and validated JSON restore for the signed-in workspace.
- Optional Windows or browser notifications when a countdown ends while Stride is open.

## Tech stack

React 19 · TypeScript (strict) · Vite · Tauri 2 / Rust · Supabase Auth · Dexie / IndexedDB · Zod · Lucide · CSS.

The Windows app uses the system WebView2 runtime in a native Tauri window; the web version runs in ordinary browsers. Both share the study logic and interface. Native file dialogs and Windows notifications are enabled in the desktop app.

## Getting started

Use Node.js 22.12+ and npm.

```sh
git clone https://github.com/NotThatBoii/stride.git
cd stride
npm ci --legacy-peer-deps
cp .env.example .env.local
npm run dev
```

Set the public Supabase configuration in `.env.local` before starting; see [authentication setup](docs/PHASE_4_AUTH.md#local-setup). On PowerShell, use `Copy-Item .env.example .env.local` for the copy step. Open **http://127.0.0.1:1420**, then sign in or create an account. If confirmation is required, confirm the email before signing in.

Keep using the same browser and address: browser data belongs to its origin. `localhost`, `127.0.0.1`, and a hosted URL have separate account caches. JSON export/import transfers your authenticated workspace data between them.

## Development

```sh
npm test          # Analytics, timers, storage, validation, native file/notification handling
npm run test:e2e  # Browser workflows, restart persistence, and screen checks
npm run test:e2e:auth # Authentication gate and account-isolation browser checks
npm run test:db   # PostgreSQL/RLS/RPC contract checks
npm run build     # Strict TypeScript + production build
npm run preview   # Serve dist locally
npm run format    # Format source, tests, and configuration
```

Playwright tests use installed Microsoft Edge and fresh browser contexts. The restart test uses a temporary profile under ignored `test-results/`. Tests do not modify your actual browser workspace. Auth browser tests intercept Supabase requests and do not create hosted users or synchronize study data. See [verification and limits](docs/PHASE_4_AUTH.md#verification-and-limits) for the disposable local database integration suite.

Web production output is generated in `dist/` and can be served by a static web host. Public Supabase configuration is required at build time for both web and desktop. The web version has no service worker, so opening/reloading it requires its files to be reachable. The desktop build embeds those files and can open the authentication screen offline; workspace access still follows Supabase session restoration.

## Data storage and safety

Each Supabase user ID `U` selects the IndexedDB database `stride-account-U`, with versioned tables for subjects, sessions, daily allocations, settings, timer recovery, and workspace metadata. The app opens that account's workspace only after authentication bootstrap finishes. Windows stores these databases in Stride's persistent WebView2 profile under the user's local app data, normally `%LOCALAPPDATA%\com.philippaglinawan.stride`. Browser data belongs to the site's origin. Transactions keep session records and daily totals consistent. Streaks and insights are calculated from records. The desktop app uses single-instance handling to avoid competing windows.

Legacy anonymous history remains in the original `stride` IndexedDB database and, where present, the `stride-browser-preview-v1` localStorage dataset. The authenticated entry flow does not open, scan, migrate, merge, upload, or delete these datasets. Phase 5 will define explicit legacy import/recovery. Signing out immediately returns to authentication and preserves all local account caches, legacy data, and timer recovery.

While signed in, **Settings → Export JSON** downloads the current account's complete local workspace. **Import JSON** validates the format/version, field types, IDs, references, timestamps, timer intervals, and daily totals before asking to replace that workspace. Restoration is atomic, and restored timers are paused at export time. Import is disabled while a session is active. Export your current data before replacing it.

IndexedDB survives refreshes, browser restarts, and reopening the same origin. Clearing site data, browser profile loss, private browsing, or browser eviction can still remove it. Keep periodic exports. Signing in on a new device does not recover study records: there is no cloud backup or synchronization. Account isolation controls the app's visible workspace; it does not encrypt IndexedDB against someone with access to the browser or Windows profile.

### Session and streak rules

- Default Minimum Day: 20 minutes. Overall streaks combine **active** subjects; each subject requires the minimum within that subject.
- An incomplete today keeps yesterday's streak alive until midnight. A missed day restarts the current streak without removing past activity.
- Study intervals split at local calendar midnight and exclude pauses. Recorded day keys remain stable if you travel between timezones.
- An unpaused stopwatch counts elapsed wall time while the app is closed. Countdown recovery caps time at the target. Notifications require Stride to remain open.
- Text-only session edits preserve daily allocations. Time edits redistribute that session continuously from the selected start.
- Archiving excludes the subject from overall totals, but preserves its history and dedicated detail page. Restoring includes it again.

## Project structure

```text
src/
  auth/         Supabase session bootstrap and required authentication gate
  components/   Heatmap, subject rows, session rows, dialogs, onboarding
  pages/        Home, subjects, focus, history, insights, settings
  lib/          IndexedDB, backup validation, date/streak analytics, timer logic
  models.ts     Domain types
  state.tsx     React context, observable persistence, guarded mutations
  styles.css    Neutral themes, layout, typography, responsive behavior
tests/e2e/     Isolated workflows, persistence, and visual checks
docs/         Screenshots and architecture notes
```

Navigation remains the existing React view-state implementation. The top-level authentication gate sits outside the data provider: loading → authentication → account onboarding or main app. See [Phase 4.1](docs/PHASE_4_1_AUTH_REQUIRED.md) for entry-flow boundaries and deferred work.

## Roadmap

- Installable web app and offline application-shell caching.
- Explicit legacy anonymous-history import and account synchronization in Phase 5.
- Optional encrypted backup.
- Per-subject goals and additional keyboard commands.
- More browsers and accessibility checks in CI.

## License

MIT licensed. The original [LICENSE](LICENSE) is preserved unchanged.

Copyright © 2026 Philip Paglinawan.
