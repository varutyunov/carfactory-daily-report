-- Phase 4 follow-up: drop legacy permissive policies that pre-dated the
-- migration. Several tables had pre-existing "Public access" / "anon_all" /
-- "anon all" / "Allow anon full access" / "<table>_all_access" policies
-- created by earlier "Enable RLS with public anon" work. Those policies
-- granted anon role full CRUD via PERMISSIVE OR semantics, which silently
-- defeated my Phase 4 lockdown.
--
-- This migration removes EVERY policy in the public schema that isn't on
-- my whitelist of Phase-4-issued names. Run AFTER 20260429_030_enable_rls.sql.
--
-- Idempotent: re-running is safe (only drops policies that exist).

DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT schemaname, tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND policyname NOT IN ('authenticated_all',
                              'employees_select_authenticated',
                              'employees_insert_owner',
                              'employees_update_owner',
                              'employees_delete_owner',
                              'audit_log_select',
                              'audit_log_insert')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I',
                   r.policyname, r.schemaname, r.tablename);
    RAISE NOTICE 'Dropped legacy policy "%" on %.%',
                 r.policyname, r.schemaname, r.tablename;
  END LOOP;
END $$;

-- Verification:
--   SELECT tablename, count(*) AS policy_count, array_agg(policyname ORDER BY policyname) AS policies
--     FROM pg_policies WHERE schemaname='public'
--    GROUP BY tablename ORDER BY tablename;
-- Expect: every row's `policies` array contains only authenticated_all
-- (or, for employees / audit_log, the Phase 4 whitelist names).
