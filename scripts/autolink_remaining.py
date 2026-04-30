#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
autolink_remaining.py — auto-link any unlinked deal where there's
exactly ONE csv_accounts row with the deal's surname (preferring
year+make+model match when available).

Catches deals like 16 Pilot Cruz Velazquez where only one CRUZ VELAZQUEZ
account exists in csv_accounts.

Run before rebuild_april_profit.py to ensure the rebuild's audit covers
all in-profit deals.

Usage:
  python scripts/autolink_remaining.py            # dry-run
  python scripts/autolink_remaining.py --apply    # write links
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

print('Loading…')
links = sb_all('deal_account_links','select=deal_key,custaccountno')
linked_deal_keys = {l['deal_key'] for l in links}
linked_acct_set = {l['custaccountno'] for l in links}
accts = sb_all('csv_accounts','select=*')

# Index csv_accounts by surname token
acct_by_surname = defaultdict(list)
for a in accts:
    name = (a.get('lookupname') or '').strip().upper()
    if ',' not in name: continue
    pre = name.split(',')[0].strip()
    for tok in pre.split():
        if len(tok) >= 3:
            acct_by_surname[tok].append(a)

# Load all deals
all_deals = []
url = f'{SB_URL}/rest/v1/deals26?select=car_desc,location,sort_order,owed,sold_inv_vin&limit=2000'
with urllib.request.urlopen(urllib.request.Request(url, headers=SB_HDR), timeout=30) as r:
    for d in json.loads(r.read()):
        cd = (d.get('car_desc') or '').strip()
        if not cd: continue
        all_deals.append({
            'tab':'Deals26','loc':d.get('location'),
            'sort_order':d.get('sort_order'),'sheet_row':(d.get('sort_order') or 0)+1,
            'car_desc':cd,'owed':float(d.get('owed') or 0),
            'vin': (d.get('sold_inv_vin') or '').strip().upper(),
            'deal_key': f'Deals26:{d.get("location")}:{d.get("sort_order")}',
        })
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp=gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows',[]):
                cd=(r.get('car_desc') or '').strip()
                if not cd: continue
                all_deals.append({
                    'tab':tab,'loc':loc,'sheet_row':r.get('_sheetRow'),
                    'car_desc':cd,'owed':float(r.get('owed') or 0),
                    'vin': (r.get('sold_inv_vin') or '').strip().upper(),
                    'deal_key': f'{tab}:{loc}:{r.get("_sheetRow")}',
                })
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)

# Helper to extract year+model from car_desc
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze'}
def parse_car(cd):
    toks = cd.split()
    if not toks: return {'year':'','model':'','surname':''}
    yr2 = ''
    if re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]; yr2 = y[2:] if len(y)==4 else y; toks = toks[1:]
    surname = (toks[-1].lower().rstrip('.,;:') if toks else '')
    mdl = ''
    for t in (toks[:-1] if len(toks)>1 else []):
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS or re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3','cp','gt','si','rt','xl','sd','td','tdi'): continue
        if len(tl) >= 3:
            mdl = tl; break
    return {'year2':yr2,'model':mdl,'surname':surname}

# Find unlinked deals where only one csv_account has matching surname
candidates = []
for d in all_deals:
    if d['deal_key'] in linked_deal_keys: continue
    if d['owed'] <= 0: continue  # only in-profit
    parsed = parse_car(d['car_desc'])
    surname = parsed['surname']
    if not surname or len(surname) < 3: continue
    # Find csv_accounts with this surname
    matches = acct_by_surname.get(surname.upper(), [])
    # Filter out already-linked accounts? No — the same customer might
    # have multiple deals; one acct → multiple deal_keys is allowed.
    if not matches: continue
    # Prefer accounts that aren't already linked to a different deal
    # (a customer should have ONE active deal per car typically).
    unlinked_accts = [a for a in matches if a['custaccountno'] not in linked_acct_set]
    use = unlinked_accts if unlinked_accts else matches
    # Narrow by year + model match if available
    if parsed.get('year2') and parsed.get('model'):
        narrowed = []
        for a in use:
            ay = (str(a.get('year','')) or '')[-2:]
            am = (a.get('model','') or '').lower()
            if ay == parsed['year2'] and parsed['model'] in am:
                narrowed.append(a)
        if len(narrowed) == 1:
            candidates.append({'deal':d,'acct':narrowed[0],'reason':'unique-yr-mdl'})
            continue
        if len(narrowed) > 1: continue  # ambiguous
    # No yr+mdl match — only auto-link if either:
    #   (a) only one account with this surname AND its inv data is empty
    #       (can't be disproven), OR
    #   (b) only one account with this surname AND its year+model would
    #       match if compared loosely.
    # Reject when account explicitly has DIFFERENT inv data (e.g., Bing
    # Challenger linking to Bing Model S — clearly wrong car).
    if len(use) == 1:
        a = use[0]
        a_year = (str(a.get('year','')) or '')[-2:]
        a_model = (a.get('model','') or '').lower()
        deal_year = parsed.get('year2')
        deal_model = parsed.get('model')
        if not a_year and not a_model:
            # Account has no inv data — can't be disproven
            candidates.append({'deal':d,'acct':a,'reason':'unique-surname-no-inv'})
        elif a_year and deal_year and a_model and deal_model:
            # Both have year+model — accept only if BOTH match
            if a_year == deal_year and deal_model in a_model:
                candidates.append({'deal':d,'acct':a,'reason':'surname-yr-mdl'})
            # else mismatch — skip to avoid wrong link
        else:
            # Partial info — be lenient, accept
            candidates.append({'deal':d,'acct':a,'reason':'unique-surname-partial'})

print(f'\\nAuto-link candidates: {len(candidates)}')
for c in candidates:
    d, a = c['deal'], c['acct']
    print(f'  {d["deal_key"]:30s} F={d["owed"]:>5.0f} | {d["car_desc"][:40]:40s} -> acct={a["custaccountno"]} {a["lookupname"][:30]} ({c["reason"]})')

if not APPLY:
    print('\\nDry-run. Re-run with --apply to write links.')
    sys.exit(0)

print('\\nApplying…')
ok = err = 0
for c in candidates:
    d, a = c['deal'], c['acct']
    body = {
        'deal_key': d['deal_key'],
        'deal_tab': d['tab'], 'deal_loc': d['loc'],
        'deal_row': d.get('sort_order') if d['tab']=='Deals26' else d['sheet_row'],
        'custaccountno': a['custaccountno'],
        'car_desc_at_link': d['car_desc'],
        'vin_at_link': d['vin'] or None,
        'linked_by': c['reason'],
        'source': 'auto-followup',
    }
    req = urllib.request.Request(f'{SB_URL}/rest/v1/deal_account_links',
        data=json.dumps([body]).encode(),
        headers={**SB_HDR, 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates,return=minimal'},
        method='POST')
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ok += 1
            print(f'  + {d["deal_key"]:30s} -> acct {a["custaccountno"]}')
    except Exception as e:
        err += 1
        print(f'  ERR {d["deal_key"]}: {e}')
print(f'\\nLinked {ok}, errors {err}')
