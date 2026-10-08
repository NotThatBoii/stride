-- REVIEW PLAN ONLY. Not a migration. No DDL, receipt writes or study/Auth rows.
-- Execute individual sections at the stated stage using a trusted operator.
-- First verify the approved connection targets fotgomkjwbahxmmovzmn.
-- These catalog queries have NOT been run on production by this task.

-- PREFLIGHT A: inventory. Stop if required schema/Auth/ledger/base sync is absent,
-- or if any receipt table/function name/overload already exists.
SELECT pg_catalog.current_database() AS database_name,
       CURRENT_USER AS migration_role, SESSION_USER AS session_role,
       pg_catalog.to_regnamespace('stride_private') AS private_schema,
       pg_catalog.to_regclass('auth.users') AS auth_users,
       pg_catalog.to_regclass('supabase_migrations.schema_migrations') AS ledger,
       pg_catalog.to_regclass('stride_private.stride_legal_acceptances') AS existing_receipts,
       pg_catalog.to_regprocedure('public.apply_sync_operation(uuid,text,text,text,jsonb,text)') AS base_write_rpc,
       pg_catalog.to_regprocedure('public.get_sync_changes(text,integer)') AS base_read_rpc;

SELECT n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','stride_private')
  AND p.proname IN ('record_legal_acceptance','get_legal_acceptance',
                   'record_legal_acceptance_core','get_legal_acceptance_core');

-- PREFLIGHT B: run only after A's prerequisites pass.
-- Expected migration privileges + authenticated USAGE true; API CREATE/access false.
SELECT pg_catalog.has_schema_privilege(CURRENT_USER,'public','CREATE') AS can_create_public,
       pg_catalog.has_schema_privilege(CURRENT_USER,'stride_private','CREATE') AS can_create_private,
       pg_catalog.has_table_privilege(CURRENT_USER,'auth.users','SELECT') AS can_read_confirmation,
       pg_catalog.has_table_privilege(CURRENT_USER,'auth.users','REFERENCES') AS can_reference_users,
       pg_catalog.has_schema_privilege('authenticated','stride_private','USAGE') AS authenticated_usage,
       pg_catalog.has_schema_privilege('authenticated','stride_private','CREATE') AS authenticated_create,
       pg_catalog.has_schema_privilege('anon','stride_private','USAGE,CREATE') AS anonymous_private_access;

SELECT version FROM supabase_migrations.schema_migrations ORDER BY version;

-- PREFLIGHT + POSTCHECK: save and compare these exact existing sync fingerprints.
-- Public/private namespace, definitions and grants must be unchanged.
SELECT n.nspname, p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       pg_catalog.md5(pg_catalog.pg_get_functiondef(p.oid)) AS definition_fingerprint,
       p.proacl, p.prosecdef, p.proconfig
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
WHERE n.nspname IN ('public','stride_private')
  AND p.proname IN ('apply_sync_operation','get_sync_changes',
                   'apply_sync_operation_core','get_sync_changes_core',
                   'assert_allocation_total','check_allocation_total','append_change')
ORDER BY n.nspname,p.proname,arguments;

-- POSTCHECK ONLY: expect one RLS table, matching trusted table/core owners.
SELECT n.nspname,c.relname,c.relrowsecurity,
       pg_catalog.pg_get_userbyid(c.relowner) AS table_owner
FROM pg_catalog.pg_class AS c
JOIN pg_catalog.pg_namespace AS n ON n.oid=c.relnamespace
WHERE n.nspname='stride_private' AND c.relname='stride_legal_acceptances';

SELECT policyname,permissive,roles,cmd,qual,with_check
FROM pg_catalog.pg_policies
WHERE schemaname='stride_private' AND tablename='stride_legal_acceptances';

SELECT r.rolname,
       pg_catalog.has_table_privilege(r.oid,
         'stride_private.stride_legal_acceptances'::regclass,
         'SELECT,INSERT,UPDATE,DELETE,TRUNCATE,REFERENCES,TRIGGER') AS any_table_privilege
FROM pg_catalog.pg_roles AS r WHERE r.rolname IN ('anon','authenticated');

SELECT conname,pg_catalog.pg_get_constraintdef(oid) AS definition
FROM pg_catalog.pg_constraint
WHERE conrelid='stride_private.stride_legal_acceptances'::regclass;

-- Exactly four functions, two text args, jsonb result; empty search_path.
-- Public invokers false / private definers true. anon false / authenticated true.
SELECT n.nspname,p.proname,
       pg_catalog.pg_get_function_identity_arguments(p.oid) AS arguments,
       pg_catalog.pg_get_function_result(p.oid) AS result,
       pg_catalog.pg_get_userbyid(p.proowner) AS owner,
       p.prosecdef,p.proconfig,
       pg_catalog.has_function_privilege('anon',p.oid,'EXECUTE') AS anon_execute,
       pg_catalog.has_function_privilege('authenticated',p.oid,'EXECUTE') AS authenticated_execute,
       pg_catalog.pg_get_functiondef(p.oid) AS reviewed_definition
FROM pg_catalog.pg_proc AS p
JOIN pg_catalog.pg_namespace AS n ON n.oid=p.pronamespace
WHERE n.nspname IN ('public','stride_private')
  AND p.proname IN ('record_legal_acceptance','get_legal_acceptance',
                   'record_legal_acceptance_core','get_legal_acceptance_core')
ORDER BY n.nspname,p.proname;

-- Also compare remote ledger + a no-pending --skip-vault dry run after approval.
-- API schema exposure must be verified separately; SQL settings may be null.
-- Live RPC writes/rollback are described in CONSENT_RECORDING_DEPLOYMENT.md,
-- require explicit approval, and are deliberately absent from this metadata file.
