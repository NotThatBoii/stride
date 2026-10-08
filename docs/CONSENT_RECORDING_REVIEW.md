# Post-confirmation legal receipt implementation for review

The owner approved a separate implementation for review on **2026-10-07 (Asia/Manila)** after the security audit PR. Production deployment is **not approved**. [PR #10](https://github.com/NotThatBoii/stride/pull/10) is merged at main commit `afe2111cedcdb36448dfa161e0cdc768f6b8dae5`. [PR #11](https://github.com/NotThatBoii/stride/pull/11) is rebased directly onto that main and stays draft/unmerged. The original follow-up patch was preserved identically before documentation/CI cleanup; no security-audit implementation is repeated in this diff. It does not tag, publish, run hosted SQL, change Auth settings or change Cloudflare configuration.

## User behavior

The original unchecked signup agreement remains required. Ordinary sign-in, study, sync and local recovery stay available without a server receipt. After email confirmation, Account offers an optional, separate active acknowledgment of the current Terms/Privacy pair. Opening Account reads only; opening a legal link, restoring a session or signing in never records acceptance. No existing account is backfilled or automatically treated as having accepted changed documents.

The app displays a receipt only after receiving a valid server response for the same account and document pair. It keeps receipt state in component memory, separate from SDK credentials and study/export storage. Offline or unavailable recording gives fixed retry guidance without inventing a timestamp or blocking study. A second device can read the same server receipt; repeated acceptance preserves the first timestamp.

Both bundled legal documents are version **2026-10-07**, reflecting the new receipt transparency. The security PR remains frozen at **2026-10-06**. Older prototype SQL/tests under docs/proposals retain their historical version and are not the implementation migration.

## Server boundary

The review migration is `supabase/migrations/20261007000000_stride_legal_acceptances.sql`. The new private table contains only owner identity, Terms version, Privacy version and first server receipt time. `auth.uid()` supplies identity; trusted `auth.users.email_confirmed_at` must be present. Only the exact current version pair is accepted. Clients cannot supply an owner, timestamp or direct table mutation. No IP address, device/browser fingerprint, email copy, password or token is collected in a receipt.

The public read/write RPCs are invoker wrappers over qualified private definer cores with empty search paths. Anonymous/PUBLIC execution is revoked. The private schema remains excluded from the Data API. Clients have no direct table access; owner reads return only the version pair and timestamp. Account deletion cascades receipt removal. Privileged administrators can still administer rows; receipts do not establish human identity, document comprehension, original signup time or cryptographic tamper evidence.

No existing sync table/function grant is broadened. Current study synchronization and backups do not include these receipts. The new SQL is a reviewable file, not evidence that hosted production has the table.

## Validation

The complete local run finished **2026-10-07T12:25:19.882Z / 2026-10-07 Asia/Manila**. All **204 unit**, **6 release configuration**, **20 SQL/RLS**, **3 archived proposal** and **107 unique browser** cases passed. Browser counts are 7 regression, 41 Auth (nine new receipt cases), 15 sync, 12 hardening/mobile, 3 recovery, 17 stress, 6 performance and 6 compiled PWA. One optional PWA OS-install check is skipped; physical native/assistive-device checks are not claimed. Production build and credential guards passed. Existing Phase 5/6/7 and security audit screenshots/measurements were restored byte-for-byte; complete fresh logs and generated measurements are under ignored work/consent-review/.

The four new SQL contracts execute the actual migration in disposable PGlite databases and verify roles/ownership/trusted confirmation/current versions, no-write reads, timestamp replay, denied table writes, non-destructive rollback and unchanged sync grants/feed/clocks. The real integration additions test concurrent first acknowledgments, cross-account isolation and an unconfirmed authenticated JWT against the loopback Supabase stack. The JWT is signed in memory from that stack's own secret, passed only to the test child, never from hosted credentials and never printed or saved. Docker/Supabase is unavailable locally; real HTTP/SDK and Windows verification therefore use CI. **Final-head CI results are recorded on the follow-up PR**, not inferred from local contracts. Expected real HTTP count is 13 TAP including parent / 12 nested plus six existing SDK cases.

Full and production-only npm audits report zero vulnerabilities. The current source/available reachable history and both 20-file web/PWA output scans found zero unreviewed credential patterns, source maps or debugging hooks. Only the existing exact negative fixtures are exempted; scanning is finite pattern matching, not proof that every unknown credential form is absent. Dependency versions and native capabilities/CSP remain those of the security baseline.

The new bundle's main JavaScript is 755.18 kB / 222.08 kB gzip, versus the security candidate's 752.98 / 221.47 kB. A fresh matched timing comparison uses production loopback Edge, mock Auth/intercepted RPC and the unchanged study SQL fixture, not hosted, physical-phone or Windows UI latency:

| 10k measurement | Fresh security baseline | Full consent run | Consent repeat |
| --- | --- | --- | --- |
| App ready | 703 ms | 747 ms | Not repeated |
| Initial pull | 37,270 ms | 37,438 ms | 38,311 ms |
| 100 incremental edits | 2,955 ms | 2,993 ms | 2,962 ms |
| Export | 755 ms | 709 ms | 661 ms |
| Same-file import including required backup | 8,053 ms | 9,671 ms | 9,458 ms |

All pulls use 102 pages / 10,021 changes; all incremental batches use 100 operations. The identical 5,487,199-byte backup restores 10,100 sessions / 12,120 allocations, with zero duplicate applies or unfinished responses. The higher initial-pull time compared with the previous day's security run also appeared in the fresh baseline, so that older timing does not establish a consent regression. Import wall time is higher in these consent runs despite unchanged import code and request/query counts; retain this measurement for monitoring without attributing a cause or claiming statistical performance equivalence. The completed cases have no functional failure or demonstrated new security blocker.

## Approval and future deployment order

The exact target, migration digest, catalog checks, live verification and rollback are in [the production deployment approval plan](CONSENT_RECORDING_DEPLOYMENT.md). That plan is prepared for approval and has not been executed. Fresh CI includes the six existing performance cases in addition to the other frontend, real integration and Windows checks; results are recorded on PR #11.

Approval of implementation for review does not authorize a production migration. Before any hosted deployment, present the exact reviewed app/SQL commit, target project, read/write verification and rollback for explicit approval. Confirm the rebased PR #11's final checks and owner review. Apply approved SQL before enabling the reviewed frontend; verify private-schema non-exposure and same-owner/foreign-owner/anonymous behavior using disposable accounts. Do not infer production readiness from local test fixtures.

## Rollback without erasing evidence

Revert the new Account receipt UI/client feature while retaining the required signup checkbox and documents. In a separately approved transaction, disable the new receipt-write execution only:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.record_legal_acceptance(text, text),
  stride_private.record_legal_acceptance_core(text, text)
FROM authenticated;
COMMIT;
```

Keep the owner-only read RPC available so existing receipts remain readable. Preserve the receipt table, policies, timestamps and existing study/sync permissions. Do not drop/truncate rows or erase accounts as a rollback. Any later removal or retention-policy change needs separate review and approval. Reenable only the exact reviewed functions and matching document allowlist, with replay verification.
