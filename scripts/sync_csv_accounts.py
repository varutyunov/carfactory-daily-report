#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
sync_csv_accounts.py
Populate public.csv_accounts from Payments/*.csv + SoldInventory CSVs.

Idempotent: upserts by custaccountno. Run on every cron tick (wired
into inventory-sync.yml).

Build steps for each unique custaccountno seen in payments CSVs:
  1. lookupname, location come from the payments CSV row (location =
     which folder, Payments/Debary or Payments/Deland).
  2. Activity rollups: first/last payment date, lifetime + 2026 totals,
     payment count, latest_txn_type. Skip non-payment ttypes.
  3. Vehicle metadata (vin, stock_no, year, make, model, color,
     saledate) joined from SoldInventory by lookupname; if customer has
     multiple SoldInventory rows (sold cars), pick the latest saledate.
  4. is_active = latest_txn_type != 'PAY OFF' AND last_payment_date >=
     (today - 90d). Captures "still paying" customers.
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import csv, glob, json, os, urllib.request
from collections import defaultdict
from datetime import datetime, timedelta

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

SKIP_PAYMENT_REFS = {'OPEN', 'OPEN REFINANCE OPEN'}

# ── Load SoldInventory by lookupname ────────────────────────────────────────
print('Loading SoldInventory…')
inv_by_name = defaultdict(list)
inv_files = [
    ('Sold Inventory.csv', 'DeBary'),
    ('Sold Inventory Deland.csv', 'DeLand'),
]
for fname, loc in inv_files:
    path = os.path.join(REPO, fname)
    if not os.path.exists(path):
        print(f'  WARN missing: {fname}')
        continue
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            n = (row.get('lookupname') or '').strip().upper()
            if n:
                row['_loc'] = loc
                inv_by_name[n].append(row)
print(f'  {sum(len(v) for v in inv_by_name.values())} SoldInventory rows, '
      f'{len(inv_by_name)} unique lookupnames')

# ── Walk every payments CSV ─────────────────────────────────────────────────
print('Walking payments CSVs…')
acct_meta = {}            # acct → {lookupname, location}
acct_txns = defaultdict(list)  # acct → [{date, amount, type, ref}]

for csv_loc, folder in [('DeBary', 'Debary'), ('DeLand', 'Deland')]:
    pattern = os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')
    files = sorted(glob.glob(pattern))
    if not files:
        print(f'  no CSV in {folder}')
        continue
    # Use the latest CSV; older snapshots are stale.
    path = files[-1]
    print(f'  {csv_loc}: {os.path.basename(path)}')
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            acct = str(row.get('custaccountno', '')).strip()
            if not acct:
                continue
            name = (row.get('lookupname') or '').strip().upper()
            ttype = (row.get('transtype') or '').strip()
            ref = (row.get('reference') or '').strip().upper()
            if acct not in acct_meta:
                acct_meta[acct] = {'lookupname': name, 'location': csv_loc}
            # Skip pure setup rows (down payments / refis)
            if ttype == 'PAYMENT' and ref in SKIP_PAYMENT_REFS:
                continue
            try:
                amt = float(row.get('totalamt', 0) or 0) if ttype != 'LATEFEE' \
                      else float(row.get('latefee', 0) or 0)
            except ValueError:
                amt = 0
            try:
                dt = datetime.strptime(str(row.get('paiddate','')).split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except Exception:
                continue
            if amt <= 0 and ttype != 'PAY OFF':
                continue
            acct_txns[acct].append({
                'date': date_str, 'amount': round(amt, 2),
                'type': ttype, 'ref': ref,
            })

print(f'  {len(acct_meta)} unique accounts')

# ── Build account rows ──────────────────────────────────────────────────────
print('Building account rows…')
today = datetime.now().date()
ACTIVE_THRESHOLD = timedelta(days=90)

rows_to_upsert = []
for acct, meta in acct_meta.items():
    name = meta['lookupname']
    loc  = meta['location']
    txns = acct_txns.get(acct, [])
    txns.sort(key=lambda t: t['date'])
    pay_txns = [t for t in txns if t['type'] in ('PAYMENT','PAYPICK','PAY OFF','LATEFEE')]
    first_dt = pay_txns[0]['date'] if pay_txns else None
    last_dt  = pay_txns[-1]['date'] if pay_txns else None
    latest_type = pay_txns[-1]['type'] if pay_txns else None
    total_lifetime = round(sum(t['amount'] for t in pay_txns), 2)
    total_2026 = round(sum(t['amount'] for t in pay_txns
                           if t['date'].startswith('2026')), 2)

    # Active: latest txn isn't a payoff AND last payment within 90 days.
    is_active = True
    if latest_type == 'PAY OFF':
        is_active = False
    elif last_dt:
        try:
            ld = datetime.strptime(last_dt, '%Y-%m-%d').date()
            if today - ld > ACTIVE_THRESHOLD:
                is_active = False
        except Exception:
            pass

    # SoldInventory join: if customer has multiple sold cars, pick latest
    # by saledate. (Customers who traded up will have the most recent
    # car as their currently-being-paid-on car.)
    inv = None
    inv_rows = inv_by_name.get(name, [])
    if inv_rows:
        def _saledate(r):
            try:
                return datetime.strptime(str(r.get('saledate','')).split(' ')[0], '%m/%d/%Y')
            except Exception:
                return datetime.min
        inv_rows_sorted = sorted(inv_rows, key=_saledate, reverse=True)
        inv = inv_rows_sorted[0]

    row = {
        'custaccountno': acct,
        'location': loc,
        'lookupname': name,
        'vin':       (inv.get('vin') if inv else None) or None,
        'stock_no':  (inv.get('stockno') if inv else None) or None,
        'year':      (str(inv.get('year','')) if inv else '') or None,
        'make':      (inv.get('make') if inv else None) or None,
        'model':     (inv.get('model') if inv else None) or None,
        'color':     None,  # Not in this SoldInventory schema
        'saledate':  None,
        'first_payment_date': first_dt,
        'last_payment_date': last_dt,
        'payment_count': len(pay_txns),
        'total_paid_2026': total_2026,
        'total_paid_lifetime': total_lifetime,
        'latest_txn_type': latest_type,
        'is_active': is_active,
        'synced_at': datetime.now().isoformat(),
    }
    if inv:
        try:
            sd = datetime.strptime(str(inv.get('saledate','')).split(' ')[0], '%m/%d/%Y').date()
            row['saledate'] = sd.isoformat()
        except Exception:
            pass
    rows_to_upsert.append(row)

print(f'  {len(rows_to_upsert)} rows to upsert')
print(f'    with VIN: {sum(1 for r in rows_to_upsert if r["vin"])}')
print(f'    active:   {sum(1 for r in rows_to_upsert if r["is_active"])}')
print(f'    with 2026 activity: {sum(1 for r in rows_to_upsert if r["total_paid_2026"] > 0)}')

# ── Upsert via PostgREST ────────────────────────────────────────────────────
print('Upserting…')
def post_batch(rows):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        f'{SB_URL}/rest/v1/csv_accounts',
        data=data,
        headers={
            **SB_HDR,
            'Content-Type': 'application/json',
            'Prefer': 'resolution=merge-duplicates,return=minimal',
        },
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

BATCH = 200
for i in range(0, len(rows_to_upsert), BATCH):
    batch = rows_to_upsert[i:i+BATCH]
    try:
        status = post_batch(batch)
        print(f'  upserted batch {i//BATCH + 1}: {len(batch)} rows ({status})')
    except urllib.error.HTTPError as e:
        print(f'  ERR batch {i//BATCH + 1}: HTTP {e.code} — {e.read()[:300].decode()}')
        sys.exit(1)
    except Exception as e:
        print(f'  ERR batch {i//BATCH + 1}: {e}')
        sys.exit(1)

print('Done.')
