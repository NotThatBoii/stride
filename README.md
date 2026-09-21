# Stride

**Build consistency, one session at a time.**

Stride is a local-first study tracking web application built around subjects, real study sessions, streaks, and GitHub-style contribution heatmaps. Track individual subjects or see your overall activity, then review the patterns in your study history. No account is required.

## Screenshots

![Stride overview](docs/screenshots/home.png)

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
- Three-step onboarding, quick actions (`Ctrl/Cmd + K`), and recent-subject selection.
- IndexedDB persistence, automatic migration from the earlier browser storage, JSON export, and validated JSON restore.
- Optional browser notifications when a countdown ends while Stride is open.

## Tech stack

React 19 · TypeScript (strict) · Vite · Dexie / IndexedDB · Zod · Lucide · CSS.

Stride runs in the browser. No Tauri, Electron, native toolchain, account service, remote font, or analytics service is needed.

## Getting started

Use Node.js 22.12+ and npm.

```sh
git clone https://github.com/NotThatBoii/stride.git
cd stride
npm ci --legacy-peer-deps
npm run dev
```

Open **http://127.0.0.1:1420**. Keep using the same browser and address: browser data belongs to its origin. `localhost`, `127.0.0.1`, and a hosted URL have separate workspaces. Export/import transfers your data between them.

## Development

```sh
npm test          # Analytics, calendar accounting, timers, storage, validation
npm run test:e2e  # Browser workflows, restart persistence, and screen checks
npm run build     # Strict TypeScript + production build
npm run preview   # Serve dist locally
npm run format    # Format source, tests, and configuration
```

Playwright tests use installed Microsoft Edge and fresh browser contexts. The restart test uses a temporary profile under ignored `test-results/`. Tests do not modify your actual browser workspace. Windows GitHub Actions run the same checks.

Production output is generated in `dist/` and can be served by a static web host. This repository does not configure hosting or a service worker; opening/reloading the app still requires its files to be reachable. Once loaded, all study operations run locally without a backend.

## Data storage and safety

The browser's IndexedDB database `stride` contains versioned tables for subjects, sessions, daily allocations, settings, timer recovery, and migration metadata. Transactions keep session records and daily totals consistent. Streaks and insights are calculated from the records rather than stored as competing totals. Changes are observed across tabs.

The previous `stride-browser-preview-v1` localStorage dataset is validated and migrated once, transactionally. The original copy remains untouched as a migration backup; it is no longer updated. Invalid old data produces an error rather than silently resetting the workspace.

**Settings → Export JSON** downloads the complete workspace. **Import JSON** validates the format/version, field types, IDs, references, timestamps, timer intervals, and daily totals before asking to replace the current workspace. Restoration is atomic, and restored timers are paused at export time. Import is disabled while a session is active. Export your current data before replacing it.

IndexedDB survives refreshes, browser restarts, and reopening the same origin. Clearing site data, browser profile loss, private browsing, or browser eviction can still remove it. Keep periodic exports. There is no cloud backup or synchronization.

### Session and streak rules

- Default Minimum Day: 20 minutes. Overall streaks combine **active** subjects; each subject requires the minimum within that subject.
- An incomplete today keeps yesterday's streak alive until midnight. A missed day restarts the current streak without removing past activity.
- Study intervals split at local calendar midnight and exclude pauses. Recorded day keys remain stable if you travel between timezones.
- An unpaused stopwatch counts elapsed wall time while the app is closed. Countdown recovery caps time at the target. Closed browsers do not send scheduled notifications.
- Text-only session edits preserve daily allocations. Time edits redistribute that session continuously from the selected start.
- Archiving excludes the subject from overall totals, but preserves its history and dedicated detail page. Restoring includes it again.

## Project structure

```text
src/
  components/   Heatmap, subject rows, session rows, dialogs, onboarding
  pages/        Home, subjects, focus, history, insights, settings
  lib/          IndexedDB, backup validation, date/streak analytics, timer logic
  models.ts     Domain types
  state.tsx     React context, observable persistence, guarded mutations
  styles.css    Neutral themes, layout, typography, responsive behavior
tests/e2e/     Isolated workflows, persistence, and visual checks
docs/         Screenshots and architecture notes
```

Navigation remains the existing React view-state implementation. Domain types, timer accounting, and analytics were preserved during the redesign.

## Roadmap

- Installable web app and offline application-shell caching.
- Optional encrypted backup and synchronization.
- Per-subject goals and additional keyboard commands.
- More browsers and accessibility checks in CI.

## License

MIT licensed. The original [LICENSE](LICENSE) is preserved unchanged.

Copyright © 2026 Philip Paglinawan.
