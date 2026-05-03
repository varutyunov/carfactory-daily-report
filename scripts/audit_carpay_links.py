#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_carpay_links.py
Cross-reference every CarPay customer against csv_accounts, deal_account_links,
and app data (inventory + deals) to detect wrong account-to-deal links.

A wrong link means payments get posted to the wrong deal row, which corrupts:
  - col G (payment ledger)
  - F value (owed / threshold)
  - Profit26 entries (profit attributed to wrong lot/month)

Uses the vehicle triangulation concept: three independent data sources must agree.
  1. CarPay portal  → carpay_customers.vehicle  (from sync resolveVehicle)
  2. DMS CSVs       → csv_accounts year/make/model (gold standard, keyed by account)
  3. App deal data  → deals/inventory vehicle_desc (keyed by stock/VIN)

Detection only — no writes.

Usage:
  python scripts/audit_carpay_links.py               # run audit
  python scripts/audit_carpay_links.py --verbose      # per-account detail
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, ssl, urllib.request
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_KEY, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

VERBOSE = '--verbose' in sys.argv
CTX = ssl.create_default_context()
TODAY = datetime.now().strftime('%Y-%m-%d')

# ── Alias groups for model matching ──────────────────────────────────────
BMW_3 = {'3-series', '320i', '325i', '328i', '330i', '335i', '340i',
         '320', '325', '328', '330', '335', '330e'}
BMW_5 = {'5-series', '528i', '535i', '540i', '550i', '528', '535', '540'}
BMW_7 = {'7-series', '730i', '740i', '750i', '760li'}
F_SERIES = {'f150', 'f-150', 'f250', 'f-250', 'f250sd', 'f-250sd',
            'f350', 'f-350', 'f350sd'}
CRV = {'cr-v', 'crv'}
HRV = {'hr-v', 'hrv'}
G35 = {'g35', 'g-35'}
RAV4 = {'rav4', 'rav-4'}
EXPRESS = {'express', 'g3500', 'g3500 vans', 'express passenger'}
IS250 = {'is250', 'is 250'}
IS350 = {'is350', 'is 350'}
ALIASES = [BMW_3, BMW_5, BMW_7, F_SERIES, CRV, HRV, G35, RAV4,
           EXPRESS, IS250, IS350]

COLORS = {'black', 'white', 'silver', 'grey', 'gray', 'red', 'blue',
          'green', 'gold', 'tan', 'brown', 'orange', 'yellow', 'purple',
          'maroon', 'beige', 'burgundy', 'charcoal', 'champagne', 'bronze',
          'copper', 'cream', 'navy', 'teal', 'turquoise', 'pewter'}
SKIP_TOKENS = {'trade', 'rbt', 'stick', 'lifted', 'cp', 'gt', 'si', 'rt',
               'xl', 'sd', 'td', 'tdi', 'no', 'na', 'touring', '2d', '4d',
               'awd', 'fwd', 'rwd', '2', '3', '4', 'bumper'}


# ── HTTP helpers ─────────────────────────────────────────────────────────

def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


def sb_get_all(table, params=''):
    out, off = [], 0
    while True:
        page = sb_get(table, params + f'&limit=1000&offset={off}')
        out.extend(page)
        off += 1000
        if len(page) < 1000:
            break
    return out


def gas(body, retries=2):
    body['secret'] = GAS_SECRET
    last = None
    for a in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL,
                data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, context=CTX, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if a < retries:
                import time; time.sleep(3)
    raise last


# ── Vehicle parsing & matching ───────────────────────────────────────────

def parse_car_desc(cd):
    """Parse a deal car_desc like '14 Accord silver rbt stick 72k Souza'
    into {year2, model, surname}."""
    toks = (cd or '').strip().split()
    if not toks:
        return {'year2': '', 'model': '', 'surname': ''}
    yr2 = ''
    if re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]
        yr2 = y[2:] if len(y) == 4 else y
        toks = toks[1:]
    # Surname is last token
    surname = toks[-1].lower().rstrip('.,;:') if toks else ''
    # Model tokens — everything between year and surname, minus colors/mileage/tags
    mdl_toks = []
    for t in (toks[:-1] if len(toks) > 1 else toks):
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS:
            continue
        if re.match(r'^\d+k?$', tl):
            continue
        if tl in SKIP_TOKENS:
            continue
        if len(tl) >= 2:
            mdl_toks.append(tl)
    return {'year2': yr2, 'model': ' '.join(mdl_toks[:2]), 'surname': surname}


def parse_carpay_vehicle(v):
    """Parse carpay_customers.vehicle like '14 Honda Accord' → {year2, make, model}."""
    parts = (v or '').strip().split()
    if not parts:
        return {'year2': '', 'make': '', 'model': ''}
    yr2 = ''
    rest = parts[:]
    if parts and re.match(r'^(19|20)\d{2}$', parts[0]):
        yr2 = parts[0][2:]
        rest = parts[1:]
    elif parts and re.match(r'^\d{2}$', parts[0]):
        yr2 = parts[0]
        rest = parts[1:]
    make = rest[0] if rest else ''
    model = ' '.join(rest[1:]) if len(rest) > 1 else ''
    # If there's no model but there is make, it IS the model (single-word vehicle)
    if not model and make:
        model, make = make, ''
    return {'year2': yr2, 'make': make, 'model': model}


def parse_csv_vehicle(row):
    """Parse csv_accounts row → {year2, make, model}."""
    yr = str(row.get('year') or '').strip()
    yr2 = yr[2:] if len(yr) == 4 else yr if len(yr) == 2 else ''
    return {
        'year2': yr2,
        'make': (row.get('make') or '').strip(),
        'model': (row.get('model') or '').strip(),
    }


def model_match(a, b):
    """Lenient model match — handles BMW 328i vs 3-Series, F250 vs F250SD,
    CR-V vs CRV, IS350 vs IS 350, Express vs G3500, etc."""
    if not a or not b:
        return False
    a, b = a.lower().strip(), b.lower().strip()
    if a == b:
        return True
    if a in b or b in a:
        return True
    # Strip all non-alnum for space-collapsed comparison (IS350 == IS 350)
    a_flat = re.sub(r'[^a-z0-9]', '', a)
    b_flat = re.sub(r'[^a-z0-9]', '', b)
    if a_flat == b_flat:
        return True
    if a_flat in b_flat or b_flat in a_flat:
        return True
    # Token-by-token (drop non-alnum)
    a_toks = re.findall(r'[a-z0-9]+', a)
    b_toks = re.findall(r'[a-z0-9]+', b)
    if not a_toks or not b_toks:
        return False
    if a_toks[0] == b_toks[0]:
        return True
    # Alias groups
    for grp in ALIASES:
        a_in = any(t in grp for t in a_toks) or a in grp
        b_in = any(t in grp for t in b_toks) or b in grp
        if a_in and b_in:
            return True
    return False


def year_match(a, b):
    """Compare 2-digit year strings."""
    if not a or not b:
        return False
    return a.strip() == b.strip()


def vehicle_agrees(va, vb):
    """True if two parsed vehicles agree on year AND model."""
    if not va or not vb:
        return False
    yr_ok = year_match(va.get('year2', ''), vb.get('year2', ''))
    mdl_ok = model_match(va.get('model', ''), vb.get('model', ''))
    return yr_ok and mdl_ok


def vehicle_short(v):
    """Human-readable short form from a parsed vehicle dict."""
    yr = v.get('year2', '')
    make = v.get('make', '')
    model = v.get('model', '')
    parts = [p for p in [yr, make, model] if p]
    return ' '.join(parts) if parts else '(none)'


# ── Data loading ─────────────────────────────────────────────────────────

def load_all():
    """Load all data sources into memory. Returns dict of indexed lookups."""
    data = {}

    # 1. CarPay customers
    print('Loading carpay_customers...')
    rows = sb_get_all('carpay_customers',
        'select=account,name,vehicle,location,stock_no,vin_last6')
    data['carpay'] = {r['account']: r for r in rows if r.get('account')}
    print(f'  {len(data["carpay"])} customers')

    # 2. CSV accounts (DMS gold standard)
    print('Loading csv_accounts...')
    rows = sb_get_all('csv_accounts',
        'select=custaccountno,lookupname,vin,stock_no,year,make,model,'
        'color,location,is_active,saledate,total_paid_2026,'
        'last_payment_date,latest_txn_type')
    data['csv'] = {r['custaccountno']: r for r in rows if r.get('custaccountno')}
    print(f'  {len(data["csv"])} accounts')

    # 3. Deal account links
    print('Loading deal_account_links...')
    rows = sb_get_all('deal_account_links',
        'select=custaccountno,deal_key,car_desc_at_link,linked_at,linked_by')
    data['links'] = defaultdict(list)
    for r in rows:
        if r.get('custaccountno'):
            data['links'][r['custaccountno']].append(r)
    print(f'  {sum(len(v) for v in data["links"].values())} links')

    # 4. App deals (Supabase deals table)
    print('Loading deals (app)...')
    rows = sb_get_all('deals',
        'select=stock,vehicle_desc,vin,customer_name')
    data['app_deals'] = {}
    data['app_vin6'] = {}
    for r in rows:
        if r.get('stock'):
            data['app_deals'][str(r['stock'])] = r
        if r.get('vin') and len(r['vin']) >= 6:
            data['app_vin6'][r['vin'][-6:]] = r

    # 5. App inventory
    rows = sb_get_all('inventory', 'select=stock,name,vin')
    for r in rows:
        stk = str(r.get('stock') or '')
        if stk and stk not in data['app_deals']:
            data['app_deals'][stk] = {
                'vehicle_desc': r.get('name'), 'vin': r.get('vin'),
                'stock': r.get('stock'), 'customer_name': ''
            }
        if r.get('vin') and len(r['vin']) >= 6:
            v6 = r['vin'][-6:]
            if v6 not in data['app_vin6']:
                data['app_vin6'][v6] = {
                    'vehicle_desc': r.get('name'), 'vin': r.get('vin'),
                    'stock': r.get('stock'), 'customer_name': ''
                }
    print(f'  {len(data["app_deals"])} vehicles (deals+inventory)')

    # 6. Payment postings (where payments actually went)
    print('Loading carpay_payment_postings...')
    rows = sb_get_all('carpay_payment_postings',
        'select=account,target_tab,target_row,car_desc,status,location')
    data['postings'] = defaultdict(list)
    for r in rows:
        if r.get('account'):
            data['postings'][r['account']].append(r)
    print(f'  {sum(len(v) for v in data["postings"].values())} postings')

    return data


# ── The five checks ──────────────────────────────────────────────────────

def check_csv_existence(account, csv_map):
    """Check 1: Does account exist in csv_accounts with vehicle data?"""
    csv = csv_map.get(account)
    if not csv:
        return {'status': 'no_csv', 'detail': 'Account not in csv_accounts'}
    yr = (csv.get('year') or '').strip()
    mdl = (csv.get('model') or '').strip()
    if not yr and not mdl:
        return {'status': 'csv_no_vehicle', 'detail': 'csv_accounts has no vehicle data',
                'csv_name': csv.get('lookupname', '')}
    return {'status': 'ok', 'csv_name': csv.get('lookupname', ''),
            'csv_vehicle': f"{csv.get('year','')} {csv.get('make','')} {csv.get('model','')}".strip()}


def check_vehicle_triangulation(carpay_cust, csv_row, link_rows, app_deals, app_vin6):
    """Check 2: Do the three independent vehicle sources agree?

    Sources:
      A. carpay_customers.vehicle (from sync resolveVehicle)
      B. csv_accounts year/make/model (DMS gold standard)
      C. deal car_desc (via deal_account_links → deal row)

    Also checks App data (deals/inventory by stock/VIN) as a 4th cross-ref.
    """
    sources = {}

    # Source A: CarPay vehicle
    veh_a = parse_carpay_vehicle(carpay_cust.get('vehicle'))
    if veh_a['model']:
        sources['carpay'] = veh_a

    # Source B: CSV vehicle
    veh_b = parse_csv_vehicle(csv_row) if csv_row else None
    if veh_b and veh_b['model']:
        sources['csv'] = veh_b

    # Source C: Deal vehicle (from the link's car_desc_at_link)
    # Multi-link: if ANY link matches csv, prefer that one (the customer
    # may have multiple deals — old + new — and the csv-matching one is
    # the currently active vehicle).
    veh_c = None
    if link_rows:
        best_link = None
        if veh_b and veh_b['model'] and len(link_rows) > 1:
            for lk in link_rows:
                cd = (lk.get('car_desc_at_link') or '').strip()
                if cd:
                    lp = parse_car_desc(cd)
                    lv = {'year2': lp['year2'], 'model': lp['model'], 'make': ''}
                    if vehicle_agrees(lv, veh_b):
                        best_link = lk
                        break
        if not best_link:
            best_link = link_rows[-1]
        cd = best_link.get('car_desc_at_link', '')
        if cd:
            parsed = parse_car_desc(cd)
            veh_c = {'year2': parsed['year2'], 'model': parsed['model'],
                     'make': '', 'surname': parsed['surname']}
            if veh_c['model']:
                sources['deal_link'] = veh_c

    # Source D (bonus): App data by stock
    stock = carpay_cust.get('stock_no')
    vin6 = carpay_cust.get('vin_last6')
    veh_d = None
    if stock and str(stock) in app_deals:
        app = app_deals[str(stock)]
        veh_d = parse_carpay_vehicle(app.get('vehicle_desc'))
        if veh_d['model']:
            sources['app_stock'] = veh_d
    if not veh_d and vin6 and vin6 in app_vin6:
        app = app_vin6[vin6]
        veh_d = parse_carpay_vehicle(app.get('vehicle_desc'))
        if veh_d['model']:
            sources['app_vin'] = veh_d

    if len(sources) < 2:
        return {
            'status': 'one_source',
            'detail': f'Only {len(sources)} source(s): {list(sources.keys())}',
            'sources': {k: vehicle_short(v) for k, v in sources.items()},
        }

    # Pairwise comparisons
    keys = list(sources.keys())
    agreements = []
    conflicts = []
    for i in range(len(keys)):
        for j in range(i + 1, len(keys)):
            ka, kb = keys[i], keys[j]
            if vehicle_agrees(sources[ka], sources[kb]):
                agreements.append((ka, kb))
            else:
                conflicts.append((ka, kb, vehicle_short(sources[ka]),
                                  vehicle_short(sources[kb])))

    if not conflicts:
        return {
            'status': 'ok',
            'detail': f'All {len(sources)} sources agree',
            'sources': {k: vehicle_short(v) for k, v in sources.items()},
            'agreements': len(agreements),
        }

    # Check if deal_link specifically conflicts with csv (the dangerous case)
    deal_vs_csv = [c for c in conflicts
                   if ('deal_link' in (c[0], c[1]) and 'csv' in (c[0], c[1]))]

    if deal_vs_csv:
        return {
            'status': 'mismatch',
            'detail': 'Deal vehicle disagrees with CSV (DMS)',
            'sources': {k: vehicle_short(v) for k, v in sources.items()},
            'conflicts': conflicts,
        }

    # Other conflicts (e.g., app vs carpay)
    return {
        'status': 'warning',
        'detail': f'{len(conflicts)} conflict(s) among sources',
        'sources': {k: vehicle_short(v) for k, v in sources.items()},
        'conflicts': conflicts,
    }


def check_link_health(account, link_rows, csv_row, all_csv):
    """Check 3: Does a deal_account_links entry exist, and does its vehicle
    match csv_accounts?"""
    if not link_rows:
        return {'status': 'no_link', 'detail': 'No deal_account_links entry'}

    # Multi-link: if ANY link matches csv, prefer that one
    csv_parsed = parse_csv_vehicle(csv_row) if csv_row else None
    best_link = None
    if csv_parsed and csv_parsed['model'] and len(link_rows) > 1:
        for lk in link_rows:
            cd = (lk.get('car_desc_at_link') or '').strip()
            if cd:
                lp = parse_car_desc(cd)
                lv = {'year2': lp['year2'], 'model': lp['model'], 'make': ''}
                if vehicle_agrees(lv, csv_parsed):
                    best_link = lk
                    break
    if not best_link:
        best_link = link_rows[-1]

    link_cd = (best_link.get('car_desc_at_link') or '').strip()
    link_parsed = parse_car_desc(link_cd) if link_cd else None

    if not csv_row:
        return {'status': 'no_csv', 'detail': 'Link exists but no csv_accounts to verify',
                'link_vehicle': link_cd, 'deal_key': best_link.get('deal_key')}

    if not csv_parsed or not csv_parsed['model']:
        return {'status': 'csv_no_vehicle', 'detail': 'Link exists, csv_accounts has no vehicle',
                'link_vehicle': link_cd, 'deal_key': best_link.get('deal_key')}

    if not link_parsed or not link_parsed['model']:
        return {'status': 'no_link_vehicle', 'detail': 'Link car_desc_at_link is empty',
                'deal_key': best_link.get('deal_key')}

    if vehicle_agrees(link_parsed, csv_parsed):
        return {'status': 'ok', 'detail': 'Link vehicle matches CSV',
                'link_vehicle': link_cd, 'csv_vehicle': vehicle_short(csv_parsed),
                'deal_key': best_link.get('deal_key')}

    # Trade-up detection: csv shows old vehicle but the customer bought a
    # new car. Indicators:
    #   - csv saledate is significantly older than the link creation date
    #   - link points to a more recent deal tab (Deals26 > Deals25 > Deals24)
    #   - the linked deal has a different (newer) vehicle
    csv_sale = (csv_row.get('saledate') or '')
    link_at = (best_link.get('linked_at') or '')[:10]  # YYYY-MM-DD
    link_tab = best_link.get('deal_tab', '')
    # If csv sale predates 2026 and link is in Deals26, or csv sale is
    # more than 6 months before link creation, flag as trade-up.
    is_trade_up = False
    if csv_sale and link_tab == 'Deals26' and csv_sale < '2026-01-01':
        is_trade_up = True
    elif csv_sale and link_at and csv_sale < link_at[:7]:  # compare YYYY-MM
        # CSV sale month is before link creation month
        from datetime import datetime as dt
        try:
            sd = dt.strptime(csv_sale[:10], '%Y-%m-%d')
            ld = dt.strptime(link_at[:10], '%Y-%m-%d')
            if (ld - sd).days > 180:
                is_trade_up = True
        except ValueError:
            pass
    if is_trade_up:
        return {
            'status': 'trade_up',
            'detail': f'Likely trade-up: csv sale {csv_sale}, link {link_tab}',
            'link_vehicle': link_cd,
            'csv_vehicle': vehicle_short(csv_parsed),
            'deal_key': best_link.get('deal_key'),
        }

    return {
        'status': 'mismatch',
        'detail': 'Link vehicle does NOT match CSV',
        'link_vehicle': link_cd,
        'csv_vehicle': vehicle_short(csv_parsed),
        'deal_key': best_link.get('deal_key'),
    }


def check_posting_consistency(account, postings, csv_row):
    """Check 4: Have payments been routed to a deal whose vehicle matches csv?"""
    posted = [p for p in postings if p.get('status') == 'posted' and p.get('car_desc')]
    if not posted:
        return {'status': 'no_postings', 'detail': 'No posted payments'}

    if not csv_row or not csv_row.get('model'):
        return {'status': 'no_csv', 'detail': 'Postings exist but no csv vehicle to verify'}

    csv_parsed = parse_csv_vehicle(csv_row)

    # Check each unique posting car_desc
    car_descs = list({p['car_desc'] for p in posted})
    mismatches = []
    for cd in car_descs:
        cd_parsed = parse_car_desc(cd)
        if cd_parsed['model'] and not vehicle_agrees(cd_parsed, csv_parsed):
            mismatches.append(cd)

    if not mismatches:
        return {'status': 'ok', 'detail': f'{len(posted)} postings match CSV vehicle',
                'posting_count': len(posted)}

    return {
        'status': 'mismatch',
        'detail': f'Payments posted to wrong vehicle',
        'csv_vehicle': vehicle_short(csv_parsed),
        'posted_vehicle': mismatches[0],
        'posting_count': len(posted),
        'mismatch_count': sum(1 for p in posted
                              if p['car_desc'] in mismatches),
    }


def check_cosigner_compound(carpay_cust, csv_row, link_rows):
    """Check 5: Flag cosigners / compound names / multi-deal accounts."""
    flags = []
    name = (carpay_cust.get('name') or '').strip()

    # Compound surname (multiple words before comma)
    if csv_row:
        lookup = (csv_row.get('lookupname') or '').strip()
        pre = lookup.split(',')[0].strip() if ',' in lookup else lookup
        if len(pre.split()) > 1:
            flags.append(f'compound_surname:{pre}')

    # Multiple links (customer has multiple deals)
    if len(link_rows) > 1:
        flags.append(f'multi_deal:{len(link_rows)}_links')

    # Hyphenated name (parsing edge case)
    if '-' in name.split(',')[0]:
        flags.append('hyphenated_name')

    return {
        'status': 'flagged' if flags else 'ok',
        'flags': flags,
    }


# ── Classification ───────────────────────────────────────────────────────

def classify(checks):
    """Aggregate check results into a final bucket."""
    c1 = checks['csv_existence']
    c2 = checks['triangulation']
    c3 = checks['link_health']
    c4 = checks['postings']
    c5 = checks['cosigner']

    # Trade-up: csv shows old vehicle, link points to newer deal. Not wrong.
    if c3.get('status') == 'trade_up':
        return 'confirmed_flagged'

    # Critical: vehicle mismatch in triangulation or link health
    if c2.get('status') == 'mismatch' or c3.get('status') == 'mismatch':
        if c4.get('status') == 'mismatch':
            return 'wrong_postings'  # damage already done
        return 'wrong_link'

    # No CSV data at all
    if c1.get('status') == 'no_csv':
        return 'no_csv_data'

    # No link but csv exists
    if c3.get('status') == 'no_link' and c1.get('status') == 'ok':
        return 'needs_link'

    # Posting mismatch without triangulation mismatch (edge case)
    if c4.get('status') == 'mismatch':
        return 'wrong_postings'

    # Warning-level issues
    if c2.get('status') == 'warning':
        return 'warning'

    # Only one source — can't fully confirm
    if c2.get('status') == 'one_source':
        if c5.get('status') == 'flagged':
            return 'ambiguous'
        return 'likely_ok'

    # Cosigner/compound flagged but vehicles agree
    if c5.get('status') == 'flagged':
        return 'confirmed_flagged'

    # Everything checks out
    return 'confirmed'


# ── Main ─────────────────────────────────────────────────────────────────

def main():
    print(f'audit_carpay_links — {TODAY}')
    print('=' * 60)
    data = load_all()
    print()

    results = []
    buckets = defaultdict(list)

    for account, cust in sorted(data['carpay'].items()):
        csv_row = data['csv'].get(account)
        link_rows = data['links'].get(account, [])
        postings = data['postings'].get(account, [])

        checks = {
            'csv_existence': check_csv_existence(account, data['csv']),
            'triangulation': check_vehicle_triangulation(
                cust, csv_row, link_rows,
                data['app_deals'], data['app_vin6']),
            'link_health': check_link_health(account, link_rows, csv_row, data['csv']),
            'postings': check_posting_consistency(account, postings, csv_row),
            'cosigner': check_cosigner_compound(cust, csv_row, link_rows),
        }

        bucket = classify(checks)
        entry = {
            'account': account,
            'name': cust.get('name', ''),
            'location': cust.get('location', ''),
            'carpay_vehicle': cust.get('vehicle', ''),
            'bucket': bucket,
            'checks': checks,
        }
        results.append(entry)
        buckets[bucket].append(entry)

        if VERBOSE:
            status_icon = {'confirmed': '+', 'confirmed_flagged': '+',
                           'likely_ok': '~', 'needs_link': '?',
                           'wrong_link': 'X', 'wrong_postings': 'X',
                           'warning': '!', 'no_csv_data': '-',
                           'ambiguous': '?'}.get(bucket, '?')
            print(f'  [{status_icon}] {account} {cust.get("name",""):30s} '
                  f'{cust.get("vehicle",""):25s} -> {bucket}')

    # ── Summary ──────────────────────────────────────────────────────────
    print()
    print(f'=== RESULTS ({len(results)} accounts) ===')
    order = ['confirmed', 'confirmed_flagged', 'likely_ok', 'needs_link',
             'warning', 'wrong_link', 'wrong_postings', 'no_csv_data', 'ambiguous']
    for b in order:
        if b in buckets:
            print(f'  {b:20s} {len(buckets[b]):>4}')
    other = set(buckets.keys()) - set(order)
    for b in sorted(other):
        print(f'  {b:20s} {len(buckets[b]):>4}')

    # ── Detail: wrong links and wrong postings ───────────────────────────
    critical = buckets.get('wrong_link', []) + buckets.get('wrong_postings', [])
    if critical:
        print()
        label = 'WRONG LINK / WRONG POSTINGS'
        print(f'-- {label} ({len(critical)}) --')
        for e in critical:
            srcs = e['checks']['triangulation'].get('sources', {})
            conflicts = e['checks']['triangulation'].get('conflicts', [])
            print(f'  acct={e["account"]} {e["name"][:30]:30s} loc={e["location"]}')
            print(f'    carpay:    {srcs.get("carpay", "(none)")}')
            print(f'    csv(DMS):  {srcs.get("csv", "(none)")}')
            print(f'    deal_link: {srcs.get("deal_link", "(none)")}')
            if srcs.get('app_stock'):
                print(f'    app_stock: {srcs["app_stock"]}')
            if srcs.get('app_vin'):
                print(f'    app_vin:   {srcs["app_vin"]}')
            c3 = e['checks']['link_health']
            if c3.get('link_vehicle'):
                print(f'    link car_desc: "{c3["link_vehicle"]}"')
            if c3.get('csv_vehicle'):
                print(f'    csv vehicle:   "{c3["csv_vehicle"]}"')
            c4 = e['checks']['postings']
            if c4.get('status') == 'mismatch':
                print(f'    POSTED TO WRONG DEAL: {c4.get("mismatch_count",0)} '
                      f'payments to "{c4.get("posted_vehicle","?")}"')
            print()

    # ── Detail: needs link ───────────────────────────────────────────────
    needs = buckets.get('needs_link', [])
    if needs:
        print(f'-- NEEDS LINK ({len(needs)}) --')
        for e in needs:
            csv_info = e['checks']['csv_existence']
            print(f'  acct={e["account"]} {e["name"][:30]:30s} '
                  f'csv={csv_info.get("csv_vehicle","?")}')
        print()

    # ── Detail: warnings ─────────────────────────────────────────────────
    warns = buckets.get('warning', [])
    if warns:
        print(f'-- WARNINGS ({len(warns)}) --')
        for e in warns:
            c2 = e['checks']['triangulation']
            print(f'  acct={e["account"]} {e["name"][:30]:30s} '
                  f'{c2.get("detail","")}')
            for conf in c2.get('conflicts', []):
                print(f'    {conf[0]} ({conf[2]}) vs {conf[1]} ({conf[3]})')
        print()

    # ── Detail: no csv data ──────────────────────────────────────────────
    nocsv = buckets.get('no_csv_data', [])
    if nocsv:
        print(f'-- NO CSV DATA ({len(nocsv)}) --')
        for e in nocsv:
            print(f'  acct={e["account"]} {e["name"][:30]:30s} '
                  f'vehicle={e.get("carpay_vehicle","(none)")}')
        print()

    # ── Save JSON plan ──────────────────────────────────────��────────────
    plan = {
        'generated': datetime.utcnow().isoformat() + 'Z',
        'total_accounts': len(results),
        'summary': {b: len(v) for b, v in buckets.items()},
        'findings': [e for e in results
                     if e['bucket'] not in ('confirmed', 'confirmed_flagged', 'likely_ok')],
    }
    plan_path = os.path.join(os.path.dirname(os.path.abspath(__file__)),
                             'audit_carpay_links_plan.json')
    with open(plan_path, 'w', encoding='utf-8') as f:
        json.dump(plan, f, indent=2, default=str)
    print(f'Plan saved to {plan_path}')
    print(f'  ({len(plan["findings"])} non-confirmed findings)')

    # Return exit code: 1 if any wrong links/postings found
    if critical:
        return 1
    return 0


if __name__ == '__main__':
    sys.exit(main())
