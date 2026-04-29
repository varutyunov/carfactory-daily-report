-- Phase 1: Add pin_hash column to employees, backfill from existing plaintext pin.
-- Keeps `pin` plaintext column as a rollback safety net (drop in Phase 6).
--
-- Run this in Supabase SQL Editor (logged in as project owner).
-- After running, every existing employee row will have a bcrypt-hashed pin_hash.
-- The auth-login edge function uses pin_hash for verification; the plaintext
-- column is no longer read by the app.

-- 1. Add the column (nullable for now so the ALTER doesn't fail on existing rows)
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS pin_hash text;

-- 2. Enable pgcrypto for bcrypt-style hashing (gen_salt('bf') + crypt())
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 3. Backfill: hash every existing plaintext pin into pin_hash
--    Uses Blowfish (bf) work-factor 10, the same as bcryptjs default.
UPDATE public.employees
   SET pin_hash = crypt(pin, gen_salt('bf', 10))
 WHERE pin IS NOT NULL
   AND pin_hash IS NULL;

-- 4. Verify: every row that had a pin now has a pin_hash
--    SELECT id, name, username, role,
--           CASE WHEN pin IS NOT NULL AND pin_hash IS NULL THEN 'MISSING'
--                WHEN pin IS NULL THEN 'NO_PIN'
--                ELSE 'OK' END AS status
--      FROM public.employees ORDER BY id;

-- 5. (Sanity) verify the bcrypt round-trip for one row before relying on it:
--    SELECT (pin_hash = crypt(pin, pin_hash)) AS hash_matches
--      FROM public.employees WHERE id = 1;
--    Expected: hash_matches = true
