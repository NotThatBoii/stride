# Phase 6 retention and stale-device proposal

**Status: design only.** Phase 6 does not change hosted SQL, delete server history, expire operation receipts, or prune local recovery copies. The existing Phase 3 RPCs and unpruned ordered feed remain authoritative. This proposal requires a separately reviewed server/client change and explicit approval before activation.

## Why a time-based delete is unsafe

The current cursor is an account-scoped decimal sequence. Each accepted operation keeps an immutable receipt, and each changed record keeps a monotonic revision even after deletion. A device retries a submitted request with its original UUID and frozen body. Its cursor advances only after an entire pull page commits locally.

Subject deletion has an additional recovery guarantee: a child created after the deleting device's final pull can be cascaded by its later parent delete. The ordered feed subsequently delivers that child's complete upsert and its tombstone. The client preserves the otherwise unknown session and its original day allocations as a selectable recovered conflict. A live-record snapshot after those changes contains no child. Deleting the upsert from the feed would delete the only surviving recovery branch.

Receipt age, device inactivity, a missing receipt lookup, cancellation, sign-out, and an expired lease do not prove that a submitted request never committed. A delayed original request may still arrive. Deleting receipt/version identities can also make an old UUID execute again or allow a null-base request to recreate a previously deleted ID.

## Proposed retention model

| Material                                                                 | Recommended initial policy                                                       | Required guarantee                                                                                                                                                                                                           |
| ------------------------------------------------------------------------ | -------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Live subjects, completed sessions, exact allocations, shared preferences | Retain until explicit user deletion/account deletion                             | Study data is not an activity log. Archiving a subject does not remove history.                                                                                                                                              |
| Record-version identities and tombstones                                 | Retain for the lifetime of the account                                           | Deleted IDs retain their last revision; restoration uses that revision and increments it. Never reuse a revision or treat an old deleted ID as a fresh null-base create.                                                     |
| Operation UUID, request hash, terminal outcome                           | Retain for the lifetime of the account                                           | Replays cannot execute a second mutation. Preserve the exact prior result, or losslessly reconstruct it from an immutable referenced version.                                                                                |
| Full receipt bodies                                                      | Keep current bodies initially; evaluate lossless compaction separately           | Conflict snapshots must remain recoverable. A compact proof with an unavailable payload must not be interpreted as an unknown/fresh operation.                                                                               |
| Ordered change feed                                                      | Keep unpruned until the versioned recovery protocol below is deployed and proven | A stale cursor receives an explicit recovery response, never an empty success or a skipped range.                                                                                                                            |
| Deletion recovery bundles                                                | Initially retain indefinitely, per deletion generation                           | Save parent context, every affected child's last live payload and allocations, prior/deleted revisions, change sequences, and originating operation UUID. Repeated restore/delete must not replace an earlier unseen branch. |
| Temporary snapshot pages                                                 | Expire only after a bounded download lease, with restart available               | Expiration removes a disposable server stage, not the device's local outbox, conflicts, timers, or preserved versions.                                                                                                       |
| Local outbox, conflicts, timers, recovery copies                         | No automatic expiry in Phase 6                                                   | Export and explicit guarded repair/resolution precede any removal of the sole surviving copy.                                                                                                                                |

An illustrative future policy is a 90-day active-device lease and a minimum 90-day feed window. These are **unapproved examples, not configured values or a claim that 90 days proves safety**. The eligible feed floor must also respect every unexpired device's durable acknowledged cursor and every active snapshot's pinned replay suffix. Lease expiry selects the snapshot-recovery path; it does not authorize erasing study/recovery data. Measure edit, conflict, deletion-bundle and proof growth before choosing durations.

The first useful compaction target is repeated edit history. Indefinite compact proofs, tombstone identities and deletion bundles still grow with account activity; the model does not promise constant storage. If that growth becomes material, require an explicit backup/export and a separately approved loss-of-history policy rather than silently weakening recovery.

## Required server/RPC changes

Use new versioned RPC names; Phase 5 parsers intentionally reject malformed/unknown response shapes. Proposed names describe responsibilities, not implemented endpoints:

1. `get_sync_manifest_v2` returns authenticated account epoch, retained cursor floor and current head. Requests below the floor, from another epoch, or above the head fail with an explicit recovery requirement. Publishing a new floor and pruning its eligible prefix must be atomic.
2. `begin_sync_snapshot_v2` creates an account-bound, immutable snapshot at high-water cursor `H`. Materialize/freeze its pages in one consistent server transaction. Filtering mutable live rows by revision/sequence is insufficient: a record edited or deleted between pages otherwise disappears or changes beneath the snapshot.
3. `read_sync_snapshot_page_v2` returns bounded authenticated pages, completeness metadata, and a deterministic digest/count manifest. Include live data, complete session allocations, shared preferences, version/tombstone identities, and required deletion recovery bundles. Pin changes after `H` until the snapshot lease finishes/expires.
4. `ack_sync_device_v2` accepts an authenticated device acknowledgement only after the client has durably committed its cursor. Device IDs identify caches, not users; `auth.uid()` continues to determine the owner. Do not trust a client-supplied owner or expose private schemas.
5. `get_operation_proof_v2` retrieves account-scoped immutable UUID/hash/outcome proofs. Unknown outcomes remain paused. If replacement of a genuinely missing proof is needed, an atomic server fence must ensure every delayed original request is rejected before mutation. Fence/proof checks and every mutation use the same account serialization boundary, with receipt checks repeated after acquiring it.
6. `apply_sync_operation_v2` validates epoch/lease/fence before any new mutation, while allowing authenticated replay of known terminal proofs. The UUID/body of an uncertain request remain unchanged. Every old mutation endpoint must either retain an unpruned safe protocol or fail closed with an upgrade requirement; an old client cannot bypass v2 protections.

Before feed truncation, create immutable deletion bundles for existing retained history, including legacy cascade sequences. A prospective alternative is a **parent subtree revision precondition**: increment it for every child creation, edit, allocation change, deletion, and move affecting either parent, and check it under the same account lock before deleting. This prevents future unseen-child cascades but cannot reconstruct earlier ones. Do not rely on that change alone to discard legacy recovery payloads.

All tables/functions, indexes, grants/RLS, quotas for simultaneous snapshot stages, lease cleanup, and error codes need a migration design and contract tests. Nothing in this document grants deployment approval.

## Returning-device recovery

1. Stop new uploads when the manifest rejects the cursor/epoch. Keep local study records, original allocations, pending/frozen requests, conflicts, timers, revisions and recovery copies. Offer a study/recovery export; never include Auth credentials in it.
2. Download the immutable snapshot into an inert, resumable local stage bound to the account and workspace generation. A partial stage is never visible study data and never advances the active cursor. Expired pages restart against a fresh snapshot without discarding the local branch.
3. Verify page order, counts, digests, complete parent/session/allocation relationships, and terminal cursor. Reconcile against the **latest** local data, including edits made while downloading. Freeze writes briefly under the account lock for final adoption, or use a recoverable generation switch.
4. Link normalized equivalent records. Preserve divergent same-ID records as explicit conflicts. Local-only creations may queue a null base only when the server has no live or tombstoned identity. A server deletion must not silently erase an offline edit, paused timer, pending child, moved child, or unseen cascade recovery bundle.
5. Resolve every submitted operation through its immutable proof/exact replay. Never replace an unknown frozen request merely because the snapshot looks equivalent, or because the old receipt payload expired. Only an authoritative no-commit proof/fence plus an explicit repair choice permits preservation and requeue under a new UUID.
6. Commit reconciled records, revisions, conflicts/recovery material, epoch and cursor `H` atomically. Send the durable acknowledgement afterward. Replay the pinned suffix from `H` before submitting new mutable work. A crash after local commit but before acknowledgement replays safely; it does not force another destructive adoption.

Timers remain device-only. Retain their segments and parent branch during recovery. Historical allocation day keys retain the originally recorded calendar days across timezone changes.

## Account deletion and device reset

Sign-out/account switching remove credentials and suspend the account worker; they are not permission to delete its cache. Recovery stages, tokens, proofs and adoption transactions must reject an account/workspace generation change, including switch-away/switch-back races.

Actual authenticated account deletion currently cascades all owner-scoped server tables through `auth.users`. A future account-deletion UX must explain that cloud study and recovery history will be deleted, offer an export, and require explicit confirmation. Existing offline device copies are not magically erased; a deleted identity must fail Auth and cannot upload them into a different account.

A device reset should first inspect pending/unknown requests and save an export/recovery copy. Removing only a confirmed clean local cache can then reload the cloud through the same snapshot protocol. Resetting a cache must never become a shortcut for discarding unresolved conflicts or uncertain requests. Full local deletion of the only surviving branch requires explicit informed user choice after preservation.

## Approval and proof gate

Before any production pruning, obtain approval for the specific migration/RPC contract, compatibility rollout, proposed durations and limits, and recovery/export behavior. Test locally, then with disposable hosted accounts; deploy client recovery support before enabling a floor, and preserve rollback compatibility. Keep pruning disabled if a proof case fails.

Required tests include stale/future/wrong-epoch cursors; live edits/deletes between snapshot pages; page expiry and malformed manifests; crash before/after adoption and acknowledgement; account switch during download/commit; local edits during download; missing/expired receipt payloads and delayed requests across a fence; lost acknowledgements; repeated UUID/hash mismatch; old-client rejection; null-base resurrection attempts; offline parent/child edits; moved children; timer preservation; repeated delete/restore generations; legacy cascade upsert→tombstone after compaction; two accounts' isolation; and original day allocations across DST/timezone differences. Also measure snapshot staging space and deletion/proof growth under repeated edits and deletions.

**Phase 6 outcome:** a reviewed proposal and measured growth report. Retention implementation belongs in a separately approved phase/PR; current server history and receipts remain intact.
