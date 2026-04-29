"""
Shared Supabase config for backend Python scripts.

After the JWT/RLS migration (Phase 4), the anon key alone gets ZERO access to
tables. Backend scripts must use the project's service-role key, which bypasses
RLS. The service-role key is read from environment variables (never committed):

    SUPABASE_SERVICE_KEY   service-role key (preferred, bypasses RLS)
    SUPABASE_URL           project URL (default carfactory's)
    SUPABASE_ANON_KEY      anon key (legacy fallback only — fails post-RLS)

Usage:
    from _sb_config import SB_URL, SB_KEY, SB_HDR

Set env vars locally via a .env file in the repo root or scripts/ dir (both
gitignored), or export them in your shell:
    export SUPABASE_SERVICE_KEY="eyJ..."
"""
import os
import sys

# Try loading from a local .env file (one-shot, no python-dotenv dependency).
def _load_env_file():
    candidates = [
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '.env'),
        os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '.env'),
    ]
    for path in candidates:
        if not os.path.isfile(path):
            continue
        try:
            with open(path, 'r', encoding='utf-8') as fh:
                for line in fh:
                    line = line.strip()
                    if not line or line.startswith('#'):
                        continue
                    if '=' not in line:
                        continue
                    k, v = line.split('=', 1)
                    k = k.strip()
                    v = v.strip().strip('"').strip("'")
                    if k and k not in os.environ:
                        os.environ[k] = v
        except Exception:
            pass

_load_env_file()

SB_URL = os.environ.get('SUPABASE_URL', 'https://hphlouzqlimainczuqyc.supabase.co').rstrip('/')

# Prefer service-role key. Fall back to anon (legacy, will fail against RLS).
_SERVICE = os.environ.get('SUPABASE_SERVICE_KEY') or os.environ.get('SUPABASE_SERVICE_ROLE_KEY')
_ANON = os.environ.get('SUPABASE_ANON_KEY') or os.environ.get('SUPABASE_KEY')

if _SERVICE:
    SB_KEY = _SERVICE
    _IS_SERVICE = True
elif _ANON:
    SB_KEY = _ANON
    _IS_SERVICE = False
    print(
        '[_sb_config] WARNING: using anon key. Will fail against RLS-enabled '
        'tables. Set SUPABASE_SERVICE_KEY in env or .env.',
        file=sys.stderr,
    )
else:
    print(
        '[_sb_config] ERROR: no Supabase key found. Set SUPABASE_SERVICE_KEY '
        '(or SUPABASE_KEY for legacy anon access) in env or scripts/.env. See '
        'setup-security.md for instructions.',
        file=sys.stderr,
    )
    sys.exit(2)

SB_HDR = {
    'apikey': SB_KEY,
    'Authorization': f'Bearer {SB_KEY}',
}

def is_service_role():
    """True if we're running with the service-role key (bypasses RLS)."""
    return _IS_SERVICE
