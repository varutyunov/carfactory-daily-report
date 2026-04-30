#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
restore_surnames.py — fix col G lines whose surname got mangled by
Apps Script's _rewriteNoteLineLastName during the recent moves.

Symptom: lines like "100 Silverado 4D silverado 4/2" where the
surname-word equals a model word from the car_desc.

For each Deals26 row, scans col G lines for ones where the
surname-word matches a model token from the row's own car_desc.
Replaces it with the actual row surname.
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'
APPLY = '--apply' in sys.argv

def gas(b, retries=2):
    b['secret'] = GAS_SECRET
    last = None
    for a in range(retries+1):
        try:
            req = urllib.request.Request(GAS_URL, data=json.dumps(b).encode(),
                headers={'Content-Type':'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if a < retries: time.sleep(3)
    raise last

COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze','burgundy','champagne','charcoal','copper',
          'cream','ivory'}
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE = re.compile(r'\s+(\d{1,2}/\d{1,2})\s*$')

def parse_amt(line):
    m = _AMT_RE.match(line.strip())
    if not m: return None
    try: return float(m.group(1).replace(',', ''))
    except ValueError: return None

def get_model_tokens(car_desc):
    """Return lowercase model tokens from car_desc (excluding year, color,
    mileage, surname-tail)."""
    toks = car_desc.split()
    if not toks: return set()
    out = set()
    # Skip first token if year, last token (surname), color, mileage, etc.
    first_is_year = bool(re.match(r'^\d{2,4}$', toks[0]))
    start = 1 if first_is_year else 0
    end = len(toks) - 1  # exclude surname
    for t in toks[start:end]:
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS: continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3'): continue
        if tl: out.add(tl)
    return out

def get_surname(car_desc):
    toks = car_desc.split()
    if not toks: return ''
    return toks[-1].lower().rstrip('.,;:')

def fix_line(line, model_tokens, true_surname):
    """A line is mangled iff its surname-word REPEATS an earlier word in
    the same line (Apps Script's _rewriteNoteLineLastName pattern):
        '100 Silverado 4D silverado 4/2'  ← 'silverado' repeats
        '250 Accord blue lopez 4/23'       ← 'lopez' is unique → NOT mangled
    Only replace when the repeat is detected AND the surname doesn't
    match the row's true surname."""
    raw = line.strip()
    if not raw: return raw, False
    dm = _DATE_TAIL_RE.search(raw)
    date_tail = ''
    if dm:
        date_tail = ' ' + dm.group(1)
        raw_no_date = raw[:dm.start()]
    else:
        raw_no_date = raw
    parts = raw_no_date.split()
    if len(parts) < 3: return line, False  # need amount + 2+ words
    last_word = parts[-1].lower().rstrip('.,;:')
    if last_word == true_surname: return line, False  # already correct
    # Check earlier words (skip amount at index 0)
    earlier = [w.lower().rstrip('.,;:') for w in parts[1:-1]]
    if last_word in earlier:
        # Mangled: surname-word repeats an earlier word in the line
        parts[-1] = true_surname
        return ' '.join(parts) + date_tail, True
    return line, False

# ── Run ─────────────────────────────────────────────────────────────────────
print('Loading Deals26…')
all_rows = []
for loc in ['DeBary','DeLand']:
    resp = gas({'action':'read_all','tab':'Deals26','location':loc})
    for r in (resp or {}).get('rows', []):
        cd = (r.get('car_desc') or '').strip()
        if not cd: continue
        all_rows.append({
            'loc': loc, 'sheet_row': r.get('_sheetRow'),
            'car_desc': cd,
            'payment_notes': r.get('payment_notes') or '',
        })

fixes = []  # {row, original_lines, new_lines, changes}
for r in all_rows:
    notes = r['payment_notes']
    if not notes.strip(): continue
    cur_lines = notes.split('\n')
    model_tokens = get_model_tokens(r['car_desc'])
    true_surname = get_surname(r['car_desc'])
    new_lines = []
    changed_any = False
    changes = []
    for ln in cur_lines:
        new_ln, changed = fix_line(ln, model_tokens, true_surname)
        if changed:
            changes.append((ln.strip(), new_ln.strip()))
            changed_any = True
        new_lines.append(new_ln)
    if changed_any:
        fixes.append({
            'loc': r['loc'], 'sheet_row': r['sheet_row'],
            'car_desc': r['car_desc'],
            'orig_lines': cur_lines,
            'new_lines': new_lines,
            'changes': changes,
        })

print(f'\nRows needing fix: {len(fixes)}')
print(f'Total mangled lines: {sum(len(f["changes"]) for f in fixes)}')
print()
for f in fixes:
    print(f'  r{f["sheet_row"]:>3} {f["loc"]:6s} ({f["car_desc"][:30]:30s}):')
    for old, new in f['changes']:
        print(f'    "{old}" → "{new}"')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to write.')
    sys.exit(0)

print()
print('Applying…')
ok = err = 0
for f in fixes:
    new_notes = '\n'.join(f['new_lines']).rstrip()
    total = sum(p for p in (parse_amt(ln) for ln in f['new_lines']) if p is not None)
    try:
        resp = gas({'action':'correct_payments','location':f['loc'],
            'data':{'tab':'Deals26','row':f['sheet_row'],
                    'new_total':round(total,2),
                    'new_notes':new_notes,
                    'expected_car_desc':f['car_desc']}})
        if resp and resp.get('ok'):
            ok += 1
            print(f'  ✓ r{f["sheet_row"]:>3} {f["loc"]:6s}: fixed {len(f["changes"])} line(s)')
        else:
            err += 1
            print(f'  ✗ r{f["sheet_row"]} {f["loc"]}: {resp}')
    except Exception as e:
        err += 1
        print(f'  ✗ r{f["sheet_row"]} {f["loc"]}: {e}')

print()
print(f'Done: ok={ok} err={err}')
