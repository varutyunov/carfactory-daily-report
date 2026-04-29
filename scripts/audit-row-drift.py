#!/usr/bin/env python3
"""
Audit every table that stores a sheet row as an identifier for drift.
For each row in deal_links / payment_deal_aliases / carpay_payment_postings
that has a (location, target_tab, target_row, car_desc), read the current
sheet cell and compare.

Status:
  OK      - current car_desc matches stored car_desc
  DRIFT   - current car_desc differs (stored link is stale)
  EMPTY   - row is empty or doesn't exist
"""

import json
import os
import ssl
import sys
import time
import urllib.request
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_KEY as KEY  # noqa: E402

SB = f'{SB_URL}/rest/v1'
GS = 'https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec'
CTX = ssl.create_default_context()


def sb_get(path):
    req = urllib.request.Request(f'{SB}/{path}',
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


def gs(body):
    body = dict(body); body['secret'] = 'cf-sync-2026'
    req = urllib.request.Request(GS, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read())


def norm(s):
    return (s or '').strip().lower()


def audit(table, key_field='id', extra_select=''):
    print(f'\n=== {table} ===')
    sel = f'id,location,target_tab,target_row,car_desc{extra_select}'
    rows = sb_get(f'{table}?select={sel}&limit=5000')
    print(f'{len(rows)} rows to check')
    results = {'OK': 0, 'DRIFT': [], 'EMPTY': []}
    for r in rows:
        tab = r.get('target_tab')
        row = r.get('target_row')
        loc = r.get('location')
        stored = r.get('car_desc') or ''
        if not (tab and row and loc):
            continue
        try:
            d = gs({'action': 'deals26_get_row_g', 'location': loc,
                    'data': {'tab': tab, 'row': row}})
            cur = d.get('car_desc') or ''
        except Exception as e:
            print(f'  err id={r[key_field]}: {e}')
            continue
        if not cur.strip():
            results['EMPTY'].append({**r, 'current_car_desc': cur})
        elif norm(cur) == norm(stored):
            results['OK'] += 1
        else:
            results['DRIFT'].append({**r, 'current_car_desc': cur})
        time.sleep(0.12)
    print(f'  OK:    {results["OK"]}')
    print(f'  DRIFT: {len(results["DRIFT"])}')
    print(f'  EMPTY: {len(results["EMPTY"])}')
    if results['DRIFT']:
        print('  Drift details:')
        for x in results['DRIFT']:
            print(f'    id={x["id"]} {x["location"]} {x["target_tab"]} r{x["target_row"]}')
            print(f'      stored:  {x["car_desc"]}')
            print(f'      current: {x["current_car_desc"]}')
    if results['EMPTY']:
        print('  Empty targets:')
        for x in results['EMPTY']:
            print(f'    id={x["id"]} {x["location"]} {x["target_tab"]} r{x["target_row"]} stored: {x["car_desc"][:50]}')
    return results


def main():
    all_drift = []
    for table in ('deal_links', 'payment_deal_aliases'):
        res = audit(table)
        all_drift.extend([{'table': table, **x} for x in res['DRIFT']])
        all_drift.extend([{'table': table, 'empty': True, **x} for x in res['EMPTY']])
    # carpay_payment_postings has slightly different schema (target_tab can be null, etc)
    # only audit rows with status=posted that have target_tab+target_row
    print('\n=== carpay_payment_postings (status=posted only) ===')
    rows = sb_get('carpay_payment_postings?status=eq.posted&target_tab=not.is.null&target_row=not.is.null&select=id,reference,account,location,target_tab,target_row,car_desc,amount&limit=5000')
    print(f'{len(rows)} posted rows to check')
    ok = 0; drift = []; empty = []
    for r in rows:
        tab = r.get('target_tab'); row = r.get('target_row')
        loc_raw = r.get('location') or ''
        loc = 'DeBary' if loc_raw.lower() == 'debary' else ('DeLand' if loc_raw.lower() == 'deland' else loc_raw)
        stored = r.get('car_desc') or ''
        try:
            d = gs({'action': 'deals26_get_row_g', 'location': loc,
                    'data': {'tab': tab, 'row': row}})
            cur = d.get('car_desc') or ''
        except Exception as e:
            print(f'  err id={r["id"]}: {e}')
            continue
        if not cur.strip():
            empty.append({**r, 'current_car_desc': cur})
        elif norm(cur) == norm(stored):
            ok += 1
        else:
            drift.append({**r, 'current_car_desc': cur})
        time.sleep(0.12)
    print(f'  OK:    {ok}')
    print(f'  DRIFT: {len(drift)}')
    print(f'  EMPTY: {len(empty)}')
    for x in drift:
        print(f'  DRIFT id={x["id"]} ref={x["reference"]} acc={x["account"]} ${x["amount"]} {loc} {x["target_tab"]} r{x["target_row"]}')
        print(f'    stored:  {x["car_desc"]}')
        print(f'    current: {x["current_car_desc"]}')
    all_drift.extend([{'table': 'carpay_payment_postings', **x} for x in drift])
    all_drift.extend([{'table': 'carpay_payment_postings', 'empty': True, **x} for x in empty])
    print()
    print('=' * 60)
    print(f'TOTAL drifted/empty entries: {len(all_drift)}')


if __name__ == '__main__':
    main()
