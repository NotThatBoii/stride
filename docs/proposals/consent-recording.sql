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
