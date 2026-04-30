#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_per_customer.py — apply the "Rivera method" to every linked deal.

For each `deal_account_links` row:
  1. Pull all 2026 CSV transactions for the linked custaccountno.
  2. Search every Profit26 month for entries whose surname/car_desc
     matches this deal (multiple matchers: deal surname tail + every
     surname token from lookupname + car-model token).
  3. Per-month: count CSV payments vs sheet entries.
  4. Flag mismatches:
        - sheet > csv -> EXTRA (likely orphan or duplicate)
        - sheet < csv -> MISSING (payment not posted)
        - sheet == csv -> OK (count matches; amounts may still differ
          but operator-rounding is acceptable)

The point is COUNT first, then amounts. A month with 2 CSV payments
and 4 sheet entries has 2 extras regardless of amounts.

Output: scripts/per_customer_audit.json with detailed findings,
plus a summary table.
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import csv, glob, json, os, re, time, urllib.request
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

SKIP_PAYMENT_REFS = {'OPEN', 'OPEN REFINANCE OPEN'}
PAYOFF_OK_REFS = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}
MONTH_NAMES = {
    'jan':1,'january':1,'feb':2,'february':2,'mar':3,'march':3,
    'apr':4,'april':4,'may':5,'jun':6,'june':6,'jul':7,'july':7,
    'aug':8,'august':8,'sep':9,'sept':9,'september':9,
    'oct':10,'october':10,'nov':11,'november':11,'dec':12,'december':12,
}

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

# ── Load reference data ────────────────────────────────────────────────────
print('Loading links + accounts + deals + Profit26…')
links = sb_all('deal_account_links','select=*')
accts_by = {a['custaccountno']: a for a in sb_all('csv_accounts','select=*')}

# Load all deals via Apps Script (gives _sheetRow correctly for all tabs)
all_deals = {}  # deal_key -> deal info
for tab in ['Deals26','Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                # For Deals26 the link is on sort_order
                if tab == 'Deals26':
                    # Need supabase sort_order; _sheetRow is sort_order+1
                    deal_key = f'{tab}:{loc}:{r.get("_sheetRow") - 1}'
                else:
                    deal_key = f'{tab}:{loc}:{r.get("_sheetRow")}'
                all_deals[deal_key] = {
                    'tab': tab, 'loc': loc,
                    'sheet_row': r.get('_sheetRow'),
                    'car_desc': cd,
                    'owed': float(r.get('owed') or 0),
                }
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}'); time.sleep(2)

print(f'  links={len(links)}, accts={len(accts_by)}, deals={len(all_deals)}')

# Load all Profit26 entries (DeBary + DeLand, all months)
profit_lines = defaultdict(list)  # (loc, month_idx) -> list of {raw, amount, date}
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE = re.compile(r'(\d{1,2})/(\d{1,2})\s*$')
for loc in ['DeBary','DeLand']:
    resp = gas({'action':'read_profit','location':loc})
    for m in (resp or {}).get('months', []):
        mname = (m.get('name') or '').lower()
        mi = MONTH_NAMES.get(mname)
        if mi is None: continue
        for it in m.get('items', []):
            if it.get('label') != 'Payments': continue
            for ln in (it.get('note','') or '').split('\n'):
                raw = ln.strip()
                if not raw: continue
                am = _AMT_RE.match(raw)
                if not am: continue
                try: amount = float(am.group(1).replace(',', ''))
                except ValueError: continue
                rest = am.group(2).strip()
                date_str = None
                dm = _DATE_TAIL_RE.search(rest)
                if dm:
                    try:
                        mo = int(dm.group(1)); dy = int(dm.group(2))
                        if 1 <= mo <= 12 and 1 <= dy <= 31:
                            date_str = f'2026-{mo:02d}-{dy:02d}'
                    except ValueError: pass
                profit_lines[(loc, mi - 1)].append({
                    'raw': raw, 'amount': round(amount, 2),
                    'date': date_str, 'text_lower': rest.lower(),
                    'month': mi,  # 1..12
                })

# ── CSV transactions by acct ────────────────────────────────────────────────
acct_txns = defaultdict(list)
for csv_loc, folder in [('DeBary','Debary'),('DeLand','Deland')]:
    files = sorted(glob.glob(os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')))
    if not files: continue
    with open(files[-1], encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            acct = str(row.get('custaccountno','')).strip()
            if not acct: continue
            tt = (row.get('transtype') or '').strip()
            ref = (row.get('reference') or '').strip().upper()
            try:
                amt = float(row.get('totalamt',0) or 0) if tt!='LATEFEE' else float(row.get('latefee',0) or 0)
            except ValueError: amt = 0
            if tt not in ('PAYMENT','PAYPICK','PAY OFF','LATEFEE'): continue
            if tt=='PAYMENT' and ref in SKIP_PAYMENT_REFS: continue
            if tt=='PAY OFF' and ref not in PAYOFF_OK_REFS: continue
            if amt <= 0: continue
            try:
                dt = datetime.strptime(str(row.get('paiddate','')).split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except: continue
            acct_txns[acct].append({
                'date': date_str, 'amount': round(amt, 2),
                'type': tt, 'ref': ref,
            })

# Group same-day same-acct as logical payments (PAYMENT + LATEFEE merged)
def logical_2026(acct, month=None):
    """Return list of (date, amount) logical payments for this acct in 2026.
    If month given (1..12), restrict to that month."""
    by_day = defaultdict(list)
    for t in acct_txns.get(acct, []):
        if not t['date'].startswith('2026'): continue
        if month and int(t['date'][5:7]) != month: continue
        by_day[t['date']].append(t)
    return [(d, round(sum(t['amount'] for t in tx), 2))
            for d, tx in sorted(by_day.items())]

# ── Surname matchers ────────────────────────────────────────────────────────
_WORD_RE = re.compile(r'[a-z0-9]+')
def deal_surname_tokens(car_desc, lookupname):
    """Return surname tokens for matching. Just full surnames (no prefix
    truncations to avoid Whitted/Whittaker collision)."""
    out = set()
    cd_toks = (car_desc or '').split()
    if cd_toks:
        last = cd_toks[-1].lower().rstrip('.,;:')
        if len(last) >= 3:
            out.add(last)
    lookup = (lookupname or '').strip().upper()
    if ',' in lookup:
        pre = lookup.split(',')[0].strip()
        for tok in pre.split():
            tl = tok.lower()
            if len(tl) >= 3:
                out.add(tl)
    return out

def deal_model_tokens(car_desc):
    """Just the model token(s) from car_desc — used to distinguish
    same-surname customers with different cars (e.g. Smith Tahoe vs
    Smith Passat). Year is NOT distinctive enough on its own (many
    deals share '17' for example).

    Returns up to 2 model tokens (handles multi-word like 'Model S')."""
    out = []
    toks = (car_desc or '').split()
    if not toks: return set()
    # Skip year
    if re.match(r'^\d{2,4}$', toks[0]):
        toks = toks[1:]
    COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
              'gold','orange','purple','tan','brown','beige','pearl','maroon',
              'teal','navy','bronze'}
    for t in toks[:-1]:  # exclude surname (last token)
        tl = t.lower().rstrip('.,;:')
        if tl in COLORS: continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3','cp','gt','si','rt','xl','sd','td','tdi'): continue
        if len(tl) >= 3:
            out.append(tl)
            if len(out) >= 2: break
    return set(out)

def line_matches_deal(text_lower, surname_tokens, model_tokens):
    """Match a profit line to this deal:
       (a) Surname appears as a whole word (or 1-char truncation), AND
       (b) When line has any 3+ char non-surname word (i.e. is "typed"
           with a model name), at least one of those words must be in
           model_tokens. Untyped lines (just "amount surname date")
           accepted blindly."""
    line_words = _WORD_RE.findall(text_lower)
    surname_match = False
    for w in line_words:
        for s in surname_tokens:
            if w == s:
                surname_match = True; break
            # 1-char truncation only (e.g. 'whitte' for 'whitted',
            # 'garraw' for 'garraway') — surnames must be 6+ chars
            # for truncation match to apply.
            if len(s) >= 6 and abs(len(s) - len(w)) <= 1 and \
               (s.startswith(w) or w.startswith(s)):
                surname_match = True; break
        if surname_match: break
    if not surname_match: return False
    if not model_tokens:
        return True
    # Find non-surname alpha tokens in line (these would be model tokens)
    line_models = set()
    for w in line_words:
        if not w.isalpha(): continue
        if len(w) < 3: continue
        if w in surname_tokens: continue
        # Skip 1-char truncation matches with surname
        is_trunc = False
        for s in surname_tokens:
            if len(s) >= 6 and abs(len(s) - len(w)) <= 1 and \
               (s.startswith(w) or w.startswith(s)):
                is_trunc = True; break
        if is_trunc: continue
        line_models.add(w)
    if not line_models:
        # Untyped line — only surname; accept
        return True
    # Require model token overlap
    return bool(line_models & model_tokens)

# ── Build per-customer audit ────────────────────────────────────────────────
print()
print('Building per-customer audit…')
findings = []

# We focus on customers with April CSV activity (the ones that matter for
# this month's profit). Also include customers without April activity but
# with Profit26 April entries — those would be "phantom in profit"
# situations and are equally important to surface.
for link in links:
    acct = link['custaccountno']
    deal_key = link['deal_key']
    deal = all_deals.get(deal_key)
    if not deal: continue
    customer = accts_by.get(acct, {})
    # Build surname + model tokens (model used to disambiguate
    # same-surname customers)
    surname_tokens = deal_surname_tokens(deal['car_desc'], customer.get('lookupname',''))
    model_tokens = deal_model_tokens(deal['car_desc'])
    if not surname_tokens: continue

    # Per-month CSV truth (1..12)
    csv_by_month = defaultdict(list)
    for d, amt in logical_2026(acct):
        csv_by_month[int(d[5:7])].append({'date': d, 'amount': amt})

    # Per-month sheet entries (search across BOTH lots — operator may
    # have posted to wrong lot)
    sheet_by_month = defaultdict(list)
    for (loc, mi), lines in profit_lines.items():
        for ln in lines:
            if line_matches_deal(ln['text_lower'], surname_tokens, model_tokens):
                sheet_by_month[mi + 1].append({**ln, 'lot': loc})

    # Only audit in-profit deals (F>0). For F<=0 deals, CSV payments
    # correctly go to col G, not Profit26 — Profit26 having 0 entries
    # is correct, not a discrepancy.
    if (deal.get('owed') or 0) <= 0:
        continue

    # Compare per month
    discrepancies = []
    for month in range(1, 5):  # focus on Jan-April
        csv_count = len(csv_by_month.get(month, []))
        sheet_entries = sheet_by_month.get(month, [])
        sheet_count = len(sheet_entries)
        if csv_count != sheet_count:
            discrepancies.append({
                'month': month,
                'csv_count': csv_count,
                'sheet_count': sheet_count,
                'delta': sheet_count - csv_count,
                'csv': csv_by_month.get(month, []),
                'sheet': sheet_entries,
            })

    if discrepancies:
        findings.append({
            'deal_key': deal_key,
            'tab': deal['tab'], 'loc': deal['loc'], 'sheet_row': deal['sheet_row'],
            'car_desc': deal['car_desc'],
            'owed': deal['owed'],
            'acct': acct,
            'lookupname': customer.get('lookupname',''),
            'is_active': customer.get('is_active'),
            'total_2026': customer.get('total_paid_2026', 0),
            'discrepancies': discrepancies,
        })

# Summarize
print()
print(f'Customers with month-count discrepancies (Jan-April): {len(findings)}')
extras_total = sum(d['delta'] for f in findings for d in f['discrepancies'] if d['delta'] > 0)
missing_total = sum(-d['delta'] for f in findings for d in f['discrepancies'] if d['delta'] < 0)
print(f'  Sheet has {extras_total} EXTRA entries beyond CSV count')
print(f'  Sheet is MISSING {missing_total} entries that CSV has')

# Save details
out_path = os.path.join(REPO, 'scripts', 'per_customer_audit.json')
with open(out_path, 'w', encoding='utf-8') as f:
    json.dump({
        'generated': datetime.now().isoformat(),
        'findings': findings,
    }, f, indent=2, default=str)
print(f'Detail JSON: {out_path}')

# Print compact summary
print()
print('=== SUMMARY (only customers with discrepancies) ===')
print(f'{"Deal":35s} {"Acct":8s}  Jan  Feb  Mar  Apr')
print(f'{"":35s} {"":8s}  CSV/Sht  CSV/Sht  CSV/Sht  CSV/Sht')
for f in sorted(findings, key=lambda x: -sum(d['delta'] for d in x['discrepancies'] if d['delta']>0)):
    cells = []
    for month in range(1, 5):
        d = next((x for x in f['discrepancies'] if x['month']==month), None)
        if d:
            marker = '+' if d['delta'] > 0 else '-'
            cells.append(f'{d["csv_count"]}/{d["sheet_count"]}{marker}')
        else:
            cells.append('--')
    print(f'  {f["car_desc"][:33]:33s} {f["acct"]:8s}  {cells[0]:6s} {cells[1]:6s} {cells[2]:6s} {cells[3]:6s}')
