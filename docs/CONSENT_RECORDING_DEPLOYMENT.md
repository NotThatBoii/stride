# Production consent receipt migration — approval plan

Status: **NOT DEPLOYED. Explicit owner approval required.** This is a review plan, not permission to execute hosted commands. PR #10 is merged into main at `afe2111cedcdb36448dfa161e0cdc768f6b8dae5`; PR #11 targets that main and remains draft/unmerged. Fresh final-head CI is recorded on PR #11.

## Exact target and SQL

- Production project reference: **`fotgomkjwbahxmmovzmn`**.
- API origin: **`https://fotgomkjwbahxmmovzmn.supabase.co`**.
- Target comes from checked-in `config/supabase-public.json`; the local `supabase/config.toml` project label is not the production selector.
- Exact one-time migration: [20261007000000_stride_legal_acceptances.sql](../supabase/migrations/20261007000000_stride_legal_acceptances.sql).
- SHA-256 of the reviewed UTF-8/LF SQL: **`1d172275cba664f4973953982ffa53f4eb2cad7cadd026f5227933ebd3729907`**.
- Migration history version: **`20261007000000`**.
- Current Terms / Privacy pair: **`2026-10-07` / `2026-10-07`**.

The migration bytes are unchanged from the previously tested consent implementation. Approval must identify the final reviewed PR head, this digest, target and the verification/rollback below. The current production catalog, migration ledger and credentials have not been queried during this retarget task. No production change or credential entry has occurred.

## Security and data behavior

One transaction creates `stride_private.stride_legal_acceptances` with `owner_id`, `terms_version`, `privacy_version`, `accepted_at`, a unique owner/version-pair primary key and an `auth.users` foreign key with account-deletion cascade. It creates one authenticated owner SELECT policy, two private cores and public `get_legal_acceptance` / `record_legal_acceptance` wrappers.

Both cores derive `auth.uid()` and require a trusted non-null `auth.users.email_confirmed_at`; only the exact current pair is accepted. No owner or timestamp argument exists. Reads return null or exactly the current owner's versions/time and never insert. Writes use server statement time and preserve the first receipt on repeated/concurrent requests. This establishes receipt of a post-confirmation acknowledgment, not original signup time, document comprehension or proof of a particular human's UI interaction.

RLS is enabled. Clients receive no direct table privileges and no write policy. The owner-read policy is an additional guard for any future separately reviewed SELECT grant; current access is through the RPCs. Public wrappers are invokers; private cores are definers owned by the trusted migration role, with empty search paths and qualified objects. The definer ownership/confirmation/version checks are the immediate boundary. PUBLIC/anonymous EXECUTE is revoked; authenticated EXECUTE is granted only on these four safe functions. Existing authenticated private-schema USAGE is retained; no schema CREATE or exposure is added. Administrators can administer rows; receipts are not cryptographically tamper-evident.

No study table, existing sync function/grant, Auth metadata, password/token store, active timer, export or recovery data is changed. No IP/fingerprint/email copy is stored in a receipt. Signup consent remains required; the additional post-confirmation record is optional and never blocks study or ordinary sign-in.

## Approval-time preflight — stop on any deviation

1. Verify the approved commit and SQL digest in a clean checkout, green complete CI and the exact project selector. Use credentials entered privately by the owner/operator; never paste passwords, tokens or connection strings into chat, commits or public logs. Confirm a usable operator recovery/backup arrangement.
2. Run the PREFLIGHT sections of [metadata verification SQL](CONSENT_RECORDING_VERIFICATION.sql) as a trusted migration operator. They return catalog information only, no study/Auth user rows. The private schema/base sync objects must already exist; the receipt table and all matching function names/overloads must be absent.
3. The migration role must be able to create/own objects in public/private schemas and SELECT/REFERENCES `auth.users`. Authenticated must have private-schema USAGE; API roles must not have private-schema CREATE. Verify `stride_private` remains excluded from exposed Data API schemas in the target's current settings and with the targeted HTTP check. A null SQL configuration value alone does not prove API exposure.
4. Save existing sync definition/grant fingerprints from the verification SQL for postcomparison. Check the remote migration ledger. The dry run must list **only** the reviewed `20261007000000` migration. Stop for any older pending file, collision, unexpected overload, ledger drift, wrong project or missing prerequisite. Do not repair history, replace existing objects or broaden settings automatically.

## Proposed execution after approval only

The pinned CLI is **2.118.0**; its local help confirms `--project-ref`, `--dry-run` and `--skip-vault`. Local help inspection is not a remote dry run. The CLI describes potential Vault synchronization by default, so `--skip-vault` is mandatory even for the dry run. This approval scope excludes Vault/configuration, roles, seed data and other migrations.

From the approved clean checkout, with private operator authentication:

```powershell
node ./node_modules/supabase/dist/supabase.js migration list --project-ref fotgomkjwbahxmmovzmn
node ./node_modules/supabase/dist/supabase.js db push --project-ref fotgomkjwbahxmmovzmn --skip-vault --dry-run
# Only after the exact one-file result is checked and deployment is approved:
node ./node_modules/supabase/dist/supabase.js db push --project-ref fotgomkjwbahxmmovzmn --skip-vault
```

No `--include-all`, roles, seed, remote reset or configuration push is authorized. CLI push tracks successful migration versions; pasting SQL in Dashboard alone does not establish matching CLI history. If the connection fails near commit, inspect schema and ledger before deciding what happened; never blindly rerun this non-idempotent CREATE script or mark it applied without review. These commands have **not** been run against production. [Supabase migration tracking](https://supabase.com/docs/guides/deployment/database-migrations), [CLI push/dry-run reference](https://supabase.com/docs/reference/cli/supabase-db-push).

## Post-deployment verification included in the proposed scope

1. Run the POSTCHECK catalog sections. Expect one private RLS table, one owner SELECT policy, zero client table privileges, four exact two-text-argument/jsonb functions, only private definers, trusted matching owners and empty search paths. Anonymous EXECUTE must be false and authenticated true. Existing sync fingerprints must match the preflight. Check ledger version `20261007000000` and an empty follow-up dry run.
2. Use two owner-authorized confirmed disposable accounts and keep their SDK credentials local. With `p_terms_version` and `p_privacy_version` both `2026-10-07`, initially read each owner's current receipt; reads create nothing. Explicitly acknowledge as A, read/replay it and verify the same first timestamp, including a second-device/session read. B must not receive A's receipt; B's explicit acknowledgment creates its own record. Responses contain only versions/time. No account backfill or personal-account deletion is part of verification.
3. Anonymous calls, wrong/null versions and added owner/time arguments must fail. The private profile must remain rejected (`PGRST106`), and private cores/direct tables must have no accessible public API route. Never mint a hosted unconfirmed-user JWT: the trusted unconfirmed-row boundary is already proven in disposable real Supabase CI, without production signing secrets.
4. Compare each test account's study/sync feed before/after acknowledgment; ordinary study, login/logout, account switching, offline reading and missing-service guidance must still work. Test writes are limited to the explicitly approved disposable receipt rows. Do not add study records, send new confirmation mail or change Auth/origin settings under migration approval alone.
5. If functions exist with correct grants but PostgREST reports stale schema cache, the disclosed optional operational step is `NOTIFY pgrst, 'reload schema';`. It reloads the cache, not exposure settings. Use only if needed under the approved plan, then repeat RPC checks. Never expose the private schema as a workaround.

The reviewed frontend may be enabled only after the database checks and a **separate PR merge approval**. This task does not merge PR #11, tag or publish a release, deploy the frontend, or deploy this SQL.

## Evidence-preserving rollback

If new recording fails or behaves unexpectedly, stop new acknowledgment writes. After explicit rollback approval, use a new forward rollback migration containing:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION
  public.record_legal_acceptance(text, text),
  stride_private.record_legal_acceptance_core(text, text)
FROM authenticated;
COMMIT;
```

Keep owner-only reads, table, policy and first timestamps intact. Disable the receipt-writing UI selectively; keep signup consent and already-published legal text/version identifiers. If the frontend has not been merged, it is already absent from main. Verify new writes fail, old receipts still read unchanged, and study/sync fingerprints and behavior remain intact.

Do not drop/truncate the receipt table, backdate timestamps, delete personal accounts, remove the original applied history row, reset the remote database or revoke existing sync/private-schema permissions. Account deletion cascades receipt removal only through its normal separately authorized account lifecycle. Reenable writes only with a separately reviewed forward grant migration, matching document allowlists and replay verification.
