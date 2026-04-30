#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
auto_link_accounts.py
Auto-link deal rows to CSV accounts.

Two passes:
  1. VIN match (highest confidence) — deal.sold_inv_vin = csv_accounts.vin.
  2. Name+year+model match (medium) — deal car_desc surname + year + model
     matches exactly one csv_accounts row.

Anything else gets written to scripts/account_links_ambiguous.json for
human pick. The JSON has structured rows ready for Vlad to scan and
pick a custaccountno per deal.

Idempotent: skip deals already linked unless --refresh.

Usage:
  python scripts/auto_link_accounts.py            # dry-run, prints summary
  python scripts/auto_link_accounts.py --apply    # writes links
  python scripts/auto_link_accounts.py --apply --refresh  # also re-checks linked
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

APPLY = '--apply' in sys.argv
REFRESH = '--refresh' in sys.argv

def gas(body, retries=2):
    body['secret'] = GAS_SECRET
    data = json.dumps(body).encode()
    last = None
    for a in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data,
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if a < retries: time.sleep(3)
    raise last

def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_get_all(table, params=''):
    out, offset = [], 0
    while True:
        page = sb_get(table, params + f'&limit=1000&offset={offset}')
        out.extend(page)
        if len(page) < 1000: break
        offset += 1000
    return out

def sb_post(table, rows):
    data = json.dumps(rows).encode()
    req = urllib.request.Request(
        f'{SB_URL}/rest/v1/{table}',
        data=data,
        headers={**SB_HDR, 'Content-Type': 'application/json',
                 'Prefer': 'resolution=merge-duplicates,return=minimal'},
        method='POST',
    )
    with urllib.request.urlopen(req, timeout=60) as r:
        return r.status

# ── Load csv_accounts (indexed by vin and by surname) ───────────────────────
print('Loading csv_accounts…')
accounts = sb_get_all('csv_accounts',
    'select=custaccountno,location,lookupname,vin,year,make,model,'
    'is_active,total_paid_2026,last_payment_date,latest_txn_type')
acct_by_vin = defaultdict(list)
acct_by_surname = defaultdict(list)
for a in accounts:
    if a.get('vin'):
        acct_by_vin[a['vin'].strip().upper()].append(a)
    name = (a.get('lookupname') or '').strip().upper()
    if name:
        # Prefer LAST surname token (Cuban 2-word names: 'DIAZ ORALES'
        # → indexes both 'DIAZ' and 'ORALES').
        pre = name.split(',')[0].strip()
        for tok in pre.split():
            if len(tok) >= 3:
                acct_by_surname[tok].append(a)
print(f'  {len(accounts)} accounts ({sum(1 for a in accounts if a.get("vin"))} with VIN)')

# ── Load all deals ──────────────────────────────────────────────────────────
print('Loading deals…')
all_deals = []
rows = sb_get_all('deals26',
    'select=id,car_desc,owed,location,sold_inv_vin,sort_order')
for r in rows:
    cd = (r.get('car_desc') or '').strip()
    if not cd: continue
    all_deals.append({
        'tab': 'Deals26', 'loc': r.get('location') or 'DeBary',
        'row': r.get('sort_order'),
        'car_desc': cd, 'owed': float(r.get('owed') or 0),
        'vin': (r.get('sold_inv_vin') or '').strip().upper(),
    })
print(f'  Deals26: {len(rows)}')
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action': 'read_all', 'tab': tab, 'location': loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                all_deals.append({
                    'tab': tab, 'loc': loc,
                    'row': r.get('_sheetRow'),
                    'car_desc': cd, 'owed': float(r.get('owed') or 0),
                    'vin': (r.get('sold_inv_vin') or '').strip().upper(),
                })
            print(f'  {tab} {loc}: ok')
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}')

print(f'  Total deals: {len(all_deals)}')

# ── Load existing links ─────────────────────────────────────────────────────
existing = {l['deal_key']: l for l in sb_get_all('deal_account_links',
    'select=deal_key,custaccountno,source')}
print(f'  Existing links: {len(existing)}')

# ── Auto-link by VIN ────────────────────────────────────────────────────────
print()
print('Auto-linking by VIN…')
auto_links_vin = []
auto_links_name = []
ambiguous = []
no_match = []
skipped_existing = 0

def deal_key(d):
    return f'{d["tab"]}:{d["loc"]}:{d["row"]}'

# Helper for car_desc parsing
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze','burgundy','champagne','charcoal','copper',
          'cream','ivory'}
def parse_car_desc(cd):
    """Return {year2, model_first, color, surname}."""
    toks = cd.split()
    if not toks: return {}
    yr2 = ''
    if re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]
        yr2 = y[2:] if len(y) == 4 else y
        toks = toks[1:]
    surname = (toks[-1].lower().rstrip('.,;:') if toks else '')
    toks_mid = toks[:-1] if len(toks) > 1 else []
    color = ''
    model_tokens = []
    for t in toks_mid:
        tl = t.lower()
        if tl in COLORS and not color:
            color = tl; continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3'): continue
        model_tokens.append(t)
    return {
        'year2': yr2,
        'model_first': model_tokens[0].lower() if model_tokens else '',
        'color': color,
        'surname': surname,
    }

for d in all_deals:
    dk = deal_key(d)
    if dk in existing and not REFRESH:
        skipped_existing += 1
        continue
    matched = None; reason = None
    # Pass 1: VIN
    if d['vin']:
        cands = acct_by_vin.get(d['vin'], [])
        if len(cands) == 1:
            matched = cands[0]; reason = 'auto-vin'
        elif len(cands) > 1:
            # Multiple accounts with same VIN — pick the one with most
            # recent payment activity (the customer rebought).
            cands_active = sorted(cands,
                key=lambda a: (a.get('last_payment_date') or '', a.get('custaccountno') or ''),
                reverse=True)
            matched = cands_active[0]; reason = 'auto-vin-multi'
    # Pass 2: name + year + model (when no VIN match)
    if not matched:
        meta = parse_car_desc(d['car_desc'])
        surname = meta.get('surname','')
        if surname and len(surname) >= 3:
            cands = acct_by_surname.get(surname.upper(), [])
            # Narrow by year + model
            narrowed = []
            for a in cands:
                a_year = (str(a.get('year','')) or '')[-2:]
                a_model = (a.get('model','') or '').lower()
                yr_ok = bool(meta.get('year2')) and bool(a_year) and a_year == meta['year2']
                mdl_ok = bool(meta.get('model_first')) and bool(a_model) and \
                         meta['model_first'] in a_model
                if yr_ok and mdl_ok:
                    narrowed.append(a)
            if len(narrowed) == 1:
                matched = narrowed[0]; reason = 'auto-name-yr-mdl'
            elif len(narrowed) > 1:
                ambiguous.append({'deal': d, 'candidates': narrowed,
                                  'reason': 'name+year+model multi-match'})
                continue
            elif len(cands) == 1:
                # Surname unique — but no year/model corroboration. Push
                # to ambiguous so Vlad confirms before linking. Safer
                # than trusting a single-surname coincidence.
                ambiguous.append({'deal': d, 'candidates': cands,
                                  'reason': 'surname-only single (year/model missing on either side)'})
                continue
            elif len(cands) > 1:
                ambiguous.append({'deal': d, 'candidates': cands,
                                  'reason': f'surname has {len(cands)} accounts (no year/model match)'})
                continue
            else:
                no_match.append({'deal': d, 'reason': 'no surname account'})
                continue
        else:
            no_match.append({'deal': d, 'reason': 'no surname in car_desc'})
            continue
    if matched:
        if reason.startswith('auto-vin'):
            auto_links_vin.append({'deal': d, 'acct': matched, 'reason': reason})
        else:
            auto_links_name.append({'deal': d, 'acct': matched, 'reason': reason})

print()
print(f'AUTO-LINK PLAN:')
print(f'  by VIN:                {len(auto_links_vin)}')
print(f'  by name+year+model:    {len(auto_links_name)}')
print(f'  ambiguous:             {len(ambiguous)}')
print(f'  no match:              {len(no_match)}')
print(f'  already linked (skip): {skipped_existing}')

# Filter ambiguous: only show ones for "active" deals (owed > 0 or
# recent col G activity matters most). Actually owed > 0 means not paid
# off — those are the priority. Also include deals with VIN missing AND
# in Deals26 (active 2026 inventory).
def deal_is_priority(d):
    return d['owed'] > 0 or d['tab'] == 'Deals26'

priority_ambig = [a for a in ambiguous if deal_is_priority(a['deal'])]
priority_nomatch = [n for n in no_match if deal_is_priority(n['deal'])]
print(f'  priority ambig (owed>0 or Deals26): {len(priority_ambig)}')
print(f'  priority no-match: {len(priority_nomatch)}')

# Save ambiguous to JSON for human pick
out = {
    'generated': datetime.now().isoformat(),
    'auto_vin_count': len(auto_links_vin),
    'auto_name_count': len(auto_links_name),
    'ambiguous': [
        {
            'deal_key': deal_key(a['deal']),
            'deal_tab': a['deal']['tab'], 'deal_loc': a['deal']['loc'],
            'deal_row': a['deal']['row'],
            'deal_car_desc': a['deal']['car_desc'],
            'deal_owed': a['deal']['owed'],
            'deal_vin': a['deal']['vin'],
            'reason': a['reason'],
            'candidates': [{
                'custaccountno': c['custaccountno'],
                'lookupname': c.get('lookupname'),
                'vin': c.get('vin'),
                'year': c.get('year'), 'make': c.get('make'), 'model': c.get('model'),
                'is_active': c.get('is_active'),
                'last_payment_date': c.get('last_payment_date'),
                'total_paid_2026': c.get('total_paid_2026'),
            } for c in a['candidates']],
        }
        for a in priority_ambig
    ],
    'no_match': [
        {
            'deal_key': deal_key(n['deal']),
            'deal_tab': n['deal']['tab'], 'deal_loc': n['deal']['loc'],
            'deal_row': n['deal']['row'],
            'deal_car_desc': n['deal']['car_desc'],
            'deal_owed': n['deal']['owed'],
            'deal_vin': n['deal']['vin'],
            'reason': n['reason'],
        }
        for n in priority_nomatch
    ],
}
out_path = os.path.join(REPO, 'scripts', 'account_links_ambiguous.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(out, f, indent=2, default=str)
print(f'Ambiguous → {out_path}')

if not APPLY:
    print()
    print('Dry-run only. Re-run with --apply to write links.')
    sys.exit(0)

# ── Apply ───────────────────────────────────────────────────────────────────
print()
print('Applying auto-links…')
to_insert = []
for grp, label in [(auto_links_vin, 'auto-vin'), (auto_links_name, 'auto-name')]:
    for it in grp:
        d = it['deal']; a = it['acct']
        to_insert.append({
            'deal_key': deal_key(d),
            'deal_tab': d['tab'], 'deal_loc': d['loc'], 'deal_row': d['row'],
            'custaccountno': a['custaccountno'],
            'car_desc_at_link': d['car_desc'],
            'vin_at_link': d['vin'] or None,
            'linked_by': it['reason'],
            'source': label,
        })

# Insert in batches
BATCH = 200
ins_ok = ins_err = 0
for i in range(0, len(to_insert), BATCH):
    batch = to_insert[i:i+BATCH]
    try:
        sb_post('deal_account_links', batch)
        ins_ok += len(batch)
        print(f'  inserted batch {i//BATCH+1}: {len(batch)}')
    except urllib.error.HTTPError as e:
        msg = e.read()[:500].decode()
        # Skip already-linked rows
        if '23505' in msg:
            print(f'  batch {i//BATCH+1}: some duplicates, retry one-by-one')
            for row in batch:
                try: sb_post('deal_account_links', [row]); ins_ok += 1
                except urllib.error.HTTPError as e2:
                    if '23505' not in e2.read()[:200].decode():
                        ins_err += 1
        else:
            ins_err += len(batch)
            print(f'  ERR batch {i//BATCH+1}: {msg}')

print(f'Inserted: {ins_ok} | errors: {ins_err}')
print(f'Ambiguous list saved at {out_path} for human pick.')
