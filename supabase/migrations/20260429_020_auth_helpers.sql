-- Phase 1b: Auth helper RPCs for the auth-login edge function.
--
-- Defines four SECURITY DEFINER functions:
--   verify_employee_pin(username, pin) → row or empty
--   hash_employee_pin(pin) → bcrypt hash
--   create_employee(name, username, pin, role, location) → owner-gated
--   update_employee_pin(employee_id, new_pin) → owner-or-self
--
-- pgcrypto's crypt() + gen_salt() live in the `extensions` schema in
-- Supabase, so search_path includes both `public` and `extensions`.
-- employees.id is bigint (not integer), so signatures use bigint.
--
-- All functions are SECURITY DEFINER and bypass RLS. service_role and
-- authenticated callers are gated explicitly by the function bodies
-- (is_owner JWT claim) and by REVOKE/GRANT below.

-- ─── verify_employee_pin ──────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.verify_employee_pin(text, text);

CREATE OR REPLACE FUNCTION public.verify_employee_pin(p_username text, p_pin text)
RETURNS TABLE (id bigint, name text, username text, role text, location text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN QUERY
  SELECT e.id, e.name, e.username, e.role, e.location
    FROM public.employees e
   WHERE lower(e.username) = lower(p_username)
     AND e.pin_hash IS NOT NULL
     AND e.pin_hash = crypt(p_pin, e.pin_hash);
END;
$$;

REVOKE ALL ON FUNCTION public.verify_employee_pin(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_employee_pin(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_employee_pin(text, text) TO service_role;

-- ─── hash_employee_pin ────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.hash_employee_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
BEGIN
  RETURN crypt(p_pin, gen_salt('bf', 10));
END;
$$;

REVOKE ALL ON FUNCTION public.hash_employee_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hash_employee_pin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hash_employee_pin(text) TO service_role;

-- ─── create_employee (owners only) ────────────────────────────────────
DROP FUNCTION IF EXISTS public.create_employee(text, text, text, text, text);

CREATE OR REPLACE FUNCTION public.create_employee(
  p_name text, p_username text, p_pin text,
  p_role text DEFAULT 'employee', p_location text DEFAULT NULL
)
RETURNS TABLE (id bigint, name text, username text, role text, location text)
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_is_owner boolean := false;
  v_id bigint;
BEGIN
  v_is_owner := COALESCE((auth.jwt() ->> 'is_owner')::boolean, false);
  IF NOT v_is_owner THEN
    RAISE EXCEPTION 'Only owners can create employees';
  END IF;
  IF p_pin IS NULL OR length(p_pin) < 1 THEN
    RAISE EXCEPTION 'PIN required';
  END IF;
  IF p_username IS NULL OR length(trim(p_username)) < 1 THEN
    RAISE EXCEPTION 'Username required';
  END IF;
  IF EXISTS(SELECT 1 FROM public.employees e WHERE lower(e.username) = lower(p_username)) THEN
    RAISE EXCEPTION 'Username already exists';
  END IF;
  INSERT INTO public.employees (name, username, role, location, pin_hash)
       VALUES (p_name, lower(trim(p_username)), p_role, p_location, crypt(p_pin, gen_salt('bf', 10)))
   RETURNING public.employees.id INTO v_id;
  RETURN QUERY
    SELECT e.id, e.name, e.username, e.role, e.location
      FROM public.employees e
     WHERE e.id = v_id;
END;
$$;

REVOKE ALL ON FUNCTION public.create_employee(text, text, text, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_employee(text, text, text, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.create_employee(text, text, text, text, text) TO authenticated, service_role;

-- ─── update_employee_pin (owner or self) ──────────────────────────────
DROP FUNCTION IF EXISTS public.update_employee_pin(integer, text);
DROP FUNCTION IF EXISTS public.update_employee_pin(bigint, text);

CREATE OR REPLACE FUNCTION public.update_employee_pin(p_employee_id bigint, p_new_pin text)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  v_is_owner boolean := false;
  v_caller_id bigint;
BEGIN
  v_is_owner := COALESCE((auth.jwt() ->> 'is_owner')::boolean, false);
  v_caller_id := NULLIF(auth.jwt() ->> 'sub', '')::bigint;
  IF NOT v_is_owner AND v_caller_id IS DISTINCT FROM p_employee_id THEN
    RAISE EXCEPTION 'Not authorized to change this PIN';
  END IF;
  IF p_new_pin IS NULL OR length(p_new_pin) < 1 THEN
    RAISE EXCEPTION 'PIN required';
  END IF;
  UPDATE public.employees
     SET pin_hash = crypt(p_new_pin, gen_salt('bf', 10))
   WHERE id = p_employee_id;
  RETURN FOUND;
END;
$$;

REVOKE ALL ON FUNCTION public.update_employee_pin(bigint, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_pin(bigint, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_employee_pin(bigint, text) TO authenticated, service_role;
