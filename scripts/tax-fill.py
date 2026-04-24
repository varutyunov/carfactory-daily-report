#!/usr/bin/env python3
"""
Server-side tax fill. Mirrors the in-app _fillMissingTaxes() logic so
it keeps running even when Vlad's phone app is closed.

Fetches deals26 rows with taxes=0 + VIN set, filters out Out-of-State
deals, matches each VIN against PendingSalesDebary.csv or
PendingSalesDeland.csv, and PATCHes taxes + recomputed owed into
Supabase + writes through to the Google Sheet via the Apps Script
endpoint.

Intended to be run on a GitHub Actions cron (every 4 hours). Idempotent
— safe to re-run; rows with taxes already set are skipped automatically
(the initial Supabase query filters on taxes=0).

Env vars (set in workflow):
  SHEETS_URL      - Apps Script web app URL
  SHEETS_SECRET   - shared secret
  SUPABASE_URL    - Supabase project URL
  SUPABASE_KEY    - anon key (enough for deals26 R/W under current RLS)
"""

import csv
import json
import os
import ssl
import sys
import urllib.parse
import urllib.request

SUPABASE = os.environ.get('SUPABASE_URL', 'https://hphlouzqlimainczuqyc.supabase.co') + '/rest/v1'
KEY = os.environ.get('SUPABASE_KEY',
    'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo')
GS_URL = os.environ.get('SHEETS_URL',
    'https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GS_SECRET = os.environ.get('SHEETS_SECRET', 'cf-sync-2026')
CTX = ssl.create_default_context()


def sb(method, path, body=None):
    h = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if body is not None:
        h['Content-Type'] = 'application/json'
        h['Prefer'] = 'return=representation'
    req = urllib.request.Request(f'{SUPABASE}/{path}',
                                 data=json.dumps(body).encode() if body else None,
                                 headers=h, method=method)
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        if r.status == 204:
            return None
        return json.loads(r.read())


def gs(body):
    body = dict(body)
    body['secret'] = GS_SECRET
    req = urllib.request.Request(GS_URL,
                                 data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read())


def load_tax_map():
    tax_map = {}
    for path in ('PendingSalesDebary.csv', 'PendingSalesDeland.csv'):
        if not os.path.exists(path):
            print(f'  (missing CSV: {path})')
            continue
        with open(path) as f:
            for row in csv.DictReader(f):
                v = (row.get('vin') or '').strip()
                if not v:
                    continue
                st = float(row.get('salestax') or 0)
                tg = float(row.get('tagfee') or 0)
                tt = float(row.get('titlefee') or 0)
                tax_map[v] = round(st + tg + tt, 2)
    return tax_map


def main():
    print('[tax-fill] loading CSV tax map...')
    tax_map = load_tax_map()
    print(f'  {len(tax_map)} VINs in CSV tax map')

    print('[tax-fill] querying deals26 for missing taxes...')
    missing = sb('GET', 'deals26?taxes=eq.0&sold_inv_vin=neq.'
                 '&select=id,sort_order,car_desc,location,sold_inv_vin,money,cost,expenses,dealer_fee,manny'
                 '&limit=200')
    if not missing:
        print('  nothing to fill. exiting.')
        return 0
    print(f'  {len(missing)} candidates')

    # Filter out out-of-state + get deal_type for cash-sale follow-up
    vins = [(r['sold_inv_vin'] or '').strip() for r in missing]
    inlist = '(' + ','.join(f'"{v}"' for v in vins if v) + ')'
    deals = sb('GET', f'deals?vin=in.{urllib.parse.quote(inlist)}&select=vin,out_of_state,deal_type')
    oos_by_vin = {d['vin']: d for d in (deals or [])}

    filled = 0
    skipped_oos = 0
    not_in_csv = 0
    errors = 0

    for row in missing:
        vin = (row['sold_inv_vin'] or '').strip()
        d = oos_by_vin.get(vin)
        if d and d.get('out_of_state') is True:
            print(f'  SKIP OOS  r{row["sort_order"]:<4} {row.get("car_desc","")[:35]}')
            skipped_oos += 1
            continue

        # Match by full VIN or prefix (CSV sometimes has leading/trailing)
        match_key = None
        if vin in tax_map:
            match_key = vin
        else:
            for k in tax_map:
                if k and (vin.startswith(k) or k.startswith(vin)):
                    match_key = k
                    break
        if not match_key:
            print(f'  NOT-IN-CSV r{row["sort_order"]:<4} {row.get("car_desc","")[:35]:35} VIN ..{vin[-6:] if vin else ""}')
            not_in_csv += 1
            continue

        tax = tax_map[match_key]
        if tax <= 0:
            print(f'  ZERO-TAX  r{row["sort_order"]:<4} {row.get("car_desc","")[:35]}')
            continue

        money = float(row.get('money') or 0)
        cost = float(row.get('cost') or 0)
        exp = float(row.get('expenses') or 0)
        df = float(row.get('dealer_fee') or 0)
        mn = float(row.get('manny') or 0)
        owed = round(money - cost - exp - tax - df - mn, 2)

        try:
            sb('PATCH', f'deals26?id=eq.{row["id"]}', {'taxes': tax, 'owed': owed})
            gs({
                'action': 'update',
                'location': row.get('location') or 'DeBary',
                'tab': 'Deals26',
                'row_index': row['sort_order'],
                'data': {'taxes': tax, 'owed': owed},
            })
            print(f'  FILL      r{row["sort_order"]:<4} {row.get("car_desc","")[:35]:35} tax=${tax} owed=${owed}')
            filled += 1
        except Exception as e:
            print(f'  ERROR     r{row["sort_order"]}: {e}')
            errors += 1

    print()
    print(f'[tax-fill] done. filled={filled} skipped_oos={skipped_oos} not_in_csv={not_in_csv} errors={errors}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
