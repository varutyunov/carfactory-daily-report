#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rollback_audit_adds.py
Reverse the MISSING_PROFIT_ADD and MISSING_COL_G_ADD entries that today's
audit_2026.py --apply run wrote to the sheet. Reads the per-line log
at scripts/audit_2026_log.txt and removes each entry it added.

Why: today's audit pushed 49 entries to Profit26 Payments and 29 to
col G. The Profit26 adds inflated the April total by ~$28k because
the audit used current F (deal's current owed) to decide which cell
to use, but many payments correctly belonged in col G when received
(deal was below threshold at the time). Rolling back is safer than
guessing F-at-time-of-payment for each.

Behaviour:
  - Removes Profit26 adds via profit_remove_entry (matches by amount +
    description text).
  - Removes col G adds by reading the row, dropping the matched line,
    rewriting via correct_payments.

Usage:
  python scripts/rollback_audit_adds.py            # dry-run
  python scripts/rollback_audit_adds.py --apply    # execute
  python scripts/rollback_audit_adds.py --profit-only  # only Profit26 adds
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

APPLY = '--apply' in sys.argv
PROFIT_ONLY = '--profit-only' in sys.argv

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

# ── Parse log ───────────────────────────────────────────────────────────────
log_path = os.path.join(REPO, 'scripts', 'audit_2026_log.txt')
print(f'Reading {log_path}…')
with open(log_path, encoding='utf-8') as f:
    log_lines = f.read().split('\n')

# Profit26 adds: '  MISSING_PROFIT_ADD DeBary mo4: "260 15 Passat smith 4/1"'
profit_adds = []
PROFIT_RE = re.compile(r'^\s*MISSING_PROFIT_ADD\s+(\S+)\s+mo(\d+):\s*"([^"]+)"')
for ln in log_lines:
    m = PROFIT_RE.match(ln)
    if not m: continue
    loc = m.group(1)
    month_idx = int(m.group(2)) - 1
    raw = m.group(3)
    # Parse '$X description M/D'
    am = re.match(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$', raw)
    if not am: continue
    try: amount = float(am.group(1).replace(',', ''))
    except ValueError: continue
    desc = am.group(2).strip()
    profit_adds.append({'loc': loc, 'month_idx': month_idx,
                        'amount': round(amount, 2),
                        'description': desc, 'raw': raw})

# col G adds: '  MISSING_COL_G_ADD Deals26 DeBary r5: "100 Silverado 4D logan 4/2"'
col_g_adds = []
COL_G_RE = re.compile(r'^\s*MISSING_COL_G_ADD\s+(\S+)\s+(\S+)\s+r(\d+):\s*"([^"]+)"')
for ln in log_lines:
    m = COL_G_RE.match(ln)
    if not m: continue
    tab = m.group(1)
    loc = m.group(2)
    sort_or_row = int(m.group(3))
    raw = m.group(4).strip()
    col_g_adds.append({'tab': tab, 'loc': loc, 'sort_or_row': sort_or_row, 'raw': raw})

print(f'  Profit26 adds to roll back: {len(profit_adds)}')
print(f'  col G adds to roll back  : {len(col_g_adds)}')

# ── Plan ────────────────────────────────────────────────────────────────────
print()
print('=== Profit26 rollback plan ===')
for p in profit_adds[:60]:
    print(f'  {p["loc"]:7s} mo{p["month_idx"]+1:>2} ${p["amount"]:>9.2f} | {p["raw"]}')
if len(profit_adds) > 60:
    print(f'  … and {len(profit_adds)-60} more')

if not PROFIT_ONLY:
    print()
    print('=== col G rollback plan ===')
    for c in col_g_adds[:30]:
        print(f'  {c["tab"]} {c["loc"]} r{c["sort_or_row"]:>3} | {c["raw"]}')
    if len(col_g_adds) > 30:
        print(f'  … and {len(col_g_adds)-30} more')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to execute.')
    sys.exit(0)

# ── Apply Profit26 rollbacks ───────────────────────────────────────────────
print()
print('Rolling back Profit26 entries…')
pf_ok = pf_err = 0
for p in profit_adds:
    try:
        resp = gas({'action':'profit_remove_entry','location':p['loc'],
            'data':{'month_idx': p['month_idx'], 'row_type':'payments',
                    'amount': p['amount'], 'description': p['description']}})
        if resp and resp.get('ok'):
            pf_ok += 1
            print(f'  ✓ {p["loc"]} mo{p["month_idx"]+1}: removed "{p["raw"]}"')
        else:
            pf_err += 1
            print(f'  ✗ {p["loc"]}: {p["raw"]} → {resp}')
    except Exception as e:
        pf_err += 1
        print(f'  ✗ {p["loc"]}: {e}')

if PROFIT_ONLY:
    print()
    print(f'Profit26 rollback: ok={pf_ok} err={pf_err}')
    sys.exit(0 if pf_err == 0 else 1)

# ── Apply col G rollbacks ──────────────────────────────────────────────────
print()
print('Rolling back col G entries…')
# Group by row so we batch removals per deal
cg_by_row = defaultdict(list)
for c in col_g_adds:
    # The log uses sort_order for Deals26 (off-by-one) — we need to handle
    # both. For Deals25/24 the value IS the sheet row.
    cg_by_row[(c['tab'], c['loc'], c['sort_or_row'])].append(c['raw'])

cg_ok = cg_err = 0
# Need a fresh read of each row to remove correctly
loc_to_rows = defaultdict(dict)  # (tab, loc) → {sheet_row: row_data}
for tab in ('Deals26','Deals25','Deals24'):
    for loc in ('DeBary','DeLand'):
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                loc_to_rows[(tab,loc)][r.get('_sheetRow')] = r
        except Exception as e:
            print(f'  WARN read {tab} {loc}: {e}')
            time.sleep(2)

for (tab, loc, sort_or_row), lines in cg_by_row.items():
    # For Deals26 the log captured sort_order; sheet row = sort_order + 1.
    if tab == 'Deals26':
        sheet_row = sort_or_row + 1
    else:
        sheet_row = sort_or_row
    rows = loc_to_rows.get((tab, loc), {})
    cur = rows.get(sheet_row)
    if not cur:
        cg_err += 1
        print(f'  ✗ {tab} {loc} r{sheet_row}: row not found')
        continue
    cur_lines = (cur.get('payment_notes') or '').split('\n')
    keep = []
    to_remove = list(lines)
    for ln in cur_lines:
        s = ln.strip()
        if s in to_remove:
            to_remove.remove(s)
            continue
        keep.append(ln)
    new_notes = '\n'.join(keep).rstrip()
    new_total = 0.0
    for ln in keep:
        m = re.match(r'^\s*(-?[\d,]+(?:\.\d+)?)\s', ln.strip())
        if m:
            try: new_total += float(m.group(1).replace(',',''))
            except ValueError: pass
    try:
        resp = gas({'action':'correct_payments','location':loc,
            'data':{'tab':tab,'row':sheet_row,
                    'new_total': round(new_total, 2),
                    'new_notes': new_notes,
                    'expected_car_desc': cur.get('car_desc')}})
        if resp and resp.get('ok'):
            cg_ok += len(lines)
            print(f'  ✓ {tab} {loc} r{sheet_row}: removed {len(lines)} ({cur.get("car_desc","")[:30]})')
        else:
            cg_err += 1
            print(f'  ✗ {tab} {loc} r{sheet_row}: {resp}')
    except Exception as e:
        cg_err += 1
        print(f'  ✗ {tab} {loc} r{sheet_row}: {e}')

print()
print(f'SUMMARY: profit26_removed=({pf_ok},{pf_err}) col_g_removed=({cg_ok},{cg_err})')
