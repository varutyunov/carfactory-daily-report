#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
dedupe_sheet.py — remove ONE copy of every duplicate payment entry on the
sheet. Uses Apps Script's profit_remove_entry for Profit26 cells and
correct_payments for col G.

Run scripts/find_duplicates.py first to populate scripts/duplicates.json.

Default: only touches APRIL Profit26 cells + col G entries with M/D dates.
Pre-existing dupes from earlier months stay untouched (different
provenance — those weren't from today's race condition).

Usage:
  python scripts/dedupe_sheet.py                  # dry-run
  python scripts/dedupe_sheet.py --apply          # remove duplicates
  python scripts/dedupe_sheet.py --apply --all-months  # also clean Jan/Feb/Mar dupes
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

APPLY = '--apply' in sys.argv
ALL_MONTHS = '--all-months' in sys.argv

MONTH_NAMES = {
    'jan':0,'january':0,'feb':1,'february':1,'mar':2,'march':2,
    'apr':3,'april':3,'may':4,'jun':5,'june':5,'jul':6,'july':6,
    'aug':7,'august':7,'sep':8,'sept':8,'september':8,
    'oct':9,'october':9,'nov':10,'november':10,'dec':11,'december':11,
}

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

# Parse a duplicate line into (amount, description) for profit_remove_entry
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
def parse_amt_desc(line):
    m = _AMT_RE.match(line.strip())
    if not m: return None, None
    try: amt = float(m.group(1).replace(',', ''))
    except ValueError: return None, None
    return round(amt, 2), m.group(2).strip()

# Load duplicates
with open(os.path.join(REPO, 'scripts', 'duplicates.json'), encoding='utf-8') as f:
    data = json.load(f)

print(f'dedupe_sheet {"--apply" if APPLY else "(dry-run)"} {"--all-months" if ALL_MONTHS else "(April only)"}')

# ── Profit26 dedup ──────────────────────────────────────────────────────────
profit_actions = []
for cell in data.get('profit', []):
    month = cell.get('month','')
    month_idx = MONTH_NAMES.get(month.lower())
    if month_idx is None: continue
    if not ALL_MONTHS and month_idx != 3:  # April only by default
        continue
    label = cell.get('label')
    if label not in ('Payments','Cash Sales'): continue
    row_type = 'payments' if label == 'Payments' else 'cash_sales'
    loc = cell.get('loc')
    for du in cell.get('dupes', []):
        amount, desc = parse_amt_desc(du['lines'][0])
        if amount is None: continue
        # If count > 2, remove (count-1) times to leave one
        for _ in range(du['count'] - 1):
            profit_actions.append({
                'loc': loc, 'month_idx': month_idx, 'row_type': row_type,
                'amount': amount, 'description': desc,
                'line_preview': du['lines'][0],
            })

print(f'Profit26 actions to perform: {len(profit_actions)}')
for a in profit_actions[:50]:
    print(f'  {a["loc"]:7s} mo{a["month_idx"]+1} {a["row_type"]:10s} ${a["amount"]:>9} | {a["line_preview"]}')
if len(profit_actions) > 50:
    print(f'  … and {len(profit_actions)-50} more')

# ── col G dedup ─────────────────────────────────────────────────────────────
def filter_col_g_dupe(line):
    """Only auto-remove dupes with explicit M/D date tail (avoids removing
    structural lines like '75 CPI' that may legitimately appear once per
    fee event but duplicate by coincidence)."""
    return bool(re.search(r'\b\d{1,2}/\d{1,2}\b\s*$', line.strip()))

col_g_actions = []
for d in data.get('col_g', []):
    tab = d.get('tab') or 'Deals26'
    loc = d.get('loc')
    row = d.get('row')
    car_desc = d.get('car_desc')
    safe_dupes = []
    for du in d.get('dupes', []):
        if filter_col_g_dupe(du['lines'][0]):
            safe_dupes.append(du)
        else:
            print(f'  SKIP col G dupe (no date — manual review): {tab} r{row}: {du["lines"][0]}')
    if safe_dupes:
        col_g_actions.append({
            'tab': tab, 'loc': loc, 'row': row, 'car_desc': car_desc,
            'dupes': safe_dupes,
        })

print()
print(f'col G deals to fix: {len(col_g_actions)}')
for d in col_g_actions:
    for du in d['dupes']:
        print(f'  {d["tab"]} {d["loc"]} r{d["row"]} ({d["car_desc"][:30]}): remove {du["count"]-1} of "{du["lines"][0]}"')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to execute.')
    sys.exit(0)

# ── APPLY ──────────────────────────────────────────────────────────────────
print()
print('Applying…')

# Profit26
pr_ok = pr_err = 0
for a in profit_actions:
    try:
        resp = gas({'action': 'profit_remove_entry', 'location': a['loc'],
            'data': {'month_idx': a['month_idx'], 'row_type': a['row_type'],
                     'amount': a['amount'], 'description': a['description']}})
        if resp and resp.get('ok'):
            pr_ok += 1
            print(f'  ✓ removed {a["loc"]} mo{a["month_idx"]+1}: {a["line_preview"]}')
        else:
            pr_err += 1
            print(f'  ✗ {a["loc"]}: {a["line_preview"]} → {resp}')
    except Exception as e:
        pr_err += 1
        print(f'  ✗ {a["loc"]}: {a["line_preview"]} → {e}')

# col G — for each deal, rewrite cell with deduped notes
cg_ok = cg_err = 0
for d in col_g_actions:
    tab, loc, row, car_desc = d['tab'], d['loc'], d['row'], d['car_desc']
    # Re-read current notes
    resp = gas({'action':'read_all','tab':tab,'location':loc})
    rows = (resp or {}).get('rows', [])
    cur_row = next((r for r in rows if r.get('_sheetRow') == row), None)
    if not cur_row:
        cg_err += 1
        print(f'  ✗ {tab} {loc} r{row}: row not found')
        continue
    cur_notes = cur_row.get('payment_notes') or ''
    cur_lines = cur_notes.split('\n')
    # Build new lines: remove ONE copy of each duplicate
    to_remove = {(du['lines'][0]).strip(): du['count'] - 1 for du in d['dupes']}
    new_lines = []
    for ln in cur_lines:
        s = ln.strip()
        if s in to_remove and to_remove[s] > 0:
            to_remove[s] -= 1
            continue
        new_lines.append(ln)
    new_notes = '\n'.join(new_lines).rstrip()
    # Compute new total = sum of remaining amounts
    total = 0.0
    for ln in new_lines:
        amt, _ = parse_amt_desc(ln)
        if amt is not None: total += amt
    try:
        resp = gas({'action':'correct_payments','location':loc,
            'data':{'tab':tab,'row':row,
                    'new_total':round(total,2),
                    'new_notes': new_notes,
                    'expected_car_desc': car_desc}})
        if resp and resp.get('ok'):
            cg_ok += 1
            print(f'  ✓ {tab} {loc} r{row}: deduped col G')
        else:
            cg_err += 1
            print(f'  ✗ {tab} {loc} r{row}: {resp}')
    except Exception as e:
        cg_err += 1
        print(f'  ✗ {tab} {loc} r{row}: {e}')

print()
print(f'SUMMARY')
print(f'  Profit26 removed: ok={pr_ok} err={pr_err}')
print(f'  col G   deduped : ok={cg_ok} err={cg_err}')
