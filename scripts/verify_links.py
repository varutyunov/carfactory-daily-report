#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_links.py — sanity-check each deal_account_links row by comparing
the deal's car (from car_desc) to the linked account's vehicle data
(from csv_accounts).year/make/model.

Outputs three buckets:
  PERFECT — VIN match between deals and account, OR exact year+model match
  PARTIAL — year matches but model differs OR vice versa (review)
  MISMATCH — clear different-car link (year AND model both differ)

For MISMATCH: with --apply, unlink (delete deal_account_links row) so
the audit treats the deal as unlinked rather than mis-attributed.
PARTIAL stays for manual review.

Usage:
  python scripts/verify_links.py            # dry-run, list all 3 buckets
  python scripts/verify_links.py --apply    # unlink confirmed MISMATCHes
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request, urllib.parse
from collections import defaultdict

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

def sb_all(t, p=''):
    out, off = [], 0
    while True:
        url = f'{SB_URL}/rest/v1/{t}?{p}&limit=1000&offset={off}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=SB_HDR), timeout=30) as r:
            page = json.loads(r.read())
        out.extend(page); off += 1000
        if len(page) < 1000: break
    return out

# Common model-name aliases — variants that should be treated as same.
# 3-Series covers 320/325/328/330/335; 5-Series covers 528/535/540; etc.
BMW_3 = {'3-series', '320i', '325i', '328i', '330i', '335i', '340i',
         '320', '325', '328', '330', '335', '330e'}
BMW_5 = {'5-series', '528i', '535i', '540i', '550i', '528', '535', '540'}
BMW_7 = {'7-series', '730i', '740i', '750i', '760li'}
F_SERIES = {'f150', 'f-150', 'f250', 'f-250', 'f250sd', 'f-250sd', 'f350', 'f-350', 'f350sd'}
CRV = {'cr-v', 'crv'}
HRV = {'hr-v', 'hrv'}
G35 = {'g35', 'g-35'}
ALIASES = [BMW_3, BMW_5, BMW_7, F_SERIES, CRV, HRV, G35]

def model_match(a, b):
    """Lenient model match — handles BMW 328i vs 3-Series, F250 vs F250SD,
    CR-V vs CRV, etc."""
    if not a or not b: return False
    a, b = a.lower().strip(), b.lower().strip()
    if a == b: return True
    if a in b or b in a: return True
    # Token-by-token (drop non-alnum)
    a_toks = re.findall(r'[a-z0-9]+', a)
    b_toks = re.findall(r'[a-z0-9]+', b)
    if not a_toks or not b_toks: return False
    if a_toks[0] == b_toks[0]: return True  # first token match
    # Alias groups
    for grp in ALIASES:
        a_in = any(t in grp for t in a_toks) or a in grp
        b_in = any(t in grp for t in b_toks) or b in grp
        if a_in and b_in: return True
    return False

# Load deals (with VIN if available)
print('Loading deals…')
all_deals = {}
for r in sb_all('deals26', 'select=car_desc,location,sort_order,sold_inv_vin,owed'):
    cd = (r.get('car_desc') or '').strip()
    if not cd: continue
    dk = f'Deals26:{r.get("location")}:{r.get("sort_order")}'
    all_deals[dk] = {'tab':'Deals26','loc':r.get('location'),'sheet_row':(r.get('sort_order') or 0)+1,
                    'car_desc':cd,'vin':(r.get('sold_inv_vin') or '').strip().upper(),
                    'owed':float(r.get('owed') or 0)}
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp=gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows',[]):
                cd=(r.get('car_desc') or '').strip()
                if not cd: continue
                dk = f'{tab}:{loc}:{r.get("_sheetRow")}'
                all_deals[dk] = {'tab':tab,'loc':loc,'sheet_row':r.get('_sheetRow'),
                                'car_desc':cd,'vin':(r.get('sold_inv_vin') or '').strip().upper(),
                                'owed':float(r.get('owed') or 0)}
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)

print('Loading links + accounts…')
links = sb_all('deal_account_links','select=*')
accts = {a['custaccountno']: a for a in sb_all('csv_accounts','select=*')}

COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze'}
def parse_car(cd):
    toks = (cd or '').split()
    if not toks: return {'year':'','model':''}
    yr2 = ''
    if re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]; yr2 = y[2:] if len(y)==4 else y; toks = toks[1:]
    mdl_tokens = []
    for t in (toks[:-1] if len(toks)>1 else []):
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS: continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3','cp','gt','si','rt','xl','sd','td','tdi'): continue
        if len(tl) >= 2: mdl_tokens.append(tl)
    return {'year2': yr2, 'model': ' '.join(mdl_tokens[:2])}

# Classify each link
perfect = []
partial = []
mismatch = []
no_inv = []
for l in links:
    deal = all_deals.get(l['deal_key'])
    acct = accts.get(l['custaccountno'])
    if not deal or not acct: continue
    deal_meta = parse_car(deal['car_desc'])
    deal_yr = deal_meta['year2']
    deal_mdl = deal_meta['model']
    a_yr = (str(acct.get('year','')) or '')[-2:]
    a_mdl = (acct.get('model') or '').lower()
    a_make = (acct.get('make') or '').lower()
    deal_vin = deal.get('vin','')
    a_vin = (acct.get('vin','') or '').strip().upper()

    is_manual = (l.get('source') or '').lower() in ('manual', 'manual-vlad-pick',
                                                     'auto-followup', 'auto-active')

    # VIN exact match → perfect (skip further checks)
    if deal_vin and a_vin and deal_vin == a_vin:
        perfect.append({'l':l,'reason':'VIN'}); continue

    # Account has no inv data → can't verify; trust the link unless manual
    # picks (we already trust those)
    if not a_yr and not a_mdl:
        no_inv.append({'l':l,'deal':deal,'acct':acct,'reason':'no-inv-data'}); continue

    yr_ok = bool(deal_yr) and bool(a_yr) and deal_yr == a_yr
    mdl_ok = model_match(deal_mdl, a_mdl)

    if yr_ok and mdl_ok:
        perfect.append({'l':l,'reason':'yr-mdl'})
    elif yr_ok or mdl_ok:
        partial.append({'l':l,'deal':deal,'acct':acct,
                       'reason':f'{"yr" if yr_ok else ""}{"," if yr_ok and mdl_ok else ""}{"mdl" if mdl_ok else ""}-only'.strip(',')})
    else:
        # Year AND model differ. If manual link, leave it (Vlad knows
        # something we don't). If auto, mark for unlink.
        if is_manual:
            partial.append({'l':l,'deal':deal,'acct':acct,
                           'reason':'manual-pick-yr+mdl-differ'})
        else:
            mismatch.append({'l':l,'deal':deal,'acct':acct,'reason':'yr-and-mdl-differ'})

print()
print(f'Total links: {len(links)}')
print(f'  PERFECT  (VIN or yr+model match): {len(perfect)}')
print(f'  NO-INV   (account has no inv data, cannot verify): {len(no_inv)}')
print(f'  PARTIAL  (yr OR mdl match, not both): {len(partial)}')
print(f'  MISMATCH (clearly different car):     {len(mismatch)}')

if mismatch:
    print()
    print('=== MISMATCHES (would be unlinked) ===')
    for m in mismatch:
        d, a = m['deal'], m['acct']
        print(f'  {m["l"]["deal_key"]:30s} | {d["car_desc"][:35]:35s} | acct={a["custaccountno"]} {a.get("lookupname","")[:25]:25s} {a.get("year")} {a.get("make")} {a.get("model")} ({m["reason"]})')

if partial:
    print()
    print('=== PARTIAL (manual review, not auto-unlinked) ===')
    for p in partial[:30]:
        d, a = p['deal'], p['acct']
        print(f'  {p["l"]["deal_key"]:30s} | {d["car_desc"][:35]:35s} | acct={a["custaccountno"]} {a.get("year")} {a.get("make")} {a.get("model")} ({p["reason"]})')
    if len(partial) > 30: print(f'  … and {len(partial)-30} more')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to unlink MISMATCHES.')
    sys.exit(0)

# Apply: unlink the mismatches
print()
print(f'Unlinking {len(mismatch)} mismatched links…')
ok = err = 0
for m in mismatch:
    dk = m['l']['deal_key']
    url = f'{SB_URL}/rest/v1/deal_account_links?deal_key=eq.{urllib.parse.quote(dk)}'
    req = urllib.request.Request(url, headers={**SB_HDR,'Prefer':'return=minimal'}, method='DELETE')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ok += 1
    except Exception as e:
        err += 1
        print(f'  ERR {dk}: {e}')
print(f'Done: ok={ok} err={err}')
