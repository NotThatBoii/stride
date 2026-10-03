# Phase 2 local sync foundation

> Historical phase report. [Phase 5](PHASE_5_SYNC.md) now implements the worker, authenticated RPC adapter, incremental pulls, conflict resolution, and explicit legacy/JSON import on these sidecars. Phase 2's statements about unsent operations and future sync work describe its original boundary; the Phase 5 report documents current behavior.

## Database layout and migration

`StrideDatabase` in `src/lib/local-database.ts` keeps Dexie version 1 and adds version 2. The existing six tables and their keys remain intact:

| Table         | Primary key        | Secondary indexes          | Purpose                                            |
| ------------- | ------------------ | -------------------------- | -------------------------------------------------- |
| `subjects`    | `id`               | `archived`, `created_at`   | Study subjects                                     |
| `sessions`    | `id`               | `subject_id`, `started_at` | Completed study sessions                           |
| `slices`      | `[session_id+day]` | `session_id`, `day`        | Per-local-day session allocations                  |
| `preferences` | `id`               | None                       | Settings at key `1`                                |
| `timers`      | `id`               | None                       | Recoverable active timer at key `1`                |
| `meta`        | `key`              | None                       | Initialization marker and local migration metadata |

Version 2 adds these sidecar tables without rewriting study records:

| Table               | Key and indexes                                                         | Stored fields                                                                                |
| ------------------- | ----------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| `pendingOperations` | `++sequence`, unique `id`, `[entity+record_id]`, `status`, `created_at` | UUID `id`, `entity`, `record_id`, `action`, `payload`, `base_revision`, `status`, timestamps |
| `recordRevisions`   | `[entity+record_id]`, `entity`, `record_id`                             | Last `server_revision`, `updated_at`                                                         |
| `syncCursors`       | `stream`                                                                | `cursor`, `updated_at`                                                                       |
| `conflicts`         | `id`, `[entity+record_id]`, `created_at`, `resolved_at`                 | Local and remote snapshots, base and remote revisions, resolution time                       |
| `recoveryCopies`    | `id`, `[entity+record_id]`, `created_at`                                | Snapshot, reason, optional entity and record ID                                              |
| `syncMetadata`      | `key`                                                                   | String `value`, including `owner_account_id`                                                 |

Study records retain their original IDs and shapes; migration does not copy, clear, or relabel V1 rows. Dexie upgrades the schema in place. Reopening and repeated initialization do not replay legacy localStorage data or generate operations from historical records.

The existing `stride` IndexedDB database is the anonymous workspace. Account databases are named `stride-account-${accountUuid}` after validating and lowercasing the opaque UUID. This physical separation permits the same subject or session ID in different accounts without changing V1 primary keys or foreign keys. Creating or selecting an account database does not claim, copy, or upload anonymous records. The legacy `stride-browser-preview-v1` localStorage import runs only for the anonymous database and retains its original source. Account databases start empty with their own settings and an `owner_account_id` guard in `syncMetadata`.

## Workspace isolation

The active workspace defaults to anonymous. `selectWorkspace(accountUuid | null)` changes the active database, and `getActiveWorkspace()` and `getActiveDatabase()` expose the current selection to internal code. Selection increments a generation; the React provider replaces its `liveQuery` subscription, ignores results from prior generations, and remounts workspace-local UI state. Cached Dexie instances remain available for later selection. Future sign-out should call `selectWorkspace(null)`. Cached records for a prior account cannot remain visible through the app after switching. This is application-level isolation within the same browser or Windows profile, not encryption or an operating-system access boundary.

All relationships remain inside one database: `sessions.subject_id` refers to that database's `subjects.id`, and each `slices.session_id` refers to that database's `sessions.id`. Session saves replace daily allocations in the same transaction as the session. Deletions remove dependent allocations in that transaction. Local-midnight slices remain the basis for heatmaps, streaks, and analytics; a future server must preserve those recorded day keys rather than recomputing history in another time zone.

## Synchronization sidecars

| Logical record    | Contents and role                                                                                                                                                                                                                                                                      |
| ----------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pending operation | `subject`, `session`, or `settings` upsert/delete; a UUID `id`, auto-increment `sequence`, record ID, payload, base revision, `pending`/`in_flight` status, and timestamps. Session payloads contain both the session and its slices. Retry must reuse the UUID as an idempotency key. |
| Record revision   | Last acknowledged `server_revision` for one entity and record ID. This is a future write precondition, not a local edit counter.                                                                                                                                                       |
| Sync cursor       | The account's last fully applied cursor per server stream. Phase 3 must advance it with the corresponding local changes in one transaction.                                                                                                                                            |
| Conflict          | Local and remote snapshots, base and remote revisions, creation time, and optional resolution time. Phase 3 must preserve disagreement before resolution.                                                                                                                              |
| Recovery copy     | A snapshot with reason `json_restore`, `conflict`, or `remote_apply`, and optional entity/record ID. JSON restore preserves prior study data here before replacement.                                                                                                                  |
| Sync metadata     | Account-scoped string key/value data, currently `owner_account_id`. It must not hold credentials.                                                                                                                                                                                      |

Only mutations in an account workspace create pending operations. Anonymous activity, initialization, timer checkpoints, and schema upgrades do not. Subject, session, settings, and deletion mutations commit records and operations in one Dexie transaction. Session and allocation changes are one logical operation so retries cannot detach a session from its daily totals. Repeating an unchanged save does not add an operation. A changed save coalesces into an existing `pending` operation for the same entity and record, keeping its UUID; an `in_flight` operation remains intact and a new `pending` operation can follow it. No operation is sent or acknowledged in Phase 2.

The active timer is local recovery state. It is never queued or sent. Saving a completed timer creates a session and daily allocations, and only those durable records enter an account's pending operations.

## Backup compatibility and data safety

Version 1 JSON backups remain valid. Their `subjects`, `sessions`, `slices`, `settings`, and paused-at-export `running` timer data are validated before restore. Export and restore operate on the active workspace only. Restore preserves a recovery copy when it replaces existing study records. In an account workspace it queues operations for changed or removed records in the same transaction; an anonymous restore remains local. A restore does not clear another database or existing sync sidecars. The existing 25 MB import limit and referential, date, allocation-total, and timer checks remain in force.

The main migration hazards are global reads and clears, singleton preferences and timer keys, stale React state during account switching, ID collisions if account records share a physical table, and outbox entries committed apart from study records. The separate-database design contains IDs and singletons per workspace. Explicit transactions protect study records, allocations, and operation entries from partial writes. Existing users' anonymous database stays at the same name and retains all records without an account.

## Phase 3 integration

Phase 3 should connect authentication to the workspace selector using the provider's canonical account UUID, keep tokens outside IndexedDB sync metadata, and define an explicit user-approved path for importing or linking anonymous history. Its worker should process only the active account's pending operations in sequence, send the stable operation ID to the server for idempotency, use server revisions for conditional writes, and atomically commit acknowledgment with the new local revision. It must recover `in_flight` operations after interruption without changing their UUID. Pulls should apply records and advance the cursor atomically. On revision disagreement, preserve both versions in a conflict entry and retain a recovery copy before resolution. Server schema and policies must enforce account ownership and preserve session-to-subject and session-to-allocation relationships. Phase 2 performs no authentication, Supabase initialization, or cloud network requests.
