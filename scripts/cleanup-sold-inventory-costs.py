"""
One-shot cleanup: remove `inventory_costs` rows for cars that have already been
sold (a matching row exists in `deals`). Mirrors what `_autopopulateDeals26` now
does automatically on every new deal — retroactively for pre-existing deals.

Scope: both DeBary and DeLand.

How it works:
  1. Pull every deal with a non-empty VIN from `deals`.
  2. For each VIN, look up the `inventory` row(s) and then the
     `inventory_costs` row(s) linked to those inventory IDs.
  3. For each found inventory_costs row, delete from Supabase AND push a
     delete to the Google Sheet (uses the new name-safe delete endpoint, so
     stale sort_order won't remove the wrong car).

Safety:
  - Trade-in rows (inventory.vin == '') are never touched — no deal points
    to a blank VIN.
  - Dry-run by default; pass `--apply` to actually delete.
  - The Apps Script delete refuses if sheet row's car_name doesn't match,
    so even if sort_order has drifted this won't wipe the wrong row.

Run:
    python scripts/cleanup-sold-inventory-costs.py            # dry run
    python scripts/cleanup-sold-inventory-costs.py --apply    # execute
"""

import json
import os
import sys
import time
import urllib.request
import urllib.error

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL as SUPABASE_URL, SB_KEY as SUPABASE_KEY  # noqa: E402
SHEETS_URL = ('https://script.google.com/macros/s/'
              'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6Wc'
              'wwPh453Xb-luQ/exec')
SHEETS_SECRET = 'cf-sync-2026'


def sb_request(method, path, body=None):
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    headers = {
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    }
    data = None
    if body is not None:
        headers['Content-Type'] = 'application/json'
        headers['Prefer'] = 'return=representation'
        data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    with urllib.request.urlopen(req, timeout=20) as r:
        raw = r.read()
        return json.loads(raw) if raw else None


def sb_get(table, query):
    return sb_request('GET', f'{table}?{query}')


def sb_delete(table, id_):
    return sb_request('DELETE', f'{table}?id=eq.{id_}')


def sheets_delete(location, sort_order, car_name):
    body = {
        'secret': SHEETS_SECRET,
        'tab': 'Inventory',
        'location': location,
        'action': 'delete',
        'row_index': sort_order,
        'data': {'car_name': car_name},
    }
    req = urllib.request.Request(
        SHEETS_URL,
        data=json.dumps(body).encode(),
        headers={'Content-Type': 'text/plain;charset=UTF-8'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())


def main(apply_changes: bool):
    print('Fetching deals with VIN...')
    # PostgREST: not.is.null for non-null; neq for != ''
    deals = sb_get('deals', 'select=id,vin,customer_name,vehicle_desc,location&vin=not.is.null&limit=2000')
    deals = [d for d in deals if (d.get('vin') or '').strip()]
    print(f'  {len(deals)} deals with VIN')

    vins = sorted({d['vin'].strip().upper() for d in deals if d.get('vin')})
    print(f'  {len(vins)} unique VINs')

    # Fetch inventory rows for those VINs
    print('Fetching matching inventory rows...')
    inv_rows = []
    # chunk to avoid URL length limits
    CHUNK = 50
    for i in range(0, len(vins), CHUNK):
        batch = vins[i:i+CHUNK]
        q = 'vin=in.(' + ','.join(urllib.parse.quote(v) for v in batch) + ')&select=id,vin,location'
        rows = sb_get('inventory', q)
        inv_rows.extend(rows or [])
    print(f'  {len(inv_rows)} inventory rows matched by VIN')
    inv_ids = [r['id'] for r in inv_rows if r.get('id')]

    if not inv_ids:
        print('Nothing to do.')
        return

    # Fetch inventory_costs rows linked to those inventory ids
    print('Fetching inventory_costs rows linked to sold cars...')
    ic_rows = []
    for i in range(0, len(inv_ids), CHUNK):
        batch = inv_ids[i:i+CHUNK]
        q = 'car_id=in.(' + ','.join(str(x) for x in batch) + ')&select=id,car_id,car_name,sort_order,location'
        rows = sb_get('inventory_costs', q)
        ic_rows.extend(rows or [])
    print(f'  {len(ic_rows)} inventory_costs rows to remove')

    if not ic_rows:
        print('All sold cars already cleaned up. Nothing to do.')
        return

    print('\nRows to remove:')
    for r in ic_rows:
        print(f"  [{r['location']}] id={r['id']} sort={r['sort_order']} car_name={r['car_name']!r}")

    if not apply_changes:
        print('\nDRY RUN. Re-run with --apply to execute.')
        return

    print(f'\nApplying deletes for {len(ic_rows)} rows...')
    ok_sb = ok_sheet = err_sb = err_sheet = 0
    for r in ic_rows:
        # Delete from Supabase first so the reconciler won't re-push stale
        # data before we get to the sheet delete.
        try:
            sb_delete('inventory_costs', r['id'])
            ok_sb += 1
        except urllib.error.HTTPError as e:
            print(f"  SB DELETE failed id={r['id']}: {e.code} {e.read()[:200]!r}")
            err_sb += 1
            continue

        # Push sheet delete (name-safe via the Apps Script guard)
        try:
            resp = sheets_delete(r['location'], r['sort_order'], r['car_name'])
            if resp.get('ok'):
                ok_sheet += 1
            else:
                print(f"  SHEET DELETE refused for {r['car_name']!r}: {resp}")
                err_sheet += 1
        except Exception as e:
            print(f"  SHEET DELETE error for {r['car_name']!r}: {e}")
            err_sheet += 1

        # Tiny delay so we don't hammer Apps Script
        time.sleep(0.25)

    print(f'\nDone. SB: {ok_sb} ok / {err_sb} err   SHEET: {ok_sheet} ok / {err_sheet} err')


if __name__ == '__main__':
    apply = '--apply' in sys.argv
    main(apply)
