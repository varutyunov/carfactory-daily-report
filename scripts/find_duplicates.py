#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
find_duplicates.py — find every duplicate payment entry on the sheet.

Looks at:
  - col G of every deal (Deals26 + Deals25 + Deals24)
  - DeBary + DeLand Profit26 Payments + Cash Sales for every month

For each cell, identifies lines that appear >1 time after normalization
(same amount + same date-tail + same descriptor tokens).

Output: scripts/duplicates.json with all dupes for human review.
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request
from collections import defaultdict, Counter

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

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

def sb_all(t, p=''):
    out, off = [], 0
    while True:
        url = f'{SB_URL}/rest/v1/{t}?{p}&limit=1000&offset={off}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=SB_HDR), timeout=30) as r:
            page = json.loads(r.read())
        out.extend(page); off += 1000
        if len(page) < 1000: break
    return out

# Normalizer: strip whitespace, lowercase, remove punctuation
def normalize(line):
    s = (line or '').strip().lower()
    s = re.sub(r'\s+', ' ', s)
    s = re.sub(r'[,\.;:]', '', s)
    return s

# Find duplicates in a list of lines (treating lines as case-insensitive)
def find_dupes(lines):
    out = []
    cnt = Counter(normalize(ln) for ln in lines if (ln or '').strip())
    for norm, n in cnt.items():
        if n > 1:
            # Get the original variants
            originals = [ln.strip() for ln in lines if normalize(ln) == norm]
            out.append({'normalized': norm, 'count': n, 'lines': originals})
    return out

print('Loading Deals26…')
deals26 = sb_all('deals26', 'select=car_desc,location,sort_order,owed,payment_notes')
print(f'  {len(deals26)}')

print('Loading Deals25 + Deals24 via Apps Script…')
legacy = []
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                legacy.append({
                    'tab': tab, 'location': loc,
                    'sort_order': r.get('_sheetRow'),
                    'car_desc': cd,
                    'owed': r.get('owed'),
                    'payment_notes': r.get('payment_notes') or '',
                })
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)
print(f'  {len(legacy)} legacy rows')

print('Loading Profit26 (both lots)…')
profit_cells = []
for loc in ('DeBary','DeLand'):
    try:
        resp = gas({'action':'read_profit','location':loc})
    except Exception as e:
        print(f'  WARN {loc}: {e}'); continue
    for m in (resp or {}).get('months', []):
        mname = m.get('name') or ''
        for it in m.get('items', []):
            lbl = it.get('label')
            if lbl in ('Payments','Cash Sales'):
                note = it.get('note','') or ''
                if note.strip():
                    profit_cells.append({
                        'loc': loc, 'month': mname, 'label': lbl,
                        'lines': note.split('\n'),
                    })
print(f'  {len(profit_cells)} non-empty Profit26 cells')

# Find dupes
dup_col_g = []
for d in (deals26 + legacy):
    notes = d.get('payment_notes') or ''
    if not notes.strip(): continue
    lines = [ln for ln in notes.split('\n') if ln.strip()]
    dupes = find_dupes(lines)
    if dupes:
        tab = d.get('tab') or 'Deals26'
        loc = d.get('location') or d.get('location')
        row = d.get('sort_order')
        dup_col_g.append({
            'tab': tab, 'loc': loc, 'row': row,
            'car_desc': d.get('car_desc'),
            'owed': d.get('owed'),
            'dupes': dupes,
        })

dup_profit = []
for c in profit_cells:
    dupes = find_dupes(c['lines'])
    if dupes:
        dup_profit.append({**c, 'dupes': dupes})

# Output
print()
print(f'COL G DUPLICATES ({len(dup_col_g)} deals affected):')
total_col_g = 0
for d in dup_col_g:
    print(f'  {d["tab"]} {d["loc"]} r{d["row"]} {d["car_desc"][:40]} F={d["owed"]}')
    for du in d['dupes']:
        total_col_g += du['count'] - 1
        print(f'    × {du["count"]}: {du["lines"][0]}')

print()
print(f'PROFIT26 DUPLICATES ({len(dup_profit)} cells affected):')
total_profit = 0
for c in dup_profit:
    print(f'  {c["loc"]} {c["month"]} {c["label"]}:')
    for du in c['dupes']:
        total_profit += du['count'] - 1
        print(f'    × {du["count"]}: {du["lines"][0]}')

print()
print(f'TOTAL EXTRA col G entries: {total_col_g}')
print(f'TOTAL EXTRA Profit26 entries: {total_profit}')

with open(os.path.join(REPO, 'scripts', 'duplicates.json'), 'w', encoding='utf-8') as f:
    json.dump({
        'col_g': dup_col_g,
        'profit': dup_profit,
        'total_extra_col_g': total_col_g,
        'total_extra_profit': total_profit,
    }, f, indent=2, default=str)
print(f'\nSaved → scripts/duplicates.json')
