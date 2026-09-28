# Architecture and verification

## Preserved foundation

The original local implementation used React 19, strict TypeScript, Vite, CSS, Lucide icons, React context, and local view-state navigation. Subjects, session forms, timer recovery, local-midnight accounting, streak calculations, heatmaps, settings, and onboarding already worked. This pass retains that product logic and component structure.

The previous browser persistence stored a serialized dataset in localStorage. Version 0.3 adds a Tauri Windows shell around the same frontend and IndexedDB persistence. Production assets are embedded, with no HTTP server. The desktop WebView2 profile is separate from browser data; validated JSON export/import transfers records. Platform helpers provide native save/open dialogs and notifications while preserving browser behavior. The Windows CI workflow compiles and uploads an NSIS installer and standalone executable.

## Persistence

`StrideDatabase` declares the versioned Dexie schema. IndexedDB stores subjects, sessions, session/day allocations, preferences, timer state, and migration metadata separately. Compound allocation keys prevent duplicate session/day entries. Session saves, dependent deletion, and restore use read/write transactions.

On first initialization the old localStorage record is validated and copied atomically with an initialization marker. Its source is preserved. A failed migration cannot commit a partial database, and a completed migration never replays the obsolete backup. `liveQuery` keeps open views up to date, including changes from other tabs.

The [Phase 2 local sync foundation](PHASE_2_SYNC_FOUNDATION.md) documents the additive Dexie V2 schema, account workspace boundary, and deferred cloud protocol.

All analytics derive from saved sessions and daily allocations. Recovery state remains transient until the user saves a session. Completed active timer intervals exclude pauses; unpaused wall time is recovered when reopened. Countdowns cap at their target.

## Backup validation

Zod validates field types and bounds. Additional checks validate unique IDs, subject/session references, real calendar dates, session time ranges, allocation totals, and nonoverlapping timer intervals. A restore transaction only starts after validation. The user reviews record counts and confirms replacement; restored running timers are paused at export time. File uploads are limited to 25 MB.

## Design

The UI uses neutral graphite and charcoal surfaces, a limited indigo accent, 5px control corners, restrained separators, compact rows, and consistent typography. Home emphasizes daily progress before streaks and the quick-start action. Heatmaps are unboxed, retain keyboard interaction, and use an indigo intensity scale overall or the subject color on detail pages. Active focus sessions hide the sidebar while retaining a return action. History groups sessions by date and loads twenty at a time.

## Tests

- Analytics/timer tests cover streak gaps, threshold changes, local midnight, date transitions, subject separation, pauses, and countdown recovery.
- IndexedDB tests exercise migration, persistence after reopening, atomic save/cleanup, deletion, validated restore, duplicate/reference/date failures, and imported timer handling.
- Browser workflows cover onboarding, subject CRUD/archive/restore, actual study sessions, refresh recovery, editing, heatmap isolation, streak updates, navigation, themes, shortcuts, and export.
- A persistent browser profile is closed and reopened to verify records survive a real browser restart. JSON export/import is exercised through the UI.
- Screen checks cover Home, Subjects, Focus, History, Insights, and Settings at 1366, 1440, 1920, and 800 pixels, with overflow and console-error assertions. Screenshots are isolated test fixtures, never user data.

## Limits

No cloud sync, authentication, service worker, or scheduled notification after browser closure is implemented. Browser storage is scoped to the origin and can be removed through site-data clearing or eviction. Export is the backup mechanism. Navigation uses local view state, not URL routing.
