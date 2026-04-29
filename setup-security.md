# Security migration runbook (Day 9)

> **Status: deployed live on 2026-04-29.** All phases applied to project
> `hphlouzqlimainczuqyc`. The app at https://carfactory.work runs on
> JWT-authenticated Supabase calls; the anon key alone gets ZERO data
> access. This file remains as the reference for future migrations or
> if you ever need to rebuild from scratch.

This is the deploy script for the JWT + RLS migration. Follow phases in order.
Each phase is reversible; if a step breaks the live app, the rollback is at the
end of the section.

> **Background**: Supabase warned that public tables had no RLS — anyone with
> the anon key (which is in the shipped index.html) could read/write
> everything. After this migration, the anon key alone gets ZERO access.
> Authenticated employees get a 7-day JWT issued by an edge function after
> verifying their PIN against a bcrypt hash. Backend Python scripts use the
> service-role key (env-only, never committed) to bypass RLS.

---

## Phase 0 — Grab two secrets from the Supabase dashboard

You'll need both of these. **Treat them like passwords — don't paste them
into screenshots or commit them.**

> **Note: dashboard layout updated April 2026.** Supabase has migrated to
> ECC P-256 JWT signing keys; the legacy HS256 secret is on a separate
> "Legacy JWT Secret" tab and is still used to verify tokens. Our edge
> function signs with the legacy HS256 secret — works for now; future
> migration to ES256 is a separate task.

### A. Legacy JWT Secret (HS256)
1. Open https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/settings/jwt
2. Click the **Legacy JWT Secret** tab
3. Click *Reveal* next to "Legacy JWT secret (still used)"
4. Copy the ~88-char base64 string — paste into the CLI in Phase 2.

### B. Service-role key (legacy)
1. https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/settings/api-keys
2. Click the **Legacy anon, service_role API keys** tab
3. Row labeled `service_role` → *Reveal* → *Copy*
4. The JWT (starts with `eyJ...`) goes into `scripts/.env`.

### Where they go
- **JWT Secret** → Supabase dashboard env var (Phase 2 step 3)
- **Service-role key** → local `scripts/.env` file (Phase 5)

You only need to paste these once each.

---

## Phase 1 — Backfill bcrypt hashes for existing PINs (run once, in Studio)

1. Supabase dashboard → **SQL Editor** (left sidebar) → New query
2. Open `supabase/migrations/20260429_010_employees_pin_hash.sql` from this
   repo, paste the whole thing into the editor, click **Run**.
3. Open `supabase/migrations/20260429_020_auth_helpers.sql`, paste, **Run**.
4. Verify with this query:
   ```sql
   SELECT id, name, username,
          CASE WHEN pin IS NOT NULL AND pin_hash IS NULL THEN 'MISSING'
               WHEN pin IS NULL THEN 'NO_PIN'
               ELSE 'OK' END AS status
     FROM public.employees ORDER BY id;
   ```
   Every row should say `OK`. If any say `MISSING`, re-run migration 010.

5. Smoke-test the helper RPC (replace `vlad` and the PIN with real values):
   ```sql
   SELECT * FROM verify_employee_pin('vlad', '<actual-pin>');
   ```
   Expected: returns one row with id/name/username/role/location.
   With wrong PIN: returns 0 rows.

**Rollback**: nothing to undo — the new column is additive, plaintext `pin`
is untouched. To remove the column entirely:
```sql
ALTER TABLE public.employees DROP COLUMN pin_hash;
DROP FUNCTION verify_employee_pin(text, text);
DROP FUNCTION hash_employee_pin(text);
```

---

## Phase 2 — Deploy the auth-login edge function

### 2a. Install Supabase CLI (one-time)

```bash
npm install -g supabase
supabase --version   # should print 1.x or 2.x
```

### 2b. Link the project (one-time)

```bash
cd /c/Users/Vlad/Desktop/carfactory
supabase login                              # opens browser to authenticate
supabase link --project-ref hphlouzqlimainczuqyc
```

### 2c. Set the JWT secret as an edge-function env var

Use the JWT Secret from Phase 0A. **Don't paste it into any file** — set it
directly via the CLI. **The env var name MUST NOT start with `SUPABASE_`**
(the CLI rejects those):

```bash
supabase secrets set CF_JWT_SECRET="<paste-jwt-secret-here>"
```

Verify:
```bash
supabase secrets list
# should show CF_JWT_SECRET (value not displayed)
```

### 2d. Deploy

```bash
supabase functions deploy auth-login
```

### 2e. Test the deployed function

```bash
curl -X POST https://hphlouzqlimainczuqyc.supabase.co/functions/v1/auth-login \
  -H "apikey: <ANON_KEY>" \
  -H "Authorization: Bearer <ANON_KEY>" \
  -H "Content-Type: application/json" \
  -d '{"username":"vlad","pin":"<your-pin>"}'
```

Expected: JSON with `token`, `expires_at`, and `user` fields.
Wrong PIN: HTTP 401 with `{"error":"Invalid username or PIN"}`.

**Rollback**: `supabase functions delete auth-login`. The PWA falls back to
the legacy local-PIN path until Phase 4 is also reverted.

---

## Phase 3 — Deploy the PWA changes (already in `index.html`)

The `index.html` changes are already on disk in this repo. They:
- Make `SB_HEADERS` JWT-aware (falls back to anon when no JWT)
- Add `_acquireAuthJwt()` called from `doLogin()` and auto-login
- Clear JWT on logout
- Auto-kick to login when Supabase returns 401

Push to GitHub Pages (which serves https://carfactory.work):

```bash
cd /c/Users/Vlad/Desktop/carfactory
git status                                  # confirm changes staged
git add index.html supabase/ scripts/ .gitignore setup-security.md
git commit -m "Phase 1-5: JWT + RLS migration scaffolding"
git push                                    # pushes to BOTH master + main
```

Wait ~60s for GitHub Pages to redeploy, then:
1. Open https://carfactory.work in a private window
2. Log in with your normal username + PIN
3. Open DevTools → Network → look for a `POST /functions/v1/auth-login` call
   with status 200
4. DevTools → Application → Local Storage → confirm `cf_jwt` is set

If JWT acquired correctly, the rest of the app should work normally
(because anon-key fallback is still active, since RLS isn't on yet).

**Rollback**: revert the `index.html` commit and push again.

---

## Phase 4 — Enable RLS (the actual lockdown)

> **Run this AFTER Phase 5 (Python scripts using service-role key).**
> Otherwise `audit_april_profit.py`, `reconcile_payments.py`, etc. will
> break immediately because they're still on anon.

1. Confirm `scripts/.env` has `SUPABASE_SERVICE_KEY` set (Phase 5).
2. Confirm at least one user has logged in via the deployed auth-login
   (their JWT proves the edge function is healthy end-to-end).
3. Supabase dashboard → **SQL Editor** → New query.
4. Open `supabase/migrations/20260429_030_enable_rls.sql`, paste, **Run**.
5. **Also run** `supabase/migrations/20260429_040_cleanup_legacy_policies.sql`
   to drop pre-existing `Public access` / `anon_all` permissive policies
   that pre-date this migration. Without this step, anon will still have
   full read access — PostgREST OR-combines permissive policies, so a
   single open policy defeats the lockdown.

6. Verify every public table has RLS:
   ```sql
   SELECT relname, relrowsecurity FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname='public' AND c.relkind='r'
    ORDER BY relname;
   ```
   Every row's `relrowsecurity` should be `t`.

6. Verify pin/pin_hash columns are not visible to authenticated:
   ```sql
   SELECT column_name FROM information_schema.column_privileges
    WHERE table_schema='public' AND table_name='employees'
      AND grantee='authenticated' ORDER BY column_name;
   ```
   Should NOT include `pin` or `pin_hash`.

7. **Test the live site** at https://carfactory.work:
   - Open in a fresh private window
   - Log in (must succeed via edge function — local fallback dies here)
   - Tap through Reviews / Inventory / Payments / Customers tabs
   - Confirm reads still work
   - Try an edit (e.g. mark a notification read) — confirm writes work

8. Test that the anon key alone gets nothing:
   ```bash
   curl -s "https://hphlouzqlimainczuqyc.supabase.co/rest/v1/payments?limit=1" \
     -H "apikey: <ANON_KEY>" \
     -H "Authorization: Bearer <ANON_KEY>"
   ```
   Expected: empty array `[]` (RLS denies; PostgREST returns empty rather
   than error). The Supabase warning email should clear within 24h.

**Rollback** (if app breaks):
```sql
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
```
Anon key works again immediately. Diagnose what broke, fix the policy,
re-enable per table.

---

## Phase 5 — Service-role key for Python scripts

1. Create `scripts/.env` (gitignored — confirm it's in `.gitignore`):
   ```
   SUPABASE_SERVICE_KEY=<paste-service-role-key-from-Phase-0B>
   ```

2. Smoke-test by running any audit script:
   ```bash
   cd /c/Users/Vlad/Desktop/carfactory
   python scripts/audit_april_profit.py 2>&1 | head -20
   ```
   Should NOT print the "WARNING: using anon key" line. If it does, the env
   var didn't load — confirm the path is exactly `scripts/.env`.

3. (Optional) Set in your shell profile too so you don't depend on the
   `.env` file for ad-hoc commands:
   ```bash
   # ~/.bashrc or equivalent
   export SUPABASE_SERVICE_KEY="<paste>"
   ```

**Rollback**: delete `scripts/.env` (scripts will warn + fall back to anon
key, which works pre-RLS).

### 5b. Service-role key for the Google Apps Script

`google-apps-script.js` (deployed as the GAS web app) also calls Supabase
and needs the service-role key. Apps Script stores secrets via Script
Properties.

1. Open https://script.google.com → your project (Apps Script for Car Factory)
2. Project Settings (gear icon) → scroll to **Script Properties**
3. Click **Add script property**
4. Property: `SUPABASE_SERVICE_KEY` — Value: paste the service-role key
5. Save
6. Re-deploy the script: `clasp push && clasp deploy` (or push from the editor)

The script's `SUPABASE_KEY` is now read from this property; it falls back
to the hardcoded anon key only if the property is missing.

To verify:
```javascript
// Run this once in the Apps Script editor:
function _testSb() {
  var prop = PropertiesService.getScriptProperties().getProperty('SUPABASE_SERVICE_KEY');
  Logger.log(prop ? 'Service key loaded (' + prop.length + ' chars)' : 'NOT SET — using anon');
}
```

**Rollback**: delete the script property; falls back to anon (will fail
post-RLS for any operation that's not `SELECT FROM inventory`).

---

## Phase 6 — Cleanup (run after 24-48h of stable Phase 4)

> **Status: 6a, 6b, 6c done on 2026-04-30 (Day 10).** Skipped 6d
> (anon key rotation) — low priority; anon now nearly worthless.

### 6a. Drop the plaintext pin column ✓
```sql
ALTER TABLE public.employees DROP COLUMN pin;
```
Auth-login uses `pin_hash` via the `verify_employee_pin` RPC — never
the plaintext column. Run live via Supabase Management API on Day 10:
```bash
curl -s -X POST "https://api.supabase.com/v1/projects/hphlouzqlimainczuqyc/database/query" \
  -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"query":"ALTER TABLE public.employees DROP COLUMN IF EXISTS pin"}'
```
Verified: all 6 employees still have `pin_hash`; auth-login still 200s.

### 6b. Stop saving plaintext PIN in localStorage ✓
Done in commit `dc415d0`. Changes:
- `doLogin`: stopped writing `cf_saved_pin`. Saves only `cf_session`
  + `cf_saved_user`. The 7-day JWT in `cf_jwt` is what auto-login
  uses on subsequent loads.
- Auto-login: `_jwtReady = Promise.resolve(_cfJwt() ? {hasJwt:true}
  : null)`. If JWT missing or expired, kick to login.
- Defensive `removeItem('cf_saved_pin')` at script start cleans up
  any stale value from before this deploy.
- Both localStorage wipe sites: dropped `cf_saved_pin` from keep
  lists.

Trade-off: when the 7-day JWT expires, user re-enters their PIN.
That's acceptable — no plaintext credential at rest on the client.

### 6c. Remove the legacy fallback in doLogin ✓
The `sbGet('employees', 'select=...,pin,...')` fallback was dead code
post-Phase-4 (column-level revoke + dropped pin column). Deleted in
commit `dc415d0`.

### 6d. (Optional) Rotate the anon key
After everything is on RLS + JWT, the anon key only matters for the
`auth-login` edge function call. If the key ever leaks, rotating it is now
low-risk:
1. Supabase dashboard → Settings → API → "Reset anon key"
2. Update `SB_KEY` in `index.html` and `scripts/_sb_config.py` (env)
3. Push

### 6e. Update CLAUDE.md / Automation.md
Document the new auth flow for future sessions:
- Login goes through `auth-login` edge function
- JWT in `cf_jwt` localStorage, 7-day expiry
- Python scripts need `SUPABASE_SERVICE_KEY` env
- Adding a new table → add RLS migration

---

## Quick reference: file changes from this migration

```
supabase/
  migrations/
    20260429_010_employees_pin_hash.sql      # Phase 1: pin_hash column + backfill
    20260429_020_auth_helpers.sql            # Phase 1: verify_employee_pin RPC
    20260429_030_enable_rls.sql              # Phase 4: RLS on all tables
  functions/
    auth-login/
      index.ts                                # Phase 2: edge function
index.html                                    # Phase 3: JWT-aware client
scripts/
  _sb_config.py                              # Phase 5: shared env loader
  .env.example                                # Phase 5: template (gitignored real .env)
  *.py                                        # Phase 5: each updated to import _sb_config
.gitignore                                    # Phase 5: ignore .env files
setup-security.md                             # this runbook
```

## What if something breaks at 2am

Fastest path back to working state:
```sql
-- in Supabase SQL editor:
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
```
This re-opens the anon key path. The app works again. Re-enable per-table
once you've found the problem.
