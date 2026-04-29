-- Phase 1b: Auth helper RPC for the auth-login edge function.
--
-- Defines a SECURITY DEFINER function that verifies a username + plaintext pin
-- against the bcrypt pin_hash, returning the employee row (no pin/hash) on
-- success, NULL on failure.
--
-- The edge function calls this RPC instead of fetching the row + comparing in
-- JS. Keeps bcrypt verification entirely server-side and avoids shipping a
-- bcrypt JS library into the edge function.
--
-- SECURITY DEFINER means it runs with the function owner's privileges (postgres),
-- so it bypasses RLS — it can read pin_hash even after employees has RLS on.
-- We restrict who can call it via REVOKE/GRANT below.

CREATE OR REPLACE FUNCTION public.verify_employee_pin(
    p_username text,
    p_pin text
)
RETURNS TABLE (
    id integer,
    name text,
    username text,
    role text,
    location text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    -- Constant-time comparison via crypt(): if pin matches, returns the same
    -- hash that was stored; comparing to pin_hash gives true only on match.
    RETURN QUERY
    SELECT e.id, e.name, e.username, e.role, e.location
      FROM public.employees e
     WHERE lower(e.username) = lower(p_username)
       AND e.pin_hash IS NOT NULL
       AND e.pin_hash = crypt(p_pin, e.pin_hash);
END;
$$;

-- Lock down who can call it. Only service_role (used by the edge function)
-- and authenticated users (for re-auth flows) need access. anon should NOT
-- be able to brute-force this.
REVOKE ALL ON FUNCTION public.verify_employee_pin(text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.verify_employee_pin(text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.verify_employee_pin(text, text) TO service_role;

-- A second helper: hash a new pin (used when adding employees or rotating pins).
-- Also security-definer + service-role only.
CREATE OR REPLACE FUNCTION public.hash_employee_pin(p_pin text)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
    RETURN crypt(p_pin, gen_salt('bf', 10));
END;
$$;

REVOKE ALL ON FUNCTION public.hash_employee_pin(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.hash_employee_pin(text) FROM anon;
GRANT EXECUTE ON FUNCTION public.hash_employee_pin(text) TO service_role;

-- create_employee: owners only. Hashes the pin server-side and inserts.
-- Authenticated users with is_owner=true in their JWT can call this from
-- the PWA's "Add Employee" flow.
CREATE OR REPLACE FUNCTION public.create_employee(
    p_name text,
    p_username text,
    p_pin text,
    p_role text DEFAULT 'employee',
    p_location text DEFAULT NULL
)
RETURNS TABLE (
    id integer,
    name text,
    username text,
    role text,
    location text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner boolean := false;
  v_id integer;
BEGIN
  -- Authorize: must be an owner (JWT is_owner claim).
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
  -- Reject duplicate usernames (case-insensitive).
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

-- update_employee_pin: owners can rotate any employee's PIN. The employee
-- themselves can rotate their own (matches the JWT sub claim).
CREATE OR REPLACE FUNCTION public.update_employee_pin(
    p_employee_id integer,
    p_new_pin text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_is_owner boolean := false;
  v_caller_id integer;
BEGIN
  v_is_owner := COALESCE((auth.jwt() ->> 'is_owner')::boolean, false);
  v_caller_id := NULLIF(auth.jwt() ->> 'sub', '')::integer;
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

REVOKE ALL ON FUNCTION public.update_employee_pin(integer, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_employee_pin(integer, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.update_employee_pin(integer, text) TO authenticated, service_role;
