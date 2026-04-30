#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
verify_dupes.py
For each "duplicate" group in scripts/duplicates.json, count the actual
CSV payments matching that amount + customer for that month. If the
CSV count == sheet count, the lines aren't dupes — they're legitimate
recurring same-amount payments. If sheet count > CSV count, the
extras are real dupes.

Strategy per dup line:
  1. Parse amount + surname from the line text.
  2. Find the deal whose surname matches (within the appropriate lot).
  3. Use deal_account_links to get the custaccountno.
  4. Pull csv_accounts → get CSV April/Jan/Feb/Mar txns for that acct.
  5. Count payments matching amount within $1 in the target month.
  6. Compare counts.

Output: scripts/duplicates_verified.json with per-line classification
(REAL_DUPE | LEGITIMATE | UNVERIFIABLE).
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import csv, glob, json, os, re, time, urllib.request
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

MONTH_NUMBERS = {
    'jan':1,'january':1,'feb':2,'february':2,'mar':3,'march':3,
    'apr':4,'april':4,'may':5,'jun':6,'june':6,'jul':7,'july':7,
    'aug':8,'august':8,'sep':9,'sept':9,'september':9,
    'oct':10,'october':10,'nov':11,'november':11,'dec':12,'december':12,
}

AMT_TOL = 1.00

# CSV transaction-type rules
SKIP_PAYMENT_REFS = {'OPEN', 'OPEN REFINANCE OPEN'}
PAYOFF_OK_REFS = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}

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

# Load duplicates.json
with open(os.path.join(REPO, 'scripts', 'duplicates.json'), encoding='utf-8') as f:
    dup_data = json.load(f)

# Load deal_account_links → keyed by deal_key
print('Loading links + accounts…')
links = {l['deal_key']: l for l in sb_all('deal_account_links',
    'select=deal_key,deal_tab,deal_loc,deal_row,custaccountno,car_desc_at_link')}
accts = {a['custaccountno']: a for a in sb_all('csv_accounts',
    'select=custaccountno,location,lookupname,year,make,model')}

# Load all deals to find by surname
print('Loading deals…')
all_deals = []
for r in sb_all('deals26', 'select=car_desc,location,sort_order'):
    cd = (r.get('car_desc') or '').strip()
    if cd:
        all_deals.append({'tab':'Deals26','loc':r.get('location'),
                          'row':r.get('sort_order'),'car_desc':cd,
                          'deal_key': f'Deals26:{r.get("location")}:{r.get("sort_order")}'})
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if cd:
                    all_deals.append({'tab':tab,'loc':loc,
                                      'row':r.get('_sheetRow'),'car_desc':cd,
                                      'deal_key': f'{tab}:{loc}:{r.get("_sheetRow")}'})
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)

# Index deals by surname (last word of car_desc)
deals_by_surname = defaultdict(list)
for d in all_deals:
    toks = d['car_desc'].split()
    if not toks: continue
    surname = toks[-1].lower().rstrip('.,;:')
    if len(surname) >= 3:
        deals_by_surname[surname].append(d)

# Load CSV txns by account
print('Loading payment CSVs…')
acct_txns = defaultdict(list)
for csv_loc, folder in [('DeBary','Debary'),('DeLand','Deland')]:
    files = sorted(glob.glob(os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')))
    if not files: continue
    with open(files[-1], encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            acct = str(row.get('custaccountno','')).strip()
            if not acct: continue
            ttype = (row.get('transtype') or '').strip()
            ref = (row.get('reference') or '').strip().upper()
            try:
                amt = (float(row.get('totalamt', 0) or 0) if ttype != 'LATEFEE'
                       else float(row.get('latefee', 0) or 0))
            except ValueError: amt = 0
            if ttype == 'PAYMENT' and ref in SKIP_PAYMENT_REFS: continue
            if ttype == 'PAY OFF' and ref not in PAYOFF_OK_REFS: continue
            if ttype not in ('PAYMENT','PAYPICK','PAY OFF','LATEFEE'): continue
            if amt <= 0: continue
            try:
                dt = datetime.strptime(str(row.get('paiddate','')).split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except Exception: continue
            if not date_str.startswith('2026'): continue
            acct_txns[acct].append({
                'date': date_str, 'amount': round(amt, 2),
                'type': ttype, 'ref': row.get('reference','').strip(),
            })

# Group same-day same-acct as logical payments
def logical_payments(acct):
    by_day = defaultdict(list)
    for t in acct_txns.get(acct, []):
        by_day[t['date']].append(t)
    return [(d, round(sum(t['amount'] for t in tx), 2))
            for d, tx in by_day.items()]

# Extract amount + likely surname from a duplicate line text
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')

def parse_line_for_match(line):
    m = _AMT_RE.match(line.strip())
    if not m: return None, []
    try: amt = float(m.group(1).replace(',', ''))
    except ValueError: return None, []
    rest = m.group(2).lower()
    # Strip date tail if any
    rest = re.sub(r'\d{1,2}/\d{1,2}\s*$', '', rest).strip()
    # Take all words ≥ 3 chars as candidate surnames
    words = [w.rstrip('.,;:') for w in rest.split() if len(w.rstrip('.,;:')) >= 3]
    return round(amt, 2), words

# ── Verify each dup ─────────────────────────────────────────────────────────
print()
print('Verifying duplicates against CSV…')
results = []  # list of {kind, location, month, label, line, count, csv_count, classification, notes}

for cell in dup_data.get('profit', []):
    loc = cell.get('loc')
    month_name = (cell.get('month') or '').lower()
    month_num = MONTH_NUMBERS.get(month_name)
    label = cell.get('label')
    if not month_num: continue
    for du in cell.get('dupes', []):
        line = du['lines'][0]
        sheet_count = du['count']
        amt, words = parse_line_for_match(line)
        if amt is None:
            results.append({'kind':'profit','loc':loc,'month':month_name,
                            'label':label,'line':line,'count':sheet_count,
                            'csv_count':None,'classification':'UNVERIFIABLE',
                            'notes':'could not parse amount'})
            continue
        # Find candidate accounts: try each word as a possible surname
        cand_accts = []
        for w in words:
            for d in deals_by_surname.get(w, []):
                link = links.get(d['deal_key'])
                if link:
                    a = accts.get(link['custaccountno'])
                    if a and a.get('location') == loc:
                        cand_accts.append((d, link, a))
        # Dedup by acct
        seen = set()
        unique = []
        for d, l, a in cand_accts:
            if a['custaccountno'] not in seen:
                seen.add(a['custaccountno'])
                unique.append((d, l, a))
        # Count CSV txns matching amount in this month for ALL candidate accounts
        # (we don't know which of the multi-Soto accounts is right; sum is ok
        # since same-amount duplicates would still be flagged)
        if not unique:
            results.append({'kind':'profit','loc':loc,'month':month_name,
                            'label':label,'line':line,'count':sheet_count,
                            'csv_count':None,'classification':'UNVERIFIABLE',
                            'notes':'no surname-matching deal/account in this lot'})
            continue
        all_pmts = []
        for d, l, a in unique:
            for date_str, total in logical_payments(a['custaccountno']):
                if int(date_str[5:7]) != month_num: continue
                all_pmts.append({'date': date_str, 'amount': total,
                                 'acct': a['custaccountno'], 'name': a.get('lookupname'),
                                 'car_desc': d['car_desc']})
        # Count payments matching this amount (within $1, or 4% CC fee)
        matching = [p for p in all_pmts
                    if abs(p['amount'] - amt) <= AMT_TOL
                       or abs(p['amount'] - amt/1.04) <= AMT_TOL
                       or abs(p['amount']*1.04 - amt) <= AMT_TOL]
        csv_count = len(matching)
        if csv_count >= sheet_count:
            classification = 'LEGITIMATE'
            notes = f'{csv_count} CSV {month_name} txns of \${amt} → all {sheet_count} sheet copies are real'
        elif csv_count == 0:
            classification = 'PHANTOM'
            notes = 'CSV has zero matching txns — all sheet copies are unmatched'
        else:
            classification = 'REAL_DUPE'
            notes = f'{csv_count} CSV {month_name} txns of \${amt} but {sheet_count} sheet copies → {sheet_count-csv_count} extras'
        results.append({'kind':'profit','loc':loc,'month':month_name,
                        'label':label,'line':line,'count':sheet_count,
                        'csv_count':csv_count,'classification':classification,
                        'notes':notes,'matching':matching[:5],
                        'cand_accts':[a['custaccountno'] for d,l,a in unique]})

# Print summary
print()
print(f'{"Class":12s} {"Loc":7s} {"Month":7s} {"Sheet":>5s} {"CSV":>3s}  Line')
for r in sorted(results, key=lambda x: (x['classification'], x.get('loc',''), x.get('month',''))):
    cl = r['classification']
    sc = r['count']
    cc = r.get('csv_count')
    cc_str = str(cc) if cc is not None else '?'
    print(f'  {cl:11s} {r["loc"]:7s} {r["month"]:7s} {sc:>5d} {cc_str:>3s}  {r["line"]}')

# Summary by class
from collections import Counter
clz = Counter(r['classification'] for r in results)
print()
print('CLASSIFICATION COUNTS:')
for c, n in clz.most_common():
    print(f'  {c}: {n}')

# Save
out = os.path.join(REPO, 'scripts', 'duplicates_verified.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(results, f, indent=2, default=str)
print(f'\nSaved → {out}')
