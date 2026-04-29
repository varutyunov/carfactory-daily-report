-- Phase 4: Enable RLS on every public table + add baseline "authenticated"
-- policy. After this runs, the anon API key alone gets ZERO access — every
-- request must carry a JWT issued by the auth-login edge function.
--
-- Strategy: permissive baseline (any authenticated employee can CRUD), with
-- explicit lockdowns for sensitive cases. This mirrors the trust model the
-- app has had all along (logged-in employees trust each other) but moves
-- the boundary from "anyone with the URL" to "anyone with a real JWT".
--
-- Run AFTER:
--   - 20260429_010_employees_pin_hash.sql (pin_hash backfilled)
--   - 20260429_020_auth_helpers.sql (verify_employee_pin RPC live)
--   - auth-login edge function deployed with SUPABASE_JWT_SECRET set
--   - Phase 5: Python scripts switched to service-role key
--   - Phase 3 PWA changes deployed (clients carrying JWTs)
--
-- Rollback if anything breaks:
--   ALTER TABLE public.<name> DISABLE ROW LEVEL SECURITY;
-- Or for everything:
--   DO $$ DECLARE r record; BEGIN
--     FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
--       EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
--     END LOOP;
--   END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 1. Enable RLS on every existing public table.
--    Skips tables that already have RLS enabled (idempotent).
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'        -- ordinary tables only (not views, not partitions)
       AND c.relname NOT LIKE 'pg_%'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', r.tablename);
    EXECUTE format('ALTER TABLE public.%I FORCE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 2. Default policy on every table: authenticated users (real JWT) have
--    full CRUD. anon (no JWT or anon key only) gets nothing.
--
--    Skip tables that already have a policy named "authenticated_all" so
--    re-running doesn't duplicate. Also skip tables with table-specific
--    overrides defined further down (employees, audit_log).
-- ──────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  r record;
  has_policy boolean;
BEGIN
  FOR r IN
    SELECT c.relname AS tablename
      FROM pg_class c
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public'
       AND c.relkind = 'r'
       AND c.relname NOT IN ('employees', 'audit_log')   -- handled separately
  LOOP
    SELECT EXISTS(
      SELECT 1 FROM pg_policies
       WHERE schemaname='public' AND tablename=r.tablename AND policyname='authenticated_all'
    ) INTO has_policy;
    IF NOT has_policy THEN
      EXECUTE format($f$
        CREATE POLICY authenticated_all ON public.%I
          FOR ALL TO authenticated
          USING (true) WITH CHECK (true)
      $f$, r.tablename);
    END IF;
  END LOOP;
END $$;

-- ──────────────────────────────────────────────────────────────────────────
-- 3. employees — special handling:
--    - SELECT: any authenticated user can list employees (needed for the
--      app's "fetch all employees" pattern), BUT the pin/pin_hash columns
--      are revoked at the column level so they're never returned.
--    - INSERT / UPDATE / DELETE: owners only (is_owner JWT claim).
--    - Auth-login bypass: the verify_employee_pin RPC runs as SECURITY
--      DEFINER so it CAN read pin_hash regardless of these policies.
-- ──────────────────────────────────────────────────────────────────────────

-- Wipe any prior employees policies so we're clean.
DROP POLICY IF EXISTS authenticated_all ON public.employees;
DROP POLICY IF EXISTS employees_select_authenticated ON public.employees;
DROP POLICY IF EXISTS employees_insert_owner ON public.employees;
DROP POLICY IF EXISTS employees_update_owner ON public.employees;
DROP POLICY IF EXISTS employees_delete_owner ON public.employees;

-- All authenticated users can read employee rows (for the user list, role
-- gating, etc). pin/pin_hash visibility is enforced via column grants
-- below — RLS is row-level, not column-level.
CREATE POLICY employees_select_authenticated ON public.employees
  FOR SELECT TO authenticated
  USING (true);

-- Only owners (Vlad, Tommy — checked via JWT is_owner claim) can mutate.
CREATE POLICY employees_insert_owner ON public.employees
  FOR INSERT TO authenticated
  WITH CHECK ((auth.jwt() ->> 'is_owner')::boolean = true);

CREATE POLICY employees_update_owner ON public.employees
  FOR UPDATE TO authenticated
  USING ((auth.jwt() ->> 'is_owner')::boolean = true)
  WITH CHECK ((auth.jwt() ->> 'is_owner')::boolean = true);

CREATE POLICY employees_delete_owner ON public.employees
  FOR DELETE TO authenticated
  USING ((auth.jwt() ->> 'is_owner')::boolean = true);

-- Column-level grants: hide pin + pin_hash from authenticated entirely.
-- service_role retains full access (used by the auth-login RPC).
REVOKE SELECT ON public.employees FROM authenticated;
GRANT SELECT (id, name, username, role, location) ON public.employees TO authenticated;
GRANT INSERT, UPDATE, DELETE ON public.employees TO authenticated;
-- Restrict INSERT/UPDATE columns too: anon can't write pin via PATCH
-- (the verify_employee_pin/hash_employee_pin RPCs are the only legit way).
REVOKE INSERT, UPDATE ON public.employees FROM authenticated;
GRANT INSERT (name, username, role, location), UPDATE (name, username, role, location) ON public.employees TO authenticated;

-- ──────────────────────────────────────────────────────────────────────────
-- 4. audit_log — append-only. Authenticated users can read history and
--    insert new rows; nobody (except service_role) can update or delete.
-- ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS authenticated_all ON public.audit_log;
DROP POLICY IF EXISTS audit_log_select ON public.audit_log;
DROP POLICY IF EXISTS audit_log_insert ON public.audit_log;

CREATE POLICY audit_log_select ON public.audit_log
  FOR SELECT TO authenticated
  USING (true);

CREATE POLICY audit_log_insert ON public.audit_log
  FOR INSERT TO authenticated
  WITH CHECK (true);

-- ──────────────────────────────────────────────────────────────────────────
-- 5. Storage: car-photos bucket. Lock down to authenticated + the
--    auth-login function. (Anon must NOT be able to list / upload / delete.)
--    Storage RLS lives on storage.objects, not on a public table.
-- ──────────────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS car_photos_select_authenticated ON storage.objects;
DROP POLICY IF EXISTS car_photos_insert_authenticated ON storage.objects;
DROP POLICY IF EXISTS car_photos_update_authenticated ON storage.objects;
DROP POLICY IF EXISTS car_photos_delete_authenticated ON storage.objects;

CREATE POLICY car_photos_select_authenticated ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'car-photos');

CREATE POLICY car_photos_insert_authenticated ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'car-photos');

CREATE POLICY car_photos_update_authenticated ON storage.objects
  FOR UPDATE TO authenticated
  USING (bucket_id = 'car-photos')
  WITH CHECK (bucket_id = 'car-photos');

CREATE POLICY car_photos_delete_authenticated ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'car-photos');

-- ──────────────────────────────────────────────────────────────────────────
-- 6. Verification queries (commented — uncomment to inspect after running):
-- ──────────────────────────────────────────────────────────────────────────
-- -- Tables with RLS off (should be empty after this):
-- SELECT relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
--  WHERE n.nspname='public' AND c.relkind='r' AND NOT c.relrowsecurity;
--
-- -- All policies in public schema:
-- SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual
--   FROM pg_policies WHERE schemaname='public' ORDER BY tablename, policyname;
--
-- -- Confirm pin/pin_hash columns are NOT in authenticated grants:
-- SELECT column_name, privilege_type FROM information_schema.column_privileges
--  WHERE table_schema='public' AND table_name='employees' AND grantee='authenticated';
