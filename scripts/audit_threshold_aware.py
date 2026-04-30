#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_threshold_aware.py
Per-deal audit comparing 2026 sheet entries to 2026 CSV payments.

   sum(2026-dated col G lines) + sum(Profit26 entries) ≈ CSV 2026 paid

Why 2026-only: CSV lifetime includes pre-2026 history (some customers
paid off years ago). The current 2026 sheet only tracks 2026 activity.
Comparing lifetime CSV to current sheet generates false "missing"
findings for old paid-off accounts.

The 2026 col G entries are the dated note lines in payment_notes
(e.g. "300 11 Sonata gonzalez 4/9"). The col G CELL VALUE represents
cumulative lifetime — not useful for 2026-only audit.

Best-fit conservation: per deal, pick whichever rule produces the
smaller |delta|:
  Rule A: col_G_2026_dated alone = CSV 2026 paid
  Rule B: col_G_2026_dated + Profit26 total = CSV 2026 paid

For each linked in-profit deal:
  CSV lifetime  = sum of all PAYMENT + PAYPICK + PAY OFF + LATEFEE in CSV
                  for the linked custaccountno (down-payment OPEN excluded;
                  that's tracked in deals.money column).
  Sheet tracked = deals26.payments (col G value) + sum of Profit26 entries
                  attributable to this deal across all 2026 months.

Delta = Sheet tracked - CSV lifetime
  +X means sheet over-counts by X (inflation)
  -X means sheet under-counts by X (missing payments)
   0 means accounts are balanced

Output: scripts/threshold_audit.json + summary table sorted by abs delta.

Usage:
  python scripts/audit_threshold_aware.py
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import csv, glob, json, os, re, time, urllib.request
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa
from _csv_filter import is_real_payment, real_amount  # noqa

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

print('Loading…')
links = sb_all('deal_account_links','select=*')
accts = {a['custaccountno']: a for a in sb_all('csv_accounts','select=*')}

# All deals with payments info
all_deals = {}
for r in sb_all('deals26',
        'select=car_desc,location,sort_order,owed,payments,payment_notes,sold_inv_vin'):
    cd = (r.get('car_desc') or '').strip()
    if not cd: continue
    dk = f'Deals26:{r.get("location")}:{r.get("sort_order")}'
    all_deals[dk] = {
        'tab':'Deals26','loc':r.get('location'),
        'sheet_row':(r.get('sort_order') or 0)+1,
        'sort_order':r.get('sort_order'),
        'car_desc':cd,'owed':float(r.get('owed') or 0),
        'col_g_value':float(r.get('payments') or 0),
        'payment_notes':r.get('payment_notes') or '',
        'vin':(r.get('sold_inv_vin') or '').strip().upper(),
    }
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp=gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows',[]):
                cd=(r.get('car_desc') or '').strip()
                if not cd: continue
                dk = f'{tab}:{loc}:{r.get("_sheetRow")}'
                all_deals[dk] = {
                    'tab':tab,'loc':loc,'sheet_row':r.get('_sheetRow'),
                    'car_desc':cd,'owed':float(r.get('owed') or 0),
                    'col_g_value':float(r.get('payments') or 0),
                    'payment_notes':r.get('payment_notes') or '',
                    'vin':(r.get('sold_inv_vin') or '').strip().upper(),
                }
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)

# CSV lifetime totals per acct (non-OPEN)
acct_csv_lifetime = defaultdict(float)
acct_csv_2026 = defaultdict(float)
for csv_loc, folder in [('DeBary','Debary'),('DeLand','Deland')]:
    files = sorted(glob.glob(os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')))
    if not files: continue
    with open(files[-1], encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            acct = str(row.get('custaccountno','')).strip()
            if not acct: continue
            if not is_real_payment(row): continue
            amt = real_amount(row)
            if amt <= 0: continue
            pd = (row.get('paiddate') or '')[:10]
            acct_csv_lifetime[acct] += amt
            if '/2026' in pd:
                acct_csv_2026[acct] += amt

# Profit26 entries by lot+month
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
profit_lines = defaultdict(list)
for loc in ['DeBary','DeLand']:
    resp=gas({'action':'read_profit','location':loc})
    for m in (resp or {}).get('months',[]):
        mname = (m.get('name') or '').lower()
        for it in m.get('items',[]):
            if it.get('label') != 'Payments': continue
            for ln in (it.get('note','') or '').split('\n'):
                raw = ln.strip()
                if not raw: continue
                am = _AMT_RE.match(raw)
                if not am: continue
                try: amount = float(am.group(1).replace(',', ''))
                except ValueError: continue
                rest = am.group(2).strip()
                profit_lines[loc].append({
                    'raw':raw,'amount':round(amount,2),
                    'text_lower':rest.lower(),
                })

# Surname matchers (same as rebuild_april_profit.py)
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze'}
_WORD_RE = re.compile(r'[a-z0-9]+')
def deal_surname_tokens(car_desc, lookupname):
    out = set()
    cd_toks = (car_desc or '').split()
    if cd_toks:
        last = cd_toks[-1].lower().rstrip('.,;:')
        if len(last) >= 3: out.add(last)
    lookup = (lookupname or '').strip().upper()
    if ',' in lookup:
        pre = lookup.split(',')[0].strip()
        for tok in pre.split():
            tl = tok.lower()
            if len(tl) >= 3: out.add(tl)
    return out
def deal_model_tokens(car_desc):
    out = []
    toks = (car_desc or '').split()
    if not toks: return set()
    if re.match(r'^\d{2,4}$', toks[0]): toks = toks[1:]
    for t in toks[:-1]:
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS: continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3','cp','gt','si','rt','xl','sd','td','tdi'): continue
        if len(tl) >= 3:
            out.append(tl)
            if len(out) >= 2: break
    return set(out)
def line_matches_deal(text_lower, surname_tokens, model_tokens):
    line_words = _WORD_RE.findall(text_lower)
    surname_match = False
    for w in line_words:
        for s in surname_tokens:
            if w == s: surname_match = True; break
            if len(s) >= 6 and abs(len(s) - len(w)) <= 1 and \
               (s.startswith(w) or w.startswith(s)):
                surname_match = True; break
        if surname_match: break
    if not surname_match: return False
    if not model_tokens: return True
    line_models = set()
    for w in line_words:
        if not w.isalpha() or len(w) < 3: continue
        if w in surname_tokens: continue
        is_trunc = False
        for s in surname_tokens:
            if len(s) >= 6 and abs(len(s) - len(w)) <= 1 and \
               (s.startswith(w) or w.startswith(s)):
                is_trunc = True; break
        if is_trunc: continue
        line_models.add(w)
    if not line_models: return True
    return bool(line_models & model_tokens)

# ── Per-deal audit ──────────────────────────────────────────────────────────
print()
print('Auditing each linked in-profit deal…')
findings = []
for link in links:
    deal = all_deals.get(link['deal_key'])
    if not deal: continue
    # Audit ALL linked deals, not just in-profit ones. The conservation
    # rule (col_G + Profit26 = CSV lifetime) holds regardless of F state:
    #   F<0 deal: col_G should equal CSV (all payments go to col G)
    #   F>0 deal: col_G + Profit26 should equal CSV (split or all-Profit26)
    # Skipping F<=0 deals missed the Panayotis class of bugs (operator
    # never logged Jan/Feb/Mar payments, sheet shows fraction of CSV).
    acct = link['custaccountno']
    customer = accts.get(acct, {})
    surname_tokens = deal_surname_tokens(deal['car_desc'], customer.get('lookupname',''))
    model_tokens = deal_model_tokens(deal['car_desc'])
    if not surname_tokens: continue
    csv_lifetime = round(acct_csv_lifetime.get(acct, 0), 2)
    csv_2026 = round(acct_csv_2026.get(acct, 0), 2)
    col_g_value = round(deal['col_g_value'], 2)  # cumulative lifetime

    # Skip deals with NO 2026 activity at all (CSV or Profit26).
    # These are older paid-off deals — irrelevant for 2026 audit.
    has_2026_profit_entries = False
    profit26_test_total = 0
    for loc in ('DeBary','DeLand'):
        for ln in profit_lines.get(loc, []):
            if line_matches_deal(ln['text_lower'], surname_tokens, model_tokens):
                profit26_test_total += ln['amount']
    if csv_2026 == 0 and profit26_test_total == 0:
        continue  # nothing to audit for 2026

    # Parse col G's note lines for 2026-dated entries
    col_g_2026_dated = 0
    has_dated_entries = False
    _DATED_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+.+?\s+(\d{1,2})/(\d{1,2})\s*$')
    for ln in (deal.get('payment_notes') or '').split('\n'):
        m = _DATED_RE.match(ln.strip())
        if m:
            try: amt = float(m.group(1).replace(',', ''))
            except: continue
            col_g_2026_dated += amt
            has_dated_entries = True
    col_g_2026_dated = round(col_g_2026_dated, 2)
    # If no dated entries but cell value > 0, treat the WHOLE col_g
    # value as the 2026 contribution (assumption: Vlad entered the
    # current-year amount without dating it). Only valid when the
    # deal has 2026 CSV activity (filter above).
    col_g_2026 = col_g_2026_dated if has_dated_entries else col_g_value
    profit26_lines = []
    profit26_total = 0
    for loc in ('DeBary','DeLand'):
        for ln in profit_lines.get(loc, []):
            if line_matches_deal(ln['text_lower'], surname_tokens, model_tokens):
                profit26_lines.append({**ln, 'lot': loc})
                profit26_total += ln['amount']
    profit26_total = round(profit26_total, 2)
    # Best-fit conservation. Compare 2026 CSV to:
    #   Rule A: col_G_2026_dated alone (deal logs all to col G with dates)
    #   Rule B: col_G_2026_dated + Profit26 (split between cells)
    # Pre-2026 col G value is irrelevant for 2026 audit (those are
    # cumulative lifetime entries that may pre-date 2026).
    delta_a = round(col_g_2026 - csv_2026, 2)
    delta_b = round((col_g_2026 + profit26_total) - csv_2026, 2)
    if abs(delta_a) <= abs(delta_b):
        sheet_tracked = col_g_2026
        delta = delta_a
        rule_used = 'col_g_2026'
    else:
        sheet_tracked = round(col_g_2026 + profit26_total, 2)
        delta = delta_b
        rule_used = 'col_g_2026+profit26'
    # Keep lifetime values for context
    col_g = col_g_value
    findings.append({
        'deal_key': link['deal_key'],
        'car_desc': deal['car_desc'],
        'loc': deal['loc'],
        'sheet_row': deal['sheet_row'],
        'acct': acct,
        'csv_lifetime': csv_lifetime,
        'csv_2026': csv_2026,
        'col_g_lifetime': col_g_value,
        'col_g_2026': col_g_2026,
        'col_g': col_g_value,  # legacy field
        'profit26_total': profit26_total,
        'sheet_tracked': sheet_tracked,
        'delta': delta,
        'rule_used': rule_used,
        'profit26_lines': profit26_lines,
    })

# Sort by abs delta descending
findings.sort(key=lambda x: -abs(x['delta']))

# Save full
out_path = os.path.join(REPO, 'scripts', 'threshold_audit.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump(findings, f, indent=2, default=str)

# Summary
print()
total_over = sum(f['delta'] for f in findings if f['delta'] > 5)
total_under = sum(-f['delta'] for f in findings if f['delta'] < -5)
print(f'Customers audited: {len(findings)}')
print(f'  over (sheet > CSV)  : {sum(1 for f in findings if f["delta"] > 5)}  total ${total_over:+,.2f}')
print(f'  under (sheet < CSV) : {sum(1 for f in findings if f["delta"] < -5)}  total ${total_under:+,.2f}')
print(f'  balanced (|delta|<=5): {sum(1 for f in findings if abs(f["delta"]) <= 5)}')
print()
print(f'{"Deal":40s} {"acct":7s}  CSV-life Sheet-trk     col_G  Profit26     delta')
for f in findings[:60]:
    if abs(f['delta']) <= 5: continue
    print(f'  {f["car_desc"][:38]:38s} {f["acct"]:7s} ${f["csv_lifetime"]:>8.0f} ${f["sheet_tracked"]:>8.0f} ${f["col_g"]:>8.0f} ${f["profit26_total"]:>8.0f} ${f["delta"]:>+8.0f}')
print()
print(f'Detail JSON: {out_path}')
