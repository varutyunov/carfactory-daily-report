#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
rebuild_april_profit.py
Rebuild April Profit26 from CSV truth.

Per Vlad's directive: "the CSV ultimately has all the correct payments."

For every linked in-profit deal (F>0):
  1. Pull the deal's April CSV logical payments (PAYMENT+LATEFEE merged
     by same-day same-acct, just like the live ledger).
  2. For each CSV payment, check current April Profit26 for a matching
     entry (amount within $2 — covers small CC fee deltas, surname
     match, any month). If found → if dated correctly leave alone;
     if dated wrong, update the date; if undated, replace with dated.
     If not found → add new dated entry to correct month's Profit26.
  3. After matching is done, remove any UNDATED entry that mentions
     this customer's surname/model (those are leftovers — every real
     CSV payment now has its own dated entry).

This brings April Profit26 to exactly match CSV truth for every
in-profit deal, while leaving F<=0 deals untouched (their payments
correctly live in col G, not Profit26).

Runs ONLY for April. Single-pass. Safe — uses pre-add dup checks
+ per-deal scope so we never touch a different customer's entries.

Usage:
  python scripts/rebuild_april_profit.py            # dry-run, plan
  python scripts/rebuild_april_profit.py --apply    # execute
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
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec'
)
GAS_SECRET = 'cf-sync-2026'
APRIL_MONTH_IDX = 3  # 0-based
NOTE_MAX = 26
AMT_TOL = 2.00  # $2 tolerance for CC fees / latefee inclusion
APPLY = '--apply' in sys.argv

# Same filter rules as audit_2026
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

# ── Load reference data ────────────────────────────────────────────────────
print('Loading…')
links = sb_all('deal_account_links','select=*')
accts = {a['custaccountno']: a for a in sb_all('csv_accounts','select=*')}
# All deals from sheet (gives correct _sheetRow for all tabs)
all_deals = {}
for tab in ['Deals26','Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                if tab == 'Deals26':
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

# CSV April logical payments by acct
acct_april = defaultdict(list)
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
            except: continue
            if dt.year != 2026 or dt.month != 4: continue
            acct_april[acct].append({
                'date': dt.strftime('%Y-%m-%d'),
                'amount': round(amt, 2),
                'type': tt, 'ref': ref,
            })

# Group same-day same-acct as logical payments
def logical_april(acct):
    by_day = defaultdict(list)
    for t in acct_april.get(acct, []):
        by_day[t['date']].append(t)
    return [(d, round(sum(t['amount'] for t in tx), 2))
            for d, tx in sorted(by_day.items())]

# Profit26 April lines per lot (parsed)
print('Loading Profit26 April…')
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE = re.compile(r'(\d{1,2})/(\d{1,2})\s*$')
profit_april = {'DeBary': [], 'DeLand': []}
for loc in ['DeBary','DeLand']:
    resp = gas({'action':'read_profit','location':loc})
    apr = next((m for m in (resp or {}).get('months', [])
                if (m.get('name') or '').lower().startswith('apr')), None)
    if not apr: continue
    for it in apr.get('items', []):
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
                        rest_no_date = rest[:dm.start()].strip()
                except ValueError: pass
            else:
                rest_no_date = rest
            profit_april[loc].append({
                'raw': raw, 'amount': round(amount, 2),
                'date': date_str, 'desc': rest, 'desc_no_date': rest_no_date,
                'text_lower': rest.lower(),
            })

# ── Note formatter (matches index.html _paymentNoteLineFit) ─────────────────
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze'}
def fit_note_line(amount, year, model, color, lastname, date_str):
    if amount < 0: amt = '-' + str(int(abs(amount)))
    elif abs(amount - int(amount)) > 0.01:
        amt = f'{amount:.2f}'.rstrip('0').rstrip('.')
    else: amt = str(int(amount))
    yr = str(year) if year else ''
    if yr and len(yr) == 4: yr = yr[2:]
    mdl = (model or '').strip()
    clr = (color or '').strip().lower()
    if clr not in COLORS: clr = ''
    last = re.sub(r'[^a-z]', '', (lastname or '').strip().lower())
    tail = f' {date_str}' if date_str else ''
    def _try(y, m, c, l):
        parts = [amt]
        if y: parts.append(y)
        if m: parts.append(m)
        if c: parts.append(c)
        if l: parts.append(l)
        return ' '.join(parts) + tail
    s = _try(yr, mdl, clr, last)
    if len(s) <= NOTE_MAX: return s
    s = _try(yr, mdl, '', last)
    if len(s) <= NOTE_MAX: return s
    s = _try('', mdl, '', last)
    if len(s) <= NOTE_MAX: return s
    mdl_first = mdl.split()[0] if mdl else ''
    s = _try('', mdl_first, '', last)
    if len(s) <= NOTE_MAX: return s
    if last:
        for L in range(len(last)-1, 1, -1):
            s = _try('', mdl_first, '', last[:L])
            if len(s) <= NOTE_MAX: return s
    return amt + tail

def build_note(amount, car_desc, date_str):
    toks = car_desc.split()
    yr = ''
    if toks and re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]; yr = y[2:] if len(y) == 4 else y
        toks = toks[1:]
    color = ''; mtoks = []
    for t in (toks[:-1] if len(toks) > 1 else []):
        tl = t.lower()
        if tl in COLORS and not color: color = tl; continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3'): continue
        mtoks.append(t)
    model = ' '.join(mtoks)
    cd_toks = car_desc.split()
    last = cd_toks[-1].lower().rstrip('.,;:') if cd_toks else ''
    md = int(date_str[5:7]); dy = int(date_str[8:10])
    return fit_note_line(amount, yr, model, color, last, f'{md}/{dy}')

# ── Surname match helpers ──────────────────────────────────────────────────
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

# ── Build plan per deal ─────────────────────────────────────────────────────
print()
print('Building plan…')
plan = {
    'add': [],          # new entries to add to Profit26
    'remove_undated': [],  # undated entries to remove
}

for link in links:
    deal = all_deals.get(link['deal_key'])
    if not deal: continue
    if (deal.get('owed') or 0) <= 0: continue  # only in-profit
    customer = accts.get(link['custaccountno'], {})
    surname_tokens = deal_surname_tokens(deal['car_desc'], customer.get('lookupname',''))
    model_tokens = deal_model_tokens(deal['car_desc'])
    if not surname_tokens: continue

    csv_pmts = logical_april(link['custaccountno'])  # [(date, amount), ...]

    # Find this deal's lines in BOTH lots' April Profit26
    matched_lines = []  # (lot, line_dict)
    for lot in ('DeBary','DeLand'):
        for ln in profit_april[lot]:
            if line_matches_deal(ln['text_lower'], surname_tokens, model_tokens):
                matched_lines.append((lot, ln))

    # Multi-phase pairing — claim exact matches FIRST for ALL CSV
    # before falling to date-update; otherwise we'd corrupt
    # already-correctly-dated entries to fill earlier missing dates.
    used_lines = set()
    csv_paired = set()
    # Phase 1: exact date+amount match (correct lot)
    for csv_idx, (csv_d, csv_a) in enumerate(csv_pmts):
        for i, (lot, ln) in enumerate(matched_lines):
            if i in used_lines: continue
            if lot != deal['loc']: continue
            if ln.get('date') != csv_d: continue
            if abs(ln['amount'] - csv_a) <= AMT_TOL:
                used_lines.add(i); csv_paired.add(csv_idx); break
    # Phase 2: dated wrong-date but amount match (correct lot)
    for csv_idx, (csv_d, csv_a) in enumerate(csv_pmts):
        if csv_idx in csv_paired: continue
        for i, (lot, ln) in enumerate(matched_lines):
            if i in used_lines: continue
            if lot != deal['loc']: continue
            if not ln.get('date'): continue
            if abs(ln['amount'] - csv_a) <= AMT_TOL:
                used_lines.add(i); csv_paired.add(csv_idx)
                plan.setdefault('update_date', []).append({
                    'lot': lot, 'old': ln,
                    'new_date': csv_d,
                    'amount': csv_a,
                    'car_desc': deal['car_desc'],
                })
                break
    # Phase 3: undated entry, correct lot, amount match — give it a date
    for csv_idx, (csv_d, csv_a) in enumerate(csv_pmts):
        if csv_idx in csv_paired: continue
        for i, (lot, ln) in enumerate(matched_lines):
            if i in used_lines: continue
            if lot != deal['loc']: continue
            if ln.get('date'): continue
            if abs(ln['amount'] - csv_a) <= AMT_TOL:
                used_lines.add(i); csv_paired.add(csv_idx)
                plan.setdefault('update_date', []).append({
                    'lot': lot, 'old': ln,
                    'new_date': csv_d,
                    'amount': csv_a,
                    'car_desc': deal['car_desc'],
                })
                break
    # Phase 4: cross-lot match (operator posted to wrong lot — flag, don't add)
    for csv_idx, (csv_d, csv_a) in enumerate(csv_pmts):
        if csv_idx in csv_paired: continue
        cross_lot = next((i for i, (lot, ln) in enumerate(matched_lines)
                          if i not in used_lines
                          and lot != deal['loc']
                          and abs(ln['amount'] - csv_a) <= AMT_TOL), None)
        if cross_lot is not None:
            used_lines.add(cross_lot); csv_paired.add(csv_idx)
            plan.setdefault('cross_lot_review', []).append({
                'csv_amount': csv_a, 'csv_date': csv_d,
                'sheet_lot': matched_lines[cross_lot][0],
                'deal_lot': deal['loc'],
                'sheet_line': matched_lines[cross_lot][1]['raw'],
                'car_desc': deal['car_desc'],
            })
    # Phase 5: still unpaired CSV — add new
    for csv_idx, (csv_d, csv_a) in enumerate(csv_pmts):
        if csv_idx in csv_paired: continue
        note = build_note(csv_a, deal['car_desc'], csv_d)
        desc = note.split(' ', 1)[1] if ' ' in note else ''
        plan['add'].append({
            'deal_key': link['deal_key'],
            'car_desc': deal['car_desc'],
            'lot': deal['loc'],
            'amount': csv_a,
            'date': csv_d,
            'note': note,
            'description': desc,
        })

    # Unpaired sheet entries are orphans/duplicates → remove
    for i, (lot, ln) in enumerate(matched_lines):
        if i in used_lines: continue
        if ln.get('date'):
            # Dated orphan — possibly a sum-dupe or wrong-customer attribution
            plan.setdefault('remove_dated_orphan', []).append({
                'deal_key': link['deal_key'],
                'car_desc': deal['car_desc'],
                'lot': lot,
                'amount': ln['amount'],
                'description': ln['desc'],
                'raw': ln['raw'],
            })
        else:
            plan['remove_undated'].append({
                'deal_key': link['deal_key'],
                'car_desc': deal['car_desc'],
                'lot': lot,
                'amount': ln['amount'],
                'description': ln['desc'],
                'raw': ln['raw'],
            })

# ── Print plan ─────────────────────────────────────────────────────────────
print()
n_add = len(plan.get('add', []))
n_rm_undated = len(plan.get('remove_undated', []))
n_rm_orphan = len(plan.get('remove_dated_orphan', []))
n_update = len(plan.get('update_date', []))
n_cross = len(plan.get('cross_lot_review', []))
print(f'Plan: ADD {n_add} | UPDATE-DATE {n_update} | RM-undated {n_rm_undated} | RM-dated-orphan {n_rm_orphan} | CROSS-LOT (review) {n_cross}')
add_total = sum(p['amount'] for p in plan.get('add', []))
remove_total = sum(p['amount'] for p in plan.get('remove_undated', [])) + sum(p['amount'] for p in plan.get('remove_dated_orphan', []))
print(f'  Adds:    +\${add_total:,.2f}')
print(f'  Removes: -\${remove_total:,.2f}')
print(f'  Net Profit26 change: \${add_total - remove_total:+,.2f}')
print()

print()
print('-- ADDS (CSV payments not yet on sheet) --')
for p in plan.get('add', [])[:40]:
    print(f'  {p["lot"]:6s} \${p["amount"]:>8.2f} {p["date"]} | "{p["note"]}" -> {p["car_desc"][:30]}')
if len(plan.get('add', [])) > 40: print(f'  … and {len(plan["add"])-40} more')

print()
print('-- UPDATE DATE (sheet has amount-match but date wrong/missing) --')
for u in plan.get('update_date', [])[:40]:
    print(f'  {u["lot"]:6s} \${u["amount"]:>8.2f} | "{u["old"]["raw"]}" -> date={u["new_date"][5:]} ({u["car_desc"][:30]})')
if len(plan.get('update_date', [])) > 40: print(f'  … and {len(plan["update_date"])-40} more')

print()
print('-- REMOVES (undated, no CSV match) --')
for r in plan.get('remove_undated', [])[:40]:
    print(f'  {r["lot"]:6s} \${r["amount"]:>8.2f} | "{r["raw"]}" <- {r["car_desc"][:30]}')
if len(plan.get('remove_undated', [])) > 40: print(f'  … and {len(plan["remove_undated"])-40} more')

print()
print('-- REMOVES (dated, no CSV match — sum-dupes / wrong-customer / orphans) --')
for r in plan.get('remove_dated_orphan', [])[:40]:
    print(f'  {r["lot"]:6s} \${r["amount"]:>8.2f} | "{r["raw"]}" <- {r["car_desc"][:30]}')
if len(plan.get('remove_dated_orphan', [])) > 40: print(f'  … and {len(plan["remove_dated_orphan"])-40} more')

print()
print('-- CROSS-LOT (operator posted to wrong lot — manual review) --')
for c in plan.get('cross_lot_review', [])[:40]:
    print(f'  CSV \${c["csv_amount"]:.2f} {c["csv_date"][5:]} | sheet on {c["sheet_lot"]} should be {c["deal_lot"]} ({c["car_desc"][:30]}): "{c["sheet_line"]}"')
if len(plan.get('cross_lot_review', [])) > 40: print(f'  … and {len(plan["cross_lot_review"])-40} more')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to execute.')
    sys.exit(0)

# ── Apply ──────────────────────────────────────────────────────────────────
print()
print('Applying…')
add_ok = add_err = rm_ok = rm_err = upd_ok = upd_err = 0

# 1. Adds (new dated entries for missing CSV payments)
for p in plan.get('add', []):
    try:
        resp = gas({'action':'profit_append_entry','location':p['lot'],
            'data':{'month_idx': APRIL_MONTH_IDX, 'row_type':'payments',
                    'amount': p['amount'], 'description': p['description']}})
        if resp and resp.get('ok'):
            add_ok += 1
            print(f'  +  {p["lot"]} {p["car_desc"][:25]}: {p["note"]}')
        else:
            add_err += 1
            print(f'  ERR ADD {p["lot"]} {p["car_desc"]}: {resp}')
    except Exception as e:
        add_err += 1
        print(f'  ERR ADD {p["lot"]} {p["car_desc"]}: {e}')

# 2. Update dates (in place via profit_update_entry)
for u in plan.get('update_date', []):
    try:
        old = u['old']
        new_md = f'{int(u["new_date"][5:7])}/{int(u["new_date"][8:10])}'
        # Build new description = old description but with date corrected
        old_desc = old['desc']
        # Strip any existing date tail
        new_desc_base = re.sub(r'\s+\d{1,2}/\d{1,2}\s*$', '', old_desc).strip()
        new_desc = (new_desc_base + ' ' + new_md).strip()
        resp = gas({'action':'profit_update_entry','location':u['lot'],
            'data':{'month_idx': APRIL_MONTH_IDX, 'row_type':'payments',
                    'old_amount': old['amount'], 'old_description': old_desc,
                    'new_amount': u['amount'], 'new_description': new_desc}})
        if resp and resp.get('ok'):
            upd_ok += 1
            print(f'  ~  {u["lot"]} {u["car_desc"][:25]}: "{old["raw"]}" -> date {new_md}')
        else:
            upd_err += 1
            print(f'  ERR UPD {u["lot"]} {u["car_desc"]}: {resp}')
    except Exception as e:
        upd_err += 1
        print(f'  ERR UPD {u["lot"]} {u["car_desc"]}: {e}')

# 3. Removes (undated + dated-orphan)
for r in (plan.get('remove_undated', []) + plan.get('remove_dated_orphan', [])):
    try:
        resp = gas({'action':'profit_remove_entry','location':r['lot'],
            'data':{'month_idx': APRIL_MONTH_IDX, 'row_type':'payments',
                    'amount': r['amount'], 'description': r['description']}})
        if resp and resp.get('ok'):
            rm_ok += 1
            print(f'  -  {r["lot"]} {r["car_desc"][:25]}: removed "{r["raw"]}"')
        else:
            rm_err += 1
            print(f'  ERR RM {r["lot"]} {r["car_desc"]}: {resp}')
    except Exception as e:
        rm_err += 1
        print(f'  ERR RM {r["lot"]} {r["car_desc"]}: {e}')

print()
print(f'SUMMARY: add=({add_ok},{add_err}) update=({upd_ok},{upd_err}) remove=({rm_ok},{rm_err})')
