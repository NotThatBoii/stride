# Proposed durable legal acknowledgment receipts

Status: **NEEDS APPROVAL — DESIGN ONLY**. Proposed on 2026-10-06 (Asia/Manila). Nothing in this document is an instruction to apply hosted SQL, change Supabase Auth metadata/configuration, or activate a new runtime flow. The current security PR implements the required explicit signup checkbox and versioned legal documents, without claiming a durable server audit record.

This proposal and its SQL live under `docs/proposals/`. Its SQL must stay outside `supabase/migrations/` until the owner separately approves implementation and deployment. No table, RPC, grant, policy, Auth hook, or production setting has been deployed. The isolated prototype does not contact hosted Supabase.

## What the proposed record establishes

A receipt establishes that a confirmed, authenticated account submitted an acknowledgment of the exact document versions, and that Stride's server received it at `accepted_at`. It does not prove that a person read or understood the documents, that a particular human operated the device, or that the initial pre-account signup checkbox was clicked at that same time.

Supabase email signup usually returns no authenticated session until confirmation. At that earlier point an RPC cannot derive `auth.uid()` for the account. Consequently **this design records a post-confirmation authenticated acknowledgment**, not an atomic initial-signup consent event. Label `accepted_at` as the server receipt/acknowledgment time; never backdate it from a browser clock or imply that it is the original signup time.

A malicious custom client can call public Supabase signup directly without using Stride's checkbox. It can also submit an authenticated acknowledgment without using Stride's legal screen. A durable version receipt does not prove UI interaction. Any requirement to reject account creation without a version declaration must instead be enforced at the trusted Auth creation boundary and explicitly approved.

## Scope and data minimization

The proposed private table stores only:

| Column                    | Meaning / control                                                                                                                            |
| ------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner_id uuid`           | Current authenticated `auth.uid()`, derived by the server; never an RPC argument. References `auth.users(id)` with account-deletion cascade. |
| `terms_version text`      | Exact allowed Terms version requested by the caller. Server allowlist must match the immutable published document.                           |
| `privacy_version text`    | Exact allowed Data & Privacy version requested by the caller. Same server allowlist requirement.                                             |
| `accepted_at timestamptz` | Server `statement_timestamp()` when the first receipt is inserted. No caller-supplied timestamp.                                             |

The primary key is `(owner_id, terms_version, privacy_version)`. Repeated submission returns the existing first receipt and never changes its timestamp. An account may accumulate one row per genuinely accepted version pair after separately reviewed document changes. No email copy, IP address, browser/device fingerprint, user agent, location, study record, password, or Auth token is collected for this evidence.

Versions use explicit dates, initially **Terms `2026-10-06` / Privacy `2026-10-06`**. A corrected or changed document gets a new date or documented revision suffix; never silently replace substantive text under a previously recorded identifier. The example SQL allows only the current exact date pair. Later version changes require a reviewed server allowlist update, matching UI constants and immutable documentation; preserve all old rows. The SQL's 32-character column bounds do not create an arbitrary accepted-version API.

## Ownership, RLS, grants and API boundary

The table stays in `stride_private`, which must remain excluded from the Data API schemas. RLS is enabled. An owner-scoped SELECT policy is a second safeguard if a later reviewed owner-read grant is ever added. Initially there are **no client table privileges**, including SELECT; users receive only their own receipt from the write RPC. There are no INSERT, UPDATE or DELETE policies/grants for `anon` or `authenticated`.

The public RPC is a security-invoker wrapper around a qualified private security-definer core, matching the existing sync pattern. Each function has an empty search path. The core checks `auth.uid()` and the trusted `auth.users.email_confirmed_at` row, checks the exact document pair, inserts only server-owned identity/time values and selects only that same account/version row. `PUBLIC` and `anon` EXECUTE are revoked. The existing authenticated private-schema USAGE plus narrowly granted core EXECUTE is intentional; it does not expose the private schema or table through HTTP. No helper accepts an arbitrary owner.

Do not replace the existing sync grants/policies, broaden schema exposure, grant direct table writes, or use mutable `raw_user_meta_data` as authoritative evidence. A privileged database administrator could still alter records; this is application access control, not cryptographically tamper-evident archival storage.

## Server write path and proposed runtime behavior

The proposed RPC is `public.record_legal_acceptance(p_terms_version text, p_privacy_version text) -> jsonb`, returning only `terms_version`, `privacy_version`, and `accepted_at`.

If separately approved, the app should ask the newly confirmed user to actively acknowledge the current pair before sending this RPC. It must present that second acknowledgment as a post-confirmation record, show understandable failure/retry guidance, and retry the same pair safely. It must not infer an earlier checkbox event from a stale or globally stored client flag. It must not automatically write receipts for existing accounts, backfill old accounts as accepted, or force existing users to repeat signup. Deciding whether future document changes require reacceptance and whether a pending receipt limits any new-account action is a product/legal decision not made by this draft.

The current PR should not send Auth metadata, invoke this RPC, or depend on a table that is not deployed. Keep all current study/sync/local-first behavior unchanged when durable recording is deferred.

## Executable migration draft — do not apply automatically

Prerequisites: existing Stride cloud schema; trusted migration role able to create the private table/functions and read `auth.users`; `stride_private` remains excluded from Data API; existing authenticated schema USAGE from the reviewed sync migration. Run first only in a disposable local Supabase project with a reviewed migration/app implementation. This is a new one-time migration draft, not an idempotent rerunnable script. Reapplying it should fail rather than silently replace an existing receipt system.

```sql
-- REVIEW DRAFT ONLY. Never place in supabase/migrations or apply to hosted Stride
-- without separate explicit owner approval. This records an authenticated
-- acknowledgment received after email confirmation, not the original signup.
BEGIN;

CREATE TABLE stride_private.stride_legal_acceptances (
  owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  terms_version text NOT NULL CHECK (pg_catalog.char_length(terms_version) BETWEEN 1 AND 32),
  privacy_version text NOT NULL CHECK (pg_catalog.char_length(privacy_version) BETWEEN 1 AND 32),
  accepted_at timestamptz NOT NULL DEFAULT pg_catalog.statement_timestamp(),
  PRIMARY KEY (owner_id, terms_version, privacy_version)
);

ALTER TABLE stride_private.stride_legal_acceptances ENABLE ROW LEVEL SECURITY;
CREATE POLICY stride_legal_acceptances_read_own
  ON stride_private.stride_legal_acceptances FOR SELECT TO authenticated
  USING (owner_id = auth.uid());
REVOKE ALL ON TABLE stride_private.stride_legal_acceptances
  FROM PUBLIC, anon, authenticated;
-- No table grants: even owner reads are through the receipt returned by the RPC.
-- The SELECT policy protects a future explicitly reviewed SELECT grant.

CREATE FUNCTION stride_private.record_legal_acceptance_core(
  p_terms_version text, p_privacy_version text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_owner uuid := auth.uid();
  v_receipt stride_private.stride_legal_acceptances%ROWTYPE;
BEGIN
  IF v_owner IS NULL THEN
    RAISE EXCEPTION 'Authentication required' USING ERRCODE = '42501';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM auth.users AS u
    WHERE u.id = v_owner AND u.email_confirmed_at IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Confirmed account required' USING ERRCODE = '42501';
  END IF;
  -- Release-controlled exact allowlist. Changing the current document pair
  -- requires a reviewed function change; old receipt rows remain untouched.
  IF p_terms_version IS DISTINCT FROM '2026-10-06'
     OR p_privacy_version IS DISTINCT FROM '2026-10-06' THEN
    RAISE EXCEPTION 'Unsupported legal document version' USING ERRCODE = '22023';
  END IF;
  INSERT INTO stride_private.stride_legal_acceptances
    (owner_id, terms_version, privacy_version)
  VALUES (v_owner, p_terms_version, p_privacy_version)
  ON CONFLICT (owner_id, terms_version, privacy_version) DO NOTHING;
  SELECT * INTO v_receipt
    FROM stride_private.stride_legal_acceptances AS a
    WHERE a.owner_id = v_owner AND a.terms_version = p_terms_version
      AND a.privacy_version = p_privacy_version;
  RETURN pg_catalog.jsonb_build_object(
    'terms_version', v_receipt.terms_version,
    'privacy_version', v_receipt.privacy_version,
    'accepted_at', v_receipt.accepted_at
  );
END;
$$;

CREATE FUNCTION public.record_legal_acceptance(
  p_terms_version text, p_privacy_version text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT stride_private.record_legal_acceptance_core(p_terms_version, p_privacy_version);
$$;

REVOKE ALL ON FUNCTION stride_private.record_legal_acceptance_core(text, text),
  public.record_legal_acceptance(text, text) FROM PUBLIC, anon, authenticated;
-- Existing sync already grants authenticated USAGE on this unexposed schema.
-- These narrow EXECUTE grants support the public invoker wrapper; they do not
-- grant access to the table or expose private functions through the Data API.
GRANT EXECUTE ON FUNCTION stride_private.record_legal_acceptance_core(text, text),
  public.record_legal_acceptance(text, text) TO authenticated;

COMMIT;
```

## Tests and evidence

The isolated proposal test is `tests/security/consent-recording-proposal.test.mjs`, runnable with `node --test tests/security/consent-recording-proposal.test.mjs`. It executes the exact SQL above in PGlite with test-only Auth identities and does not alter the product source, npm scripts or existing migrations. It covers three grouped boundaries:

1. Different authenticated accounts produce separate version-pair rows, server time falls inside the observed request interval, and replay returns the exact first receipt without adding a row or exposing owner identity.
2. Anonymous, missing and unconfirmed identities; null/empty/unlisted/SQL-shaped versions; and fabricated owner/timestamp arguments are rejected without a receipt. Version-shaped SQL is data and does not remove the Auth sentinel table.
3. All client table privileges are denied; owner-only RLS remains effective under a test-only hypothetical read grant; authenticated direct INSERT/UPDATE/DELETE cannot alter receipts; account deletion cascades only that account's receipt as documented; disabling both new functions preserves existing evidence.

**Isolated proposal validation: 3/3 passed on 2026-10-06.** These results exercise the exact proposed SQL in a fresh PGlite instance, including the evidence-preserving function-revoke rollback. The proposal is still unapplied. This pass is separate from current application SQL contracts and does not imply that hosted consent recording exists.

PGlite Auth role stand-ins do not prove hosted JWT issuance, PostgREST schema exposure, connection concurrency or email confirmation. Before approval/activation, add real disposable **local** Supabase tests for HTTP anonymous/private-profile denial, confirmed-account calls, unconfirmed signup with no usable session, extra owner/timestamp arguments rejected by PostgREST, invalid versions, owner isolation and cleanup. Test two concurrent identical calls returning one row/first timestamp and independent concurrent owners; verify the actual receipt is only written after the explicit new acknowledgment. Browser tests should verify existing-account sign-in is unchanged, missing/failed RPC never invents a receipt, version mismatch gives safe guidance and tokens/receipt state do not enter study exports. Run the full existing suite and check the migration grants/catalog. Any hosted verification needs a separately approved disposable identity and production mutation scope.

## Rollback preserving evidence

Before deployment, retain the exact reviewed document versions and confirm the owner-approved account-deletion/retention policy. If enabled recording must be rolled back:

1. Disable the newly added receipt call/acknowledgment feature in the approved application release and confirm ordinary signup/login/study/sync still work. Keep the existing required signup checkbox and public documents.
2. In a separately approved transaction, revoke authenticated execution of the new public wrapper and private core. Do not revoke existing sync schema/function grants.
3. Preserve `stride_private.stride_legal_acceptances` and its policies/denied direct writes. Do not drop/truncate the table, rewrite timestamps, delete historical version rows, or roll back by deleting accounts.
4. Export a protected operator-controlled snapshot if archival retention is required; it includes account identifiers and must not enter source control/public issues. Decide retention and deletion handling explicitly. Verify the preserved receipt count/digests and unchanged study tables before/after.
5. A separately approved reenable grants only the exact new functions, restores matching app/server version allowlists, and verifies existing receipts replay unchanged. Schema removal would be a later explicit destructive decision after evidence retention is addressed.

The minimal SQL to disable new writes, without touching evidence or sync, is:

```sql
BEGIN;
REVOKE EXECUTE ON FUNCTION public.record_legal_acceptance(text, text),
  stride_private.record_legal_acceptance_core(text, text) FROM authenticated;
COMMIT;
```

## Cost, privacy and decision

One row/index entry per account/document pair and one RPC per newly acknowledged pair are small relative to the study change feed. Do not poll or write receipts on every session restoration. Precise storage and request overhead should be measured in a disposable local project, not inferred as hosted billable usage. Future document changes add retained pairs, and administrative retention/privacy responsibilities remain even for a small table.

The FK currently deletes receipts when Supabase deletes the account. That matches data minimization but means evidence does not survive account deletion. Do not imply permanent legal retention. Keeping consent evidence after account deletion would require a separate retention purpose, policy, ownership/identifier design and explicit approval. Access-controlled server records do not establish legal compliance or certification.

**Recommend deferring this backend addition in the current PR.** The requested signup checkbox and readable versioned documents can be completed immediately. This proposal cannot supply atomic initial-signup evidence without an additional trusted Auth-boundary design, and it must not impose an unapproved new confirmation/onboarding step on users. Its small operational cost does not eliminate the need to choose what event is being recorded and why. Deferral is transparent, and optional durable legal evidence alone is not a demonstrated security release blocker.

If the owner instead requires an account-creation declaration, evaluate a trusted Supabase Auth before-user-created hook and/or trusted Auth insert trigger: accept only current declared versions, use the server-created `NEW.id` rather than a caller's owner, and stamp server time at creation. The submitted version declaration remains client-controlled; it cannot prove a person read terms. The design must review public-signup/admin-created-account behavior, email-unconfirmed rows, exact trusted hook role permissions, failure/rollback impact, and account cleanup. It requires separately reviewed Auth metadata/hook/config changes and SQL. No such patch or hook is included here.

## Approval scope after review

The eventual owner decision should explicitly choose between **keep client signup consent only**, **add authenticated post-confirmation version receipts**, and **design account-creation declaration enforcement**. Any approval must separately cover the concrete SQL/app change, disposable verification, target hosted deployment and rollback. Do not treat approval of the current UI/doc PR as approval for production database/Auth changes.
