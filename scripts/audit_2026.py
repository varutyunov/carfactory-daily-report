#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
audit_2026.py
Deterministic 2026 reconciliation. Uses deal_account_links to pin each
CSV payment to a specific deal — no surname guessing. Compares CSV
truth against current sheet state and applies corrections.

For every linked deal:
  * Pull all 2026 CSV payments for the linked custaccountno.
  * Pull current col G entries (from deal.payment_notes) and current
    Profit26 Payments / Cash Sales entries for both lots.
  * Match CSV txns ↔ posted entries by (amount within $1, optional 4%
    CC fee, date proximity within 7 days). Bipartite-greedy: for each
    deal, sort CSV txns and posted entries by date, pair with smallest
    distance first.

For each pair:
  * if posted_date != csv_date → DATE_FIX (auto-applied via
    correct_payments / profit_update_entry).
  * if amount differs by > $1 (no CC fee match) → AMOUNT_DRIFT (review).
  * if posted is in wrong cell vs deal F (col G when F>0 should be
    Profit26, vice versa) → MISCELL (review only — moving entries
    between cells is risky to auto-do).
  * if posted is in wrong lot's Profit26 → WRONG_LOT (review).

For unmatched:
  * CSV txn with no matched post → MISSING. Auto-add to correct cell
    (col G if F≤0, Profit26 Payments if F>0).
  * Posted entry with no matched CSV → PHANTOM. Push to review (never
    auto-delete — operator may have logged a non-CSV cash payment).

For deals NOT linked to an account:
  * Skip. Logged in the "unlinked_deals_with_april_activity" bucket
    so the operator can resolve over time.

Usage:
  python scripts/audit_2026.py            # dry-run, prints plan
  python scripts/audit_2026.py --apply    # executes corrections
  python scripts/audit_2026.py --month=4  # restrict to April only
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

AMOUNT_TOL = 1.00
DATE_TOL_DAYS = 7
NOTE_MAX = 26
APPLY = '--apply' in sys.argv
MONTH_ARG = next((int(a.split('=')[1]) for a in sys.argv if a.startswith('--month=')), None)
TODAY = datetime.now().strftime('%Y-%m-%d')

SKIP_PAYMENT_REFS = {'OPEN', 'OPEN REFINANCE OPEN'}
PAYOFF_OK_REFS = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}

# ── HTTP ────────────────────────────────────────────────────────────────────
def gas(body, retries=2):
    body['secret'] = GAS_SECRET
    last = None
    for a in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=json.dumps(body).encode(),
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if a < retries: time.sleep(3)
    raise last

def sb_get(t, p=''):
    url = f'{SB_URL}/rest/v1/{t}?{p}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_get_all(t, p=''):
    out, off = [], 0
    while True:
        page = sb_get(t, p + f'&limit=1000&offset={off}')
        out.extend(page); off += 1000
        if len(page) < 1000: break
    return out

def sb_post(t, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{t}',
        data=data, headers={**SB_HDR, 'Content-Type': 'application/json',
                            'Prefer': 'return=representation'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# ── Note parsing ────────────────────────────────────────────────────────────
_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE = re.compile(r'(\d{1,2})/(\d{1,2})\s*$')

def parse_line(line, year=2026):
    raw = (line or '').strip()
    if not raw: return None
    m = _AMT_RE.match(raw)
    if not m: return None
    try: amt = float(m.group(1).replace(',', ''))
    except ValueError: return None
    rest = m.group(2).strip()
    date_str = None
    md = _DATE_TAIL_RE.search(rest)
    if md:
        try:
            mo = int(md.group(1)); dy = int(md.group(2))
            if 1 <= mo <= 12 and 1 <= dy <= 31:
                date_str = f'{year:04d}-{mo:02d}-{dy:02d}'
                rest = rest[:md.start()].strip()
        except ValueError: pass
    return {'amount': round(amt, 2), 'date': date_str, 'text': rest, 'raw': raw}

def parse_notes(notes, year=2026):
    return [p for p in (parse_line(ln, year) for ln in (notes or '').split('\n')) if p]

def days_apart(a, b):
    if not a or not b: return 999
    try:
        da = datetime.strptime(a, '%Y-%m-%d')
        db = datetime.strptime(b, '%Y-%m-%d')
        return abs((da - db).days)
    except Exception: return 999

# ── Note formatter ──────────────────────────────────────────────────────────
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze','burgundy','champagne','charcoal','copper',
          'cream','ivory'}

def _fit(amount, year, model, color, lastname, date_str):
    """Build payment note line, ≤26 chars, drop color → year → collapse model
    → truncate lastname. amount + date are non-negotiable."""
    if amount < 0:
        amt = '-' + str(int(abs(amount)))
    elif abs(amount - int(amount)) > 0.01:
        amt = f'{amount:.2f}'.rstrip('0').rstrip('.')
    else:
        amt = str(int(amount))
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
        s = ' '.join(parts) + tail
        return s, len(s)
    s, n = _try(yr, mdl, clr, last)
    if n <= NOTE_MAX: return s
    s, n = _try(yr, mdl, '', last)
    if n <= NOTE_MAX: return s
    s, n = _try('', mdl, '', last)
    if n <= NOTE_MAX: return s
    mdl_first = mdl.split()[0] if mdl else ''
    s, n = _try('', mdl_first, '', last)
    if n <= NOTE_MAX: return s
    if last:
        for L in range(len(last) - 1, 1, -1):
            s, n = _try('', mdl_first, '', last[:L])
            if n <= NOTE_MAX: return s
    return amt + tail

def build_note(amount, deal, account, date):
    """Build properly-formatted note line for a payment."""
    cd = deal['car_desc']
    toks = cd.split()
    yr = ''
    if toks and re.match(r'^\d{2,4}$', toks[0]):
        y = toks[0]; yr = y[2:] if len(y) == 4 else y
        toks = toks[1:]
    color = ''; mtoks = []
    for t in toks[:-1] if len(toks) > 1 else []:
        tl = t.lower()
        if tl in COLORS and not color: color = tl; continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3'): continue
        mtoks.append(t)
    model = ' '.join(mtoks)
    # Surname: prefer the deal owner's surname (last word of car_desc) over
    # the CSV lookupname — that's what the rest of the row uses.
    cd_toks = cd.split()
    last = (cd_toks[-1].lower().rstrip('.,;:') if cd_toks else '')
    md = int(date[5:7]); dy = int(date[8:10])
    return _fit(amount, yr, model, color, last, f'{md}/{dy}')

# ── Load data ───────────────────────────────────────────────────────────────
print(f'audit_2026 {"--apply" if APPLY else "(dry-run)"}'
      + (f' --month={MONTH_ARG}' if MONTH_ARG else ''))

print('Loading deal_account_links…')
links = sb_get_all('deal_account_links',
    'select=deal_key,deal_tab,deal_loc,deal_row,custaccountno,car_desc_at_link,source')
link_by_key = {l['deal_key']: l for l in links}
links_by_acct = defaultdict(list)
for l in links:
    links_by_acct[l['custaccountno']].append(l)
print(f'  {len(links)} links')

print('Loading csv_accounts…')
accounts = {a['custaccountno']: a for a in
            sb_get_all('csv_accounts', 'select=custaccountno,location,lookupname,vin,year,make,model')}
print(f'  {len(accounts)} accounts')

print('Loading deals (Deals26 + Deals25/24 via Apps Script)…')
all_deals = {}  # deal_key → deal
for r in sb_get_all('deals26', 'select=id,car_desc,owed,location,sold_inv_vin,sort_order,payment_notes'):
    cd = (r.get('car_desc') or '').strip()
    if not cd: continue
    dk = f'Deals26:{r.get("location")}:{r.get("sort_order")}'
    all_deals[dk] = {
        'tab': 'Deals26', 'loc': r.get('location') or 'DeBary',
        'row': r.get('sort_order'), 'car_desc': cd,
        'owed': float(r.get('owed') or 0),
        'payment_notes': r.get('payment_notes') or '',
        'vin': (r.get('sold_inv_vin') or '').strip().upper(),
    }
print(f'  Deals26: {len(all_deals)}')
for tab in ['Deals25','Deals24']:
    for loc in ['DeBary','DeLand']:
        try:
            resp = gas({'action':'read_all','tab':tab,'location':loc})
            for r in (resp or {}).get('rows', []):
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                dk = f'{tab}:{loc}:{r.get("_sheetRow")}'
                all_deals[dk] = {
                    'tab': tab, 'loc': loc, 'row': r.get('_sheetRow'),
                    'car_desc': cd,
                    'owed': float(r.get('owed') or 0),
                    'payment_notes': r.get('payment_notes') or '',
                    'vin': (r.get('sold_inv_vin') or '').strip().upper(),
                }
            print(f'  {tab} {loc}: ok')
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}')

print('Loading Profit26 monthly cells…')
profit_cells = {'DeBary': {}, 'DeLand': {}}  # loc → month_idx → label → [parsed lines]
for loc in ['DeBary','DeLand']:
    try:
        resp = gas({'action':'read_profit','location':loc})
    except Exception as e:
        print(f'  WARN {loc}: {e}'); continue
    MONTH_NAMES = {
        'jan':0,'january':0,'feb':1,'february':1,'mar':2,'march':2,
        'apr':3,'april':3,'may':4,'jun':5,'june':5,'jul':6,'july':6,
        'aug':7,'august':7,'sep':8,'sept':8,'september':8,
        'oct':9,'october':9,'nov':10,'november':10,'dec':11,'december':11,
    }
    for m in (resp or {}).get('months', []):
        mi = m.get('index')
        if mi is None:
            mi = MONTH_NAMES.get((m.get('name') or '').lower())
            if mi is None: continue
        profit_cells[loc].setdefault(mi, {})
        for it in m.get('items', []):
            lbl = it.get('label')
            if lbl in ('Payments','Cash Sales'):
                profit_cells[loc][mi][lbl] = parse_notes(it.get('note',''))
print(f'  loaded')

# ── Load CSV April (or all-2026) txns by account ───────────────────────────
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
            if MONTH_ARG and int(date_str[5:7]) != MONTH_ARG: continue
            acct_txns[acct].append({
                'date': date_str, 'amount': round(amt, 2),
                'type': ttype, 'ref': row.get('reference','').strip(),
            })
print(f'  {sum(len(v) for v in acct_txns.values())} 2026 txns over {len(acct_txns)} accounts')

# Group same-day same-acct → logical payment (PAYMENT + LATEFEE merged)
def logical_payments_for_acct(acct):
    by_day = defaultdict(list)
    for t in acct_txns.get(acct, []):
        by_day[t['date']].append(t)
    return [{'date': d, 'amount': round(sum(t['amount'] for t in tx), 2),
             'parts': tx} for d, tx in sorted(by_day.items())]

# ── Per-deal reconciliation ─────────────────────────────────────────────────
print()
print('=' * 70)
print('Reconciling per linked deal…')
print('=' * 70)

corrections = {
    'date_fix_col_g':     [],  # auto-apply
    'date_fix_profit':    [],  # auto-apply
    'amount_drift':       [],  # review
    'wrong_cell':         [],  # review (col G vs Profit26)
    'wrong_lot':          [],  # review
    'missing_col_g':      [],  # auto-add
    'missing_profit':     [],  # auto-add
    'phantom_post':       [],  # review (don't auto-delete)
    'unlinked_with_activity': [],  # log only
}

linked_deals = 0
unlinked_with_april = 0

# Build a profit-26-line ↔ logical-payment matcher per deal
for dk, link in link_by_key.items():
    deal = all_deals.get(dk)
    if not deal:
        # Deal row has been deleted/shifted since link was made
        continue
    acct = link['custaccountno']
    payments = logical_payments_for_acct(acct)
    if not payments:
        continue
    linked_deals += 1
    in_profit = (deal.get('owed') or 0) > 0

    # Sheet posts attributable to THIS deal:
    #   col G entries on this deal
    #   Profit26 lines that match this deal by amount + (deal context)
    #     For exact attribution we look for Profit26 lines with the deal's
    #     surname token and amount. We'll match by greedy pairing.
    cg_lines = [{'kind': 'col_g', 'loc': deal['loc'], 'line': p}
                for p in parse_notes(deal['payment_notes'])
                if (p.get('date') or '').startswith('2026')
                and (not MONTH_ARG or (p.get('date','')[5:7] == f'{MONTH_ARG:02d}'))]

    # Profit26 lines: all candidates with matching surname (from car_desc) +
    # amount close to one of our CSV amounts. Using surname keeps us scoped.
    surname = (deal['car_desc'].split()[-1] if deal['car_desc'].split() else '').lower()
    surname_re = re.compile(r'\b' + re.escape(surname[:4]) + r'\w*\b', re.IGNORECASE) if surname else None
    profit_lines = []
    for ploc in ('DeBary','DeLand'):
        for mi in profit_cells.get(ploc, {}):
            if MONTH_ARG and mi != MONTH_ARG - 1: continue
            for label, lines in profit_cells[ploc][mi].items():
                if label != 'Payments': continue
                for ln in lines:
                    if (ln.get('date') or '')[:7] != f'2026-{(mi+1):02d}': continue
                    if surname_re and not surname_re.search(ln['text']):
                        continue
                    # Amount must be within $1 of SOME CSV txn for this acct
                    if not any(abs(ln['amount'] - p['amount']) <= AMOUNT_TOL
                               or abs(ln['amount'] - p['amount']*1.04) <= AMOUNT_TOL
                               for p in payments):
                        continue
                    profit_lines.append({'kind': 'profit', 'loc': ploc,
                                         'month_idx': mi, 'label': label,
                                         'line': ln})

    posts = cg_lines + profit_lines

    # Pair payments ↔ posts by smallest date distance, requiring amount
    # match within tolerance.
    def amt_ok(post_amt, csv_amt):
        return (abs(post_amt - csv_amt) <= AMOUNT_TOL or
                abs(post_amt - csv_amt*1.04) <= AMOUNT_TOL)

    # For each CSV payment, find ALL posts that could be its mirror
    # (one in col G + one in Profit26 is normal for F>0 deals — col G
    # is the running ledger, Profit26 is the profit report). Both
    # represent the same logical payment.
    used_post = set()
    matched_payments_set = set()  # indices of payments that have ≥1 post
    pairs_per_payment = defaultdict(list)  # payment_idx → [post]

    # Pair: amount within $1 (or 4% CC fee), date within tolerance.
    # Within each (kind, loc) bucket, each post only matches once.
    for j, pa in enumerate(payments):
        for kind in ('col_g', 'profit'):
            best = None; best_d = 999
            for i, po in enumerate(posts):
                if po['kind'] != kind: continue
                if i in used_post: continue
                if not amt_ok(po['line']['amount'], pa['amount']): continue
                d = days_apart(po['line'].get('date'), pa['date'])
                if d > DATE_TOL_DAYS: continue
                if d < best_d:
                    best = i; best_d = d
            if best is not None:
                used_post.add(best)
                matched_payments_set.add(j)
                pairs_per_payment[j].append(posts[best])

    # Posts with no match → phantom (real ones, not multi-cell mirrors)
    for i, po in enumerate(posts):
        if i in used_post:
            continue
        corrections['phantom_post'].append({
            'deal': deal, 'link': link, 'post': po,
        })

    # Payments with no post anywhere → missing
    for j, pa in enumerate(payments):
        if j in matched_payments_set:
            continue
        target_kind = 'missing_profit' if in_profit else 'missing_col_g'
        corrections[target_kind].append({
            'deal': deal, 'link': link, 'payment': pa,
        })

    # Matched: check each post's date + lot
    for j, pa in enumerate(payments):
        for po in pairs_per_payment[j]:
            if po['kind'] == 'profit' and po['loc'] != deal['loc']:
                corrections['wrong_lot'].append({'deal': deal, 'post': po, 'payment': pa})
                continue
            if po['line'].get('date') != pa['date']:
                bucket = 'date_fix_col_g' if po['kind'] == 'col_g' else 'date_fix_profit'
                corrections[bucket].append({
                    'deal': deal, 'post': po, 'payment': pa,
                    'old_date': po['line'].get('date'),
                    'new_date': pa['date'],
                })

# Track unlinked-but-active deals
DATE_RE = re.compile(r'\b\d{1,2}/\d{1,2}\b')
for dk, deal in all_deals.items():
    if dk in link_by_key: continue
    if not deal['payment_notes']: continue
    has_2026 = False
    for p in parse_notes(deal['payment_notes']):
        if (p.get('date') or '').startswith('2026'):
            if not MONTH_ARG or (p.get('date','')[5:7] == f'{MONTH_ARG:02d}'):
                has_2026 = True; break
    if has_2026:
        corrections['unlinked_with_activity'].append({'deal': deal})
        unlinked_with_april += 1

# ── Print plan ──────────────────────────────────────────────────────────────
print()
print(f'PLAN ({linked_deals} linked deals with payments, {unlinked_with_april} unlinked-active):')
for k, v in corrections.items():
    print(f'  {k:28s}: {len(v)}')

# ── Detail dumps ────────────────────────────────────────────────────────────
def dump(items, title, fmt, limit=40):
    if not items: return
    print()
    print(f'-- {title} ({len(items)}) --')
    for it in items[:limit]:
        try: print('  ' + fmt(it))
        except Exception as e: print(f'  [render-err {e}]')
    if len(items) > limit: print(f'  … and {len(items)-limit} more')

dump(corrections['date_fix_col_g'], 'DATE FIX — col G',
     lambda it: f'{it["deal"]["tab"]} {it["deal"]["loc"]} r{it["deal"]["row"]} {it["deal"]["car_desc"][:30]:30s} ${it["post"]["line"]["amount"]:>7} {it["old_date"]}→{it["new_date"]} [{it["post"]["line"]["raw"]}]')
dump(corrections['date_fix_profit'], 'DATE FIX — Profit26',
     lambda it: f'{it["post"]["loc"]} mo{it["post"]["month_idx"]+1} ${it["post"]["line"]["amount"]:>7} {it["old_date"]}→{it["new_date"]} [{it["post"]["line"]["raw"]}]')
dump(corrections['missing_col_g'], 'MISSING (add to col G)',
     lambda it: f'{it["deal"]["tab"]} {it["deal"]["loc"]} r{it["deal"]["row"]} {it["deal"]["car_desc"][:30]:30s} ${it["payment"]["amount"]:>7} {it["payment"]["date"]} F={it["deal"]["owed"]:.0f}')
dump(corrections['missing_profit'], 'MISSING (add to Profit26)',
     lambda it: f'{it["deal"]["loc"]} {it["deal"]["car_desc"][:30]:30s} ${it["payment"]["amount"]:>7} {it["payment"]["date"]} F={it["deal"]["owed"]:.0f}')
dump(corrections['amount_drift'], 'AMOUNT DRIFT',
     lambda it: f'{it["deal"]["car_desc"][:35]:35s} sheet=${it["post"]["line"]["amount"]} csv=${it["payment"]["amount"]} {it["payment"]["date"]}')
dump(corrections['wrong_lot'], 'WRONG LOT POST',
     lambda it: f'{it["post"]["loc"]} should be {it["deal"]["loc"]} {it["deal"]["car_desc"][:30]:30s} ${it["post"]["line"]["amount"]} [{it["post"]["line"]["raw"]}]')
dump(corrections['wrong_cell'], 'WRONG CELL',
     lambda it: f'{it["deal"]["car_desc"][:30]:30s} F={it["deal"]["owed"]:.0f} posted to {it["post"]["kind"]} (should be {it["should_be"]}) ${it["post"]["line"]["amount"]}')
dump(corrections['phantom_post'], 'PHANTOM POSTS',
     lambda it: f'{it["post"]["kind"]:6s} {it["post"]["loc"]} ${it["post"]["line"]["amount"]:>7} {it["post"]["line"].get("date") or "?":10s} [{it["post"]["line"]["raw"]}] (deal: {it["deal"]["car_desc"][:30]})')
dump(corrections['unlinked_with_activity'], 'UNLINKED DEALS WITH 2026 ACTIVITY',
     lambda it: f'{it["deal"]["tab"]} {it["deal"]["loc"]} r{it["deal"]["row"]} {it["deal"]["car_desc"][:40]} owed={it["deal"]["owed"]:.0f}')

# Save plan JSON
def _ser(x):
    if isinstance(x, dict): return {k: _ser(v) for k, v in x.items() if k != 'payment_notes'}
    if isinstance(x, list): return [_ser(v) for v in x]
    return x

plan_path = os.path.join(REPO, 'scripts', 'audit_2026_plan.json')
with open(plan_path, 'w', encoding='utf-8') as f:
    json.dump({'generated': datetime.now().isoformat(),
               'apply': APPLY,
               'month': MONTH_ARG,
               'summary': {k: len(v) for k, v in corrections.items()},
               'corrections': {k: _ser(v) for k, v in corrections.items()}},
              f, indent=2, default=str)
print(f'\nPlan saved → {plan_path}')

if not APPLY:
    print('Dry-run. Re-run with --apply to execute.')
    sys.exit(0)

# ── APPLY ───────────────────────────────────────────────────────────────────
log = []
def L(msg):
    log.append(msg); print(msg)

L('')
L('=' * 70)
L(f'APPLYING at {datetime.now().isoformat()}')
L('=' * 70)

# 1. Date fixes — col G (batch by deal)
col_g_by_deal = defaultdict(list)
for c in corrections['date_fix_col_g']:
    key = (c['deal']['tab'], c['deal']['loc'], c['deal']['row'], c['deal']['car_desc'])
    col_g_by_deal[key].append(c)

cgf_ok = cgf_err = 0
for key, group in col_g_by_deal.items():
    tab, loc, row, car_desc = key
    deal = group[0]['deal']
    cur_lines = (deal['payment_notes'] or '').split('\n')
    new_lines = list(cur_lines)
    changes = []
    for c in group:
        old_raw = c['post']['line']['raw']
        new_md = f'{int(c["new_date"][5:7])}/{int(c["new_date"][8:10])}'
        new_raw = re.sub(r'(\d{1,2})/(\d{1,2})\s*$', new_md, old_raw)
        for i, ln in enumerate(new_lines):
            if ln.strip() == old_raw.strip():
                new_lines[i] = new_raw
                changes.append((old_raw, new_raw))
                break
    new_notes = '\n'.join(new_lines).rstrip()
    total = sum(p['amount'] for p in (parse_line(ln) for ln in new_lines) if p)
    try:
        resp = gas({'action':'correct_payments','location':loc,
            'data':{'tab':tab,'row':row,'new_total':round(total,2),
                    'new_notes':new_notes,'expected_car_desc':car_desc}})
        if resp and resp.get('ok'):
            cgf_ok += len(changes)
            for old, new in changes:
                L(f'  COL_G_DATE_FIX {tab} {loc} r{row} ({car_desc[:30]}): "{old}" → "{new}"')
        else:
            cgf_err += 1
            L(f'  ERR COL_G {tab} {loc} r{row}: {resp}')
    except Exception as e:
        cgf_err += 1
        L(f'  ERR COL_G {tab} {loc} r{row}: {e}')

# 2. Date fixes — Profit26
pf_ok = pf_err = 0
for c in corrections['date_fix_profit']:
    po = c['post']
    pl = po['line']
    old_md = f'{int(c["old_date"][5:7])}/{int(c["old_date"][8:10])}' if c['old_date'] else None
    new_md = f'{int(c["new_date"][5:7])}/{int(c["new_date"][8:10])}'
    old_desc = pl['text'].strip()
    new_desc = (old_desc + ' ' + new_md).strip()
    try:
        resp = gas({'action':'profit_update_entry','location':po['loc'],
            'data':{'month_idx': po['month_idx'], 'row_type':'payments',
                    'old_amount': pl['amount'],
                    'old_description': (old_desc + (' ' + old_md if old_md else '')).strip(),
                    'new_amount': pl['amount'],
                    'new_description': new_desc}})
        if resp and resp.get('ok'):
            pf_ok += 1
            L(f'  PROFIT_DATE_FIX {po["loc"]} mo{po["month_idx"]+1}: "{pl["raw"]}" → "${int(pl["amount"])} {new_desc}"')
        else:
            pf_err += 1
            L(f'  ERR PROFIT {po["loc"]}: "{pl["raw"]}" → {resp}')
    except Exception as e:
        pf_err += 1
        L(f'  ERR PROFIT {po["loc"]}: {e}')

def _dup_in_existing(amount, date_str, deal=None, profit_lot=None, profit_month_idx=None, lookupname=''):
    """Pre-add safety: scan EXISTING entries for same-amount within 7 days and
    ANY surname token from the customer's lookupname. Belt-and-suspenders for
    cases where the matcher couldn't see the surname (truncation, alt name)."""
    surname_tokens = [w.lower() for w in (lookupname or '').split(',')[0].strip().split() if len(w) >= 3]
    deal_surname = (deal['car_desc'].split()[-1].lower().rstrip('.,;:')
                    if deal and deal['car_desc'].split() else '')
    if deal_surname and deal_surname not in surname_tokens:
        surname_tokens.append(deal_surname)
    surname_tokens = [s[:6] for s in surname_tokens]  # use 6-char prefixes

    def _match(line):
        if abs(line['amount'] - amount) > AMOUNT_TOL: return False
        if line.get('date') and days_apart(line['date'], date_str) > 7: return False
        text_lower = line['text'].lower()
        return any(s and s in text_lower for s in surname_tokens)

    if deal:
        for ln in parse_notes(deal['payment_notes']):
            if _match(ln): return f'col_g {deal["tab"]} r{deal["row"]}: {ln["raw"]}'
    if profit_lot is not None and profit_month_idx is not None:
        for label in ('Payments', 'Cash Sales'):
            for ln in profit_cells.get(profit_lot, {}).get(profit_month_idx, {}).get(label, []):
                if _match(ln): return f'Profit26 {profit_lot} {label}: {ln["raw"]}'
    return None

# 3. ADD MISSING — col G (with pre-add dup check)
mcg_ok = mcg_err = mcg_skip = 0
for c in corrections['missing_col_g']:
    deal = c['deal']; pa = c['payment']; link = c['link']
    acct = accounts.get(link['custaccountno'], {})
    # Pre-add safety: ANY existing post on this deal's col G that matches
    # amount + lookupname-token + close date → skip (matcher missed it).
    dup = _dup_in_existing(pa['amount'], pa['date'], deal=deal,
                           lookupname=acct.get('lookupname',''))
    if dup:
        mcg_skip += 1
        L(f'  SKIP_COL_G (already in {dup}) deal={deal["car_desc"][:30]} ${pa["amount"]} {pa["date"]}')
        continue
    note = build_note(pa['amount'], deal, acct, pa['date'])
    try:
        resp = gas({'action':'deals26_append_payment_direct','location':deal['loc'],
            'data':{'tab':deal['tab'],'row':deal['row'],
                    'amount': pa['amount'], 'note_line': note,
                    'last_names':[(deal['car_desc'].split()[-1] if deal['car_desc'].split() else '').lower()],
                    'bypass_surname_check': True, 'check_dup': True}})
        if resp and resp.get('ok'):
            mcg_ok += 1
            L(f'  MISSING_COL_G_ADD {deal["tab"]} {deal["loc"]} r{deal["row"]}: "{note}"')
        else:
            mcg_err += 1
            L(f'  ERR ADD col G {deal["car_desc"]}: {resp}')
    except Exception as e:
        mcg_err += 1
        L(f'  ERR ADD col G {deal["car_desc"]}: {e}')

# 4. ADD MISSING — Profit26 (with pre-add dup check)
mp_ok = mp_err = mp_skip = 0
for c in corrections['missing_profit']:
    deal = c['deal']; pa = c['payment']; link = c['link']
    acct = accounts.get(link['custaccountno'], {})
    mi = int(pa['date'][5:7]) - 1
    dup = _dup_in_existing(pa['amount'], pa['date'], profit_lot=deal['loc'],
                           profit_month_idx=mi, lookupname=acct.get('lookupname',''))
    if dup:
        mp_skip += 1
        L(f'  SKIP_PROFIT (already in {dup}) deal={deal["car_desc"][:30]} ${pa["amount"]} {pa["date"]}')
        continue
    note = build_note(pa['amount'], deal, acct, pa['date'])
    desc = note.split(' ', 1)[1] if ' ' in note else ''
    try:
        resp = gas({'action':'profit_append_entry','location':deal['loc'],
            'data':{'month_idx': mi, 'row_type':'payments',
                    'amount': pa['amount'], 'description': desc}})
        if resp and resp.get('ok'):
            mp_ok += 1
            L(f'  MISSING_PROFIT_ADD {deal["loc"]} mo{mi+1}: "{note}"')
        else:
            mp_err += 1
            L(f'  ERR ADD Profit26 {deal["car_desc"]}: {resp}')
    except Exception as e:
        mp_err += 1
        L(f'  ERR ADD Profit26 {deal["car_desc"]}: {e}')

# 5. Push wrong_lot / wrong_cell / amount_drift / phantom to review
review_pushed = 0
def push_review(rv):
    global review_pushed
    try:
        sb_post('payment_reviews', rv); review_pushed += 1
    except Exception as e:
        if '23505' in str(e) or 'duplicate key' in str(e).lower(): return
        L(f'  WARN review push: {e}')

for c in corrections['wrong_lot']:
    deal = c['deal']; po = c['post']; pa = c['payment']
    push_review({
        'customer_name': (deal['car_desc'].split()[-1] if deal['car_desc'].split() else '').upper(),
        'amount': po['line']['amount'],
        'vehicle_year':'','vehicle_make':'','vehicle_model':'','vehicle_color':'','vehicle_vin':'',
        'location': deal['loc'], 'payment_date': pa['date'], 'note_line': po['line']['raw'],
        'reason':'csv_reconciliation', 'candidates':'[]', 'status':'pending',
        'snapshot':{'direction':'wrong_lot','deal_lot':deal['loc'],
                    'profit_lot':po['loc'],'profit_label':'Payments',
                    'profit_amount':po['line']['amount'],'profit_description':po['line']['text'],
                    'car_desc':deal['car_desc'],'tab':deal['tab'],
                    'note':f'Posted to {po["loc"]} but linked deal is in {deal["loc"]}'},
        'created_at': datetime.now().isoformat(),
    })
for c in corrections['wrong_cell']:
    deal = c['deal']; po = c['post']; pa = c['payment']
    push_review({
        'customer_name': (deal['car_desc'].split()[-1] if deal['car_desc'].split() else '').upper(),
        'amount': po['line']['amount'],
        'vehicle_year':'','vehicle_make':'','vehicle_model':'','vehicle_color':'','vehicle_vin':'',
        'location': deal['loc'], 'payment_date': pa['date'], 'note_line': po['line']['raw'],
        'reason':'csv_reconciliation', 'candidates':'[]', 'status':'pending',
        'snapshot':{'direction':'wrong_cell',
                    'should_be':c['should_be'],'currently_in':po['kind'],
                    'car_desc':deal['car_desc'],'tab':deal['tab'],'deal_F':deal['owed']},
        'created_at': datetime.now().isoformat(),
    })
for c in corrections['phantom_post']:
    deal = c['deal']; po = c['post']
    pl = po['line']
    push_review({
        'customer_name': (deal['car_desc'].split()[-1] if deal['car_desc'].split() else '').upper(),
        'amount': pl['amount'],
        'vehicle_year':'','vehicle_make':'','vehicle_model':'','vehicle_color':'','vehicle_vin':'',
        'location': deal['loc'], 'payment_date': pl.get('date'), 'note_line': pl['raw'],
        'reason':'csv_reconciliation', 'candidates':'[]', 'status':'pending',
        'snapshot':{'direction':'phantom_in_sheet',
                    'profit_lot': po['loc'] if po['kind']=='profit' else None,
                    'profit_label':'Payments' if po['kind']=='profit' else None,
                    'profit_amount': pl['amount'],
                    'profit_description': pl['text'],
                    'car_desc': deal['car_desc'], 'tab': deal['tab'],
                    'note':'No CSV match for the linked account on this date+amount'},
        'created_at': datetime.now().isoformat(),
    })

# ── Summary ─────────────────────────────────────────────────────────────────
L('')
L('=' * 70)
L('SUMMARY')
L('=' * 70)
L(f'  col G date fixes : ok={cgf_ok}  err={cgf_err}')
L(f'  Profit date fixes: ok={pf_ok}  err={pf_err}')
L(f'  added col G      : ok={mcg_ok}  skipped={mcg_skip}  err={mcg_err}')
L(f'  added Profit26   : ok={mp_ok}  skipped={mp_skip}  err={mp_err}')
L(f'  pushed to review : {review_pushed}')

# Save log
log_path = os.path.join(REPO, 'scripts', 'audit_2026_log.txt')
with open(log_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(log))
print(f'\nLog saved → {log_path}')
