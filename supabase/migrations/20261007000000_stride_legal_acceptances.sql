-- APPROVAL REQUIRED FOR HOSTED DEPLOYMENT. This review-only implementation may
-- run in disposable local/CI databases; it must not be applied to hosted Stride
-- without a separate explicit deployment approval.
-- Receipts record authenticated post-confirmation acknowledgments received by
-- the server, not original signup time or proof that a person read the text.
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
-- No direct table privileges, even for the owner. The SELECT policy protects
-- any future separately reviewed owner-read grant. No client write policies.

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
  IF p_terms_version IS DISTINCT FROM '2026-10-07'
     OR p_privacy_version IS DISTINCT FROM '2026-10-07' THEN
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

CREATE FUNCTION stride_private.get_legal_acceptance_core(
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
  IF p_terms_version IS DISTINCT FROM '2026-10-07'
     OR p_privacy_version IS DISTINCT FROM '2026-10-07' THEN
    RAISE EXCEPTION 'Unsupported legal document version' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_receipt
    FROM stride_private.stride_legal_acceptances AS a
    WHERE a.owner_id = v_owner AND a.terms_version = p_terms_version
      AND a.privacy_version = p_privacy_version;
  IF NOT FOUND THEN RETURN NULL; END IF;
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

CREATE FUNCTION public.get_legal_acceptance(
  p_terms_version text, p_privacy_version text
)
RETURNS jsonb
LANGUAGE sql
SECURITY INVOKER
SET search_path = ''
AS $$
  SELECT stride_private.get_legal_acceptance_core(p_terms_version, p_privacy_version);
$$;

REVOKE ALL ON FUNCTION stride_private.record_legal_acceptance_core(text, text),
  stride_private.get_legal_acceptance_core(text, text),
  public.record_legal_acceptance(text, text),
  public.get_legal_acceptance(text, text) FROM PUBLIC, anon, authenticated;
-- Existing sync grants authenticated USAGE on the unexposed private schema.
-- These narrow safe core grants support invoker wrappers, not table access.
GRANT EXECUTE ON FUNCTION stride_private.record_legal_acceptance_core(text, text),
  stride_private.get_legal_acceptance_core(text, text),
  public.record_legal_acceptance(text, text),
  public.get_legal_acceptance(text, text) TO authenticated;

COMMIT;
