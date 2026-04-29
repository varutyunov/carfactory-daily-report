#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
audit_april_profit.py
Bidirectional audit of April 2026 automation activity.

Two passes:
  FORWARD: every line in April Profit26 (Payments + Cash Sales notes) for
           both lots → must (a) match a CSV April transaction and (b) be on
           a deal whose F (owed) > 0 (i.e. actually in profit). Otherwise
           it's a phantom or misplaced post.

  INVERSE: every April CSV transaction (≥ 2026-04-09, recurring/payoff/late
           — not down payments) → must land in the correct place:
             • F > 0 → entry exists in same-lot Profit26 April Payments cell
             • F ≤ 0 → dated note line exists in the deal's col G

Together these catch: phantom Profit26 posts, duplicate Profit26 posts,
cross-lot routing errors, missing posts (CSV had a payment but neither
col G nor Profit26 captured it), and col G phantom note lines.

Output: scripts/april_audit_report.json + console summary.
"""

import csv, json, os, sys, re, urllib.request, urllib.parse, glob, time
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co'
SB_KEY = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs'
          'InJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYX'
          'QiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN'
          '7rJk9MCLRdkyv0INmuFwAVo')
SB_HDR = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY}

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

CUTOFF_DATE = '2026-04-09'
APRIL_PREFIX = '2026-04-'
AMOUNT_TOL = 1.00     # match-tolerance for amount
DATE_TOL_DAYS = 3     # match-tolerance for date (Profit26 may post a day or two off)

# Match transaction-type rules from reconcile_payments.py
SKIP_PAYMENT_REFS = {'OPEN', 'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF',
                     'OPEN REFINANCE OPEN', 'NETPAYOFF/WRITEOFF'}
PAYOFF_OK_REFS    = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}

# ── HTTP helpers ────────────────────────────────────────────────────────────
def gas_post(body, retries=2):
    body['secret'] = GAS_SECRET
    data = json.dumps(body).encode()
    last_err = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data,
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last_err = e
            if attempt < retries:
                time.sleep(3)
    raise last_err

def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

# ── Parsers ─────────────────────────────────────────────────────────────────
_AMOUNT_HEAD_RE = re.compile(r'^\s*([\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE   = re.compile(r'(\d{1,2})/(\d{1,2})\s*$')

def parse_profit_line(line, year=2026):
    """Parse a Profit26 note line into {amount, last_name, car_words, date, raw}.
       Format examples:
         '230 Camry malpica 4/13'  → amt=230, last=MALPICA, words=[Camry], date=2026-04-13
         '725 01 Blazer tan McGrath' → amt=725, last=MCGRATH, words=[01, Blazer, tan], date=None
         '180 — re-queued after stale-alias kelley' → amt=180, last=KELLEY, ...
       Returns None if no leading amount.
    """
    line = line.strip()
    if not line:
        return None
    m = _AMOUNT_HEAD_RE.match(line)
    if not m:
        return None
    try:
        amt = float(m.group(1).replace(',', ''))
    except ValueError:
        return None
    rest = m.group(2).strip()
    date_str = None
    dt_m = _DATE_TAIL_RE.search(rest)
    if dt_m:
        try:
            mo = int(dt_m.group(1)); dy = int(dt_m.group(2))
            if 1 <= mo <= 12 and 1 <= dy <= 31:
                date_str = f'{year:04d}-{mo:02d}-{dy:02d}'
                rest = rest[:dt_m.start()].strip()
        except ValueError:
            pass
    words = rest.split()
    last = words[-1].upper().rstrip('.,;') if words else ''
    return {'amount': round(amt, 2), 'last_name': last,
            'car_words': words[:-1], 'date': date_str, 'raw': line}

_NOTE_DATED_RE = re.compile(r'^\s*([\d,]+(?:\.\d+)?)\s+.+?\s+(\d{1,2})/(\d{1,2})\s*$')
def parse_col_g_notes(notes, year=2026):
    """Parse dated col G entries into list of {amount, date, line}."""
    if not notes:
        return []
    out = []
    for ln in str(notes).split('\n'):
        ln = ln.strip()
        if not ln:
            continue
        m = _NOTE_DATED_RE.match(ln)
        if not m:
            continue
        try:
            amt = float(m.group(1).replace(',', ''))
            mo = int(m.group(2)); dy = int(m.group(3))
            if 1 <= mo <= 12 and 1 <= dy <= 31:
                out.append({'amount': round(amt, 2),
                            'date': f'{year:04d}-{mo:02d}-{dy:02d}',
                            'line': ln})
        except ValueError:
            pass
    return out

def days_apart(a, b):
    try:
        da = datetime.strptime(a, '%Y-%m-%d')
        db = datetime.strptime(b, '%Y-%m-%d')
        return abs((da - db).days)
    except Exception:
        return 999

# ── Step 1: Load CSVs ────────────────────────────────────────────────────────
print('Loading payment + inventory CSVs…')
inv_by_last  = defaultdict(list)
for fname in ['SoldInventoryDeBary.csv', 'SoldInventoryDeLand.csv']:
    path = os.path.join(REPO, fname)
    if not os.path.exists(path):
        continue
    loc = 'DeBary' if 'DeBary' in fname else 'DeLand'
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            n = row.get('lookupname', '').strip()
            if not n:
                continue
            row['_loc'] = loc
            last = n.split(',')[0].strip().upper()
            inv_by_last[last].append(row)

# Load payment CSVs and index transactions per account.
acc_txns      = defaultdict(list)   # custaccountno → [{date,amount,type,ref}, …]
acc_to_name   = {}                  # custaccountno → lookupname.upper()
name_to_accts = defaultdict(set)    # lookupname.upper() → {custaccountno, …}
acc_to_loc    = {}                  # custaccountno → location of CSV
acc_april_txns = defaultdict(list)  # custaccountno → April-only txns

def latest_csv(folder):
    pattern = os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')
    files = sorted(glob.glob(pattern))
    return files[-1] if files else None

for loc, folder in [('DeBary', 'Debary'), ('DeLand', 'Deland')]:
    path = latest_csv(folder)
    if not path:
        continue
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            name  = row.get('lookupname', '').strip().upper()
            acct  = str(row.get('custaccountno', '')).strip()
            ttype = row.get('transtype', '').strip()
            ref   = row.get('reference', '').strip().upper()
            if ttype == 'PAYMENT':
                if ref in SKIP_PAYMENT_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAYPICK':
                if ref in SKIP_PAYMENT_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAY OFF':
                if ref not in PAYOFF_OK_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'LATEFEE':
                amt = float(row.get('latefee', 0) or 0)
            else:
                continue
            if amt <= 0:
                continue
            raw = row.get('paiddate', '')
            try:
                dt = datetime.strptime(raw.split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except Exception:
                date_str = raw[:10]
            txn = {'date': date_str, 'amount': round(amt, 2),
                   'type': ttype, 'ref': row.get('reference', '').strip(),
                   'acct': acct, 'name': name, 'loc': loc}
            if acct:
                acc_txns[acct].append(txn)
                if date_str >= CUTOFF_DATE and date_str.startswith('2026-04'):
                    acc_april_txns[acct].append(txn)
                acc_to_name[acct] = name
                acc_to_loc[acct]  = loc
            if name and acct:
                name_to_accts[name].add(acct)

print(f'  CSV: {len(acc_txns)} accounts, '
      f'{sum(len(v) for v in acc_april_txns.values())} April txns (post-{CUTOFF_DATE}), '
      f'{len(inv_by_last)} unique inventory last-names')

# ── Step 2: Load deals (deals26 from Supabase, Deals25/24 via Apps Script) ──
print('Loading deals…')
all_deals = []   # list of {tab, location, car_desc, owed (F), payments (G), payment_notes, last_name, csv_name}

try:
    rows = sb_get('deals26',
        'select=id,car_desc,cost,expenses,taxes,money,owed,payments,payment_notes,location&limit=2000')
    for r in rows:
        cd = (r.get('car_desc') or '').strip()
        if not cd: continue
        all_deals.append({
            'tab': 'Deals26', 'location': r.get('location') or 'DeBary',
            'car_desc': cd, 'owed': float(r.get('owed') or 0),
            'payments': float(r.get('payments') or 0),
            'payment_notes': r.get('payment_notes') or '',
            'last_name': cd.split()[-1].upper() if cd.split() else '',
        })
    print(f'  deals26 (Supabase): {len(rows)} rows')
except Exception as e:
    print(f'  deals26 Supabase failed: {e}')

# Deals25 and Deals24 via Apps Script
for tab in ['Deals25', 'Deals24']:
    for loc in ['DeBary', 'DeLand']:
        try:
            resp = gas_post({'action': 'read_all', 'tab': tab, 'location': loc})
            rows = resp.get('rows', []) if resp else []
            if not rows:
                print(f'  {tab} {loc}: empty/no sheet')
                continue
            for r in rows:
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                all_deals.append({
                    'tab': tab, 'location': loc,
                    'car_desc': cd, 'owed': float(r.get('owed') or 0),
                    'payments': float(r.get('payments') or 0),
                    'payment_notes': r.get('payment_notes') or '',
                    'last_name': cd.split()[-1].upper() if cd.split() else '',
                })
            print(f'  {tab} {loc}: {len(rows)} rows')
        except Exception as e:
            print(f'  WARNING: {tab} {loc} failed: {e}')

# Index deals by last_name
deals_by_last = defaultdict(list)
for d in all_deals:
    if d['last_name']:
        deals_by_last[d['last_name']].append(d)
print(f'  Total deals loaded: {len(all_deals)} ({len(deals_by_last)} unique last names)')

# ── Step 3: Load April Profit26 entries for both lots ───────────────────────
print('Loading Profit26 April for both lots…')
profit_april = []  # list of {lot, label, amount, last_name, car_words, date, raw, idx_in_cell}

for loc in ['DeBary', 'DeLand']:
    try:
        resp = gas_post({'action': 'read_profit', 'location': loc})
    except Exception as e:
        print(f'  Profit26 {loc} failed: {e}')
        continue
    months = (resp or {}).get('months', [])
    apr = next((m for m in months if m['name'] == 'April'), None)
    if not apr:
        print(f'  Profit26 {loc}: no April found')
        continue
    cell_total = {'Payments': 0, 'Cash Sales': 0, 'Extras': 0}
    for it in apr['items']:
        if it.get('label') in ('Payments', 'Cash Sales', 'Extras'):
            cell_total[it['label']] = it.get('value', 0)
            note = it.get('note', '') or ''
            for idx, ln in enumerate(note.split('\n')):
                p = parse_profit_line(ln)
                if p:
                    p['lot']   = loc
                    p['label'] = it['label']
                    p['idx_in_cell'] = idx
                    profit_april.append(p)
    print(f'  Profit26 {loc}: Payments=${cell_total["Payments"]:,.2f} '
          f'CashSales=${cell_total["Cash Sales"]:,.2f} '
          f'Extras=${cell_total["Extras"]:,.2f}')

# Filter Profit lines to April-dated or undated (undated could be April or earlier).
# We focus on April-dated lines for the audit.
profit_april_dated   = [p for p in profit_april if (p.get('date') or '').startswith('2026-04')]
profit_april_undated = [p for p in profit_april if not p.get('date')]
print(f'  Total Profit26 lines parsed: {len(profit_april)} '
      f'(April-dated={len(profit_april_dated)}, undated={len(profit_april_undated)})')

# ── Step 4: Helpers for matching ────────────────────────────────────────────
def find_deal_by_profit_line(p):
    """Given a parsed Profit26 line, return matching deal(s).

    Strategy:
      1. Search deals_by_last by last_name (also tries truncation prefix
         matches against deal car_desc last words to handle 26-char truncation).
      2. If multiple hits, narrow by car words (year prefix + model tokens).
      3. If still multiple, prefer F > 0 (active in profit) over F ≤ 0 (closed).
      4. If still multiple, prefer same-lot deals.
    """
    last = p['last_name']
    if not last:
        return []

    # Direct hit by last name
    hits = list(deals_by_last.get(last, []))

    # Truncation tolerance: also include deals whose last_name STARTS WITH
    # the profit line's last_name (e.g. p.last_name='WHITTE' should match
    # deal whose last_name is 'WHITTED'). Reverse case: profit line has full
    # 'WHITTED' but deal_last got truncated — match if profit starts with it.
    if not hits:
        for deal_last, deal_list in deals_by_last.items():
            if deal_last.startswith(last) or last.startswith(deal_last):
                hits.extend(deal_list)

    # Also try matching last as a FIRST NAME embedded in car_desc
    # (e.g. profit line 'emery' matches deal '03 Silverado tan 318k Ethan'
    # only if the deal's tab also has 'emery' somewhere). For now: skip —
    # this is handled by surname-bypass when posting, and by inv lookup
    # in deal_for_account.

    if len(hits) <= 1:
        return hits

    # Narrow by car words (year prefix + 3+ char model tokens).
    car_words_upper = [w.upper() for w in p['car_words']
                       if not w.isdigit() or len(w) > 2]
    narrowed = []
    for h in hits:
        cd_up = h['car_desc'].upper()
        match_count = sum(1 for w in car_words_upper if len(w) >= 3 and w in cd_up)
        if match_count >= 1:
            narrowed.append((match_count, h))
    if narrowed:
        narrowed.sort(key=lambda x: -x[0])
        top = narrowed[0][0]
        hits = [h for c, h in narrowed if c == top]

    if len(hits) <= 1:
        return hits

    # Prefer in-profit deals
    in_profit = [h for h in hits if (h.get('owed') or 0) > 0]
    if len(in_profit) == 1:
        return in_profit

    # Prefer same lot
    same_lot = [h for h in hits if h.get('location') == p.get('lot')]
    if len(same_lot) == 1:
        return same_lot

    return hits

def find_csv_match_for_profit(p, deal):
    """Find CSV transaction(s) matching a Profit26 line for a specific deal.

    Layered match strategies (best→worst):
      single        — one CSV txn, exact amount match
      single_4pct   — one CSV txn × 1.04 ≈ Profit amount (4% CC processing fee)
      pair          — sum of same-day same-account PAYMENT + LATEFEE
      pair_4pct     — same pair × 1.04
      threshold_overflow — entry amount = (CSV total - threshold needed to close
                          deal's pre-payment F=0). Only valid when deal F > 0
                          AND there's a corresponding col G entry that absorbed
                          the threshold portion.
    """
    last = p['last_name']
    target_amt = p['amount']
    target_date = p.get('date','')
    candidates = []

    # Find accounts whose customer name's last-name matches.
    relevant_accts = []
    for name, accts in name_to_accts.items():
        # CSV format: 'LASTNAME, FIRSTNAMES'. Last-name is part before comma.
        csv_last = name.split(',')[0].strip().upper()
        # Match if exact, or if Profit's last_name is a TRUNCATION-prefix of csv_last
        # (handles 26-char limit truncation: 'whitted' → 'whitte').
        if csv_last == last or (last and csv_last.startswith(last)):
            relevant_accts.extend((name, a) for a in accts)

    for name, acct in relevant_accts:
        # Same-account txns only — never sum across customers.
        acct_txns_all = acc_txns.get(acct, [])
        # 1. Single-txn matches (exact + 4% CC fee)
        for t in acct_txns_all:
            if not t['date'].startswith('2026-04'):
                continue
            if days_apart(t['date'], target_date) > DATE_TOL_DAYS:
                continue
            if abs(t['amount'] - target_amt) <= AMOUNT_TOL:
                candidates.append({'acct': acct, 'name': name, 'txn': t, 'kind': 'single'})
            elif abs(t['amount']*1.04 - target_amt) <= AMOUNT_TOL:
                candidates.append({'acct': acct, 'name': name, 'txn': t, 'kind': 'single_4pct'})

        # 2. Same-day same-account pair sums (PAYMENT + LATEFEE)
        same_day = defaultdict(list)
        for t in acct_txns_all:
            if t['date'].startswith('2026-04'):
                same_day[t['date']].append(t)
        for d, txns in same_day.items():
            if len(txns) < 2:
                continue
            if days_apart(d, target_date) > DATE_TOL_DAYS:
                continue
            total = round(sum(t['amount'] for t in txns), 2)
            if abs(total - target_amt) <= AMOUNT_TOL:
                candidates.append({'acct': acct, 'name': name,
                                   'txn': {'date': d, 'amount': total},
                                   'kind': 'pair', 'parts': txns})
            elif abs(total*1.04 - target_amt) <= AMOUNT_TOL:
                candidates.append({'acct': acct, 'name': name,
                                   'txn': {'date': d, 'amount': total},
                                   'kind': 'pair_4pct', 'parts': txns})

    # 3. Threshold-overflow check — only meaningful if deal F > 0 currently.
    # When a payment crosses F from negative to positive, the overflow portion
    # goes to Profit26. Profit entry amount = csv_amount - threshold_needed.
    # Threshold needed = -F_pre_payment (i.e., how much was owed at the time).
    # We don't have historical F per-payment, but we can DETECT the overflow:
    # for each CSV April txn, if (csv_amount - profit_entry_amount) is a small
    # positive number AND the deal's col G has a same-date note for ≈
    # csv_amount, treat as threshold-overflow.
    if (deal.get('owed') or 0) > 0:
        col_g_notes = parse_col_g_notes(deal.get('payment_notes',''))
        for name, acct in relevant_accts:
            for t in acc_txns.get(acct, []):
                if not t['date'].startswith('2026-04'):
                    continue
                if days_apart(t['date'], target_date) > DATE_TOL_DAYS:
                    continue
                # Threshold portion = csv_amt - target_amt (positive value)
                threshold = round(t['amount'] - target_amt, 2)
                if threshold <= 0 or threshold > t['amount']:
                    continue
                # Look for a col G note with amount ≈ csv_amount (full backup)
                # OR ≈ threshold (split). Both indicate threshold-crossing.
                for note in col_g_notes:
                    if days_apart(note['date'], t['date']) > DATE_TOL_DAYS:
                        continue
                    if abs(note['amount'] - t['amount']) <= AMOUNT_TOL or \
                       abs(note['amount'] - threshold) <= AMOUNT_TOL:
                        candidates.append({'acct': acct, 'name': name,
                                           'txn': t, 'kind': 'threshold_overflow',
                                           'threshold': threshold,
                                           'col_g_match': note})
                        break

    return candidates

# ── Step 5: FORWARD pass — audit every April Profit26 entry ─────────────────
print()
print('='*70)
print('FORWARD PASS: each April Profit26 entry → CSV match + correct deal?')
print('='*70)

forward_results = {
    'ok':                 [],   # matched CSV, deal in profit, right lot
    'threshold_overflow': [],   # matched as overflow from a threshold-crossing payment
    'cc_fee_4pct':        [],   # matched with 4% CC processing fee
    'wrong_lot':          [],   # matched but in opposite lot
    'wrong_deal':         [],   # deal F ≤ 0 (post should have gone to col G)
    'phantom':            [],   # no CSV match
    'duplicate':          [],   # same line appears twice in same cell
    'unparseable':        [],   # couldn't extract last name or amount
    'no_deal':            [],   # last_name not found in any Deals tab
    'ambiguous_deal':     [],   # multiple Deals matches we couldn't narrow
}

# Detect duplicates first
from collections import Counter
seen_keys = Counter()
for p in profit_april_dated:
    k = (p['lot'], p['label'], p['amount'], p['last_name'], p.get('date',''))
    seen_keys[k] += 1
dup_keys = {k for k, n in seen_keys.items() if n > 1}

processed = set()
for p in profit_april_dated:
    k = (p['lot'], p['label'], p['amount'], p['last_name'], p.get('date',''))
    is_dup = k in dup_keys

    if not p['last_name']:
        forward_results['unparseable'].append(p); continue

    deals_match = find_deal_by_profit_line(p)
    if not deals_match:
        forward_results['no_deal'].append(p); continue
    if len(deals_match) > 1:
        # Try to narrow further by lot
        same_lot = [d for d in deals_match if d['location'] == p['lot']]
        if len(same_lot) == 1:
            deals_match = same_lot
        else:
            forward_results['ambiguous_deal'].append({**p, 'deal_candidates':
                [{'tab': d['tab'], 'loc': d['location'], 'car_desc': d['car_desc'],
                  'F': d['owed']} for d in deals_match]})
            continue

    deal = deals_match[0]
    csv_matches = find_csv_match_for_profit(p, deal)

    # Find the best-quality match (in priority order)
    match_priority = ['single', 'pair', 'threshold_overflow', 'single_4pct', 'pair_4pct']
    best_match = None
    if csv_matches:
        for kind in match_priority:
            for m in csv_matches:
                if m['kind'] == kind:
                    best_match = m; break
            if best_match: break

    entry = {**p,
             'deal_tab': deal['tab'],
             'deal_loc': deal['location'],
             'deal_car_desc': deal['car_desc'],
             'deal_F': deal['owed'],
             'csv_matches': len(csv_matches),
             'best_match_kind': best_match['kind'] if best_match else None,
             'csv_match_sample': csv_matches[:1] if csv_matches else []}

    # Categorize — priority order matters
    if is_dup and k not in processed:
        forward_results['duplicate'].append({**entry, 'duplicate_count': seen_keys[k]})
        processed.add(k)
    elif not csv_matches:
        forward_results['phantom'].append(entry)
    elif best_match['kind'] == 'threshold_overflow':
        # Threshold-overflow is a VALID placement when deal is in profit; the
        # entry IS in the right lot's Profit26 because that's the rule.
        forward_results['threshold_overflow'].append(entry)
    elif best_match['kind'] in ('single_4pct', 'pair_4pct'):
        # CC fee version — also valid, just note it
        forward_results['cc_fee_4pct'].append(entry)
    elif deal['owed'] <= 0:
        forward_results['wrong_deal'].append(entry)
    elif deal['location'] != p['lot']:
        forward_results['wrong_lot'].append(entry)
    elif not is_dup:
        forward_results['ok'].append(entry)

# ── Step 6: INVERSE pass — every April CSV txn → must land somewhere right ──
print()
print('='*70)
print('INVERSE PASS: each April CSV transaction → posted in the right place?')
print('='*70)

# For each account with April activity, group txns by date and lookup the deal
# the user has linked it to. We approximate the "deal" by looking up
# inv_by_last for the customer's last name and picking the SoldInventory entry.
inverse_results = {
    'ok_in_profit':       [],   # F>0 deal, found in same-lot Profit26
    'ok_in_col_g':        [],   # F≤0 deal, found in col G dated notes
    'missing_from_profit': [],  # F>0 deal but not found in Profit26
    'missing_from_col_g':  [],  # F≤0 deal but not found in col G
    'wrong_lot_post':      [],  # F>0, found in opposite lot
    'no_deal':             [],  # no deal could be linked
    'ambiguous_deal':      [],  # multiple deals; can't pick
}

# Build a per-account 1:1 deal mapping. For an account: get lookupname → last
# name → SoldInventory hits; if 1 hit, we know the car/loc; find deal by car
# year+model+last name in deals_by_last.
def deal_for_account(acct):
    name = acc_to_name.get(acct, '')
    last = name.split(',')[0].strip().upper() if name else ''
    if not last:
        return None, 'no_last_name', []
    inv_hits = inv_by_last.get(last, [])
    deals_hits = deals_by_last.get(last, [])
    if not inv_hits and not deals_hits:
        return None, 'no_match', []

    # If only one inventory hit and it has a year+model that matches a deal,
    # pick that deal.
    if len(inv_hits) == 1:
        inv = inv_hits[0]
        yr  = str(inv.get('year','')).strip()
        mdl = str(inv.get('model','')).upper()
        for d in deals_hits:
            cd_up = d['car_desc'].upper()
            yr_short = yr[-2:] if yr else ''
            yr_match = (yr_short and yr_short == cd_up.strip()[:2]) or (yr and yr in cd_up)
            mdl_tokens = [t for t in mdl.split() if len(t) > 2]
            mdl_match = any(t in cd_up for t in mdl_tokens)
            if yr_match and mdl_match:
                return d, 'inv_year_model', [inv]
        if len(deals_hits) == 1:
            return deals_hits[0], 'inv_only_one_deal', [inv]
        return None, 'inv_one_but_no_deal_match', [inv]

    if len(deals_hits) == 1:
        return deals_hits[0], 'one_deal', inv_hits

    # Multiple deals → prefer the active one (F > 0). Same-name multi-car
    # case: e.g., one Emery in DeBary (F>0, active) + one in DeLand (dead).
    # The active deal is the one currently receiving payments.
    active_deals = [d for d in deals_hits if (d.get('owed') or 0) > 0]
    if len(active_deals) == 1:
        return active_deals[0], 'active_only_one_in_profit', inv_hits
    if len(active_deals) > 1:
        # Two active deals under same name — could be same customer with two
        # active cars (rare). Try to narrow with the customer's CSV first txn
        # date against the deal's saledate equivalent (year prefix in car_desc).
        # For now, return ambiguous with active candidates flagged.
        return None, f'ambiguous_multiple_active({len(active_deals)})', inv_hits

    return None, 'ambiguous', inv_hits

# Walk every April-active account
for acct, txns in acc_april_txns.items():
    if not txns:
        continue
    deal, how, inv_hits = deal_for_account(acct)
    name = acc_to_name.get(acct, '')

    if not deal:
        inverse_results['no_deal' if how != 'ambiguous' else 'ambiguous_deal'].append({
            'acct': acct, 'name': name,
            'csv_loc': acc_to_loc.get(acct, ''),
            'reason': how,
            'april_txn_count': len(txns),
            'april_total': round(sum(t['amount'] for t in txns), 2),
            'april_txns': txns,
        })
        continue

    deal_loc = deal['location']
    in_profit = (deal['owed'] or 0) > 0
    deal_april_total = round(sum(t['amount'] for t in txns), 2)

    if in_profit:
        # Each April txn (or same-day grouped pair) should appear in
        # Profit26 [deal_loc] April Payments cell.
        same_day = defaultdict(list)
        for t in txns:
            same_day[t['date']].append(t)
        all_found = True
        wrong_lot_hits = 0
        details = []
        for d, day_txns in sorted(same_day.items()):
            day_total = round(sum(t['amount'] for t in day_txns), 2)
            # Look in Profit26 entries (any lot) for matching amount/date/last
            last = name.split(',')[0].strip().upper()
            in_correct_lot = []
            in_wrong_lot   = []
            for p in profit_april:
                if p['last_name'] != last:
                    continue
                if abs(p['amount'] - day_total) > AMOUNT_TOL and \
                   not any(abs(p['amount'] - t['amount']) <= AMOUNT_TOL for t in day_txns):
                    continue
                if p.get('date') and days_apart(p['date'], d) > DATE_TOL_DAYS:
                    continue
                if p['lot'] == deal_loc:
                    in_correct_lot.append(p)
                else:
                    in_wrong_lot.append(p)
            if in_correct_lot:
                details.append({'date': d, 'total': day_total, 'found': 'correct_lot',
                                'lines': [x['raw'] for x in in_correct_lot]})
            elif in_wrong_lot:
                wrong_lot_hits += 1
                all_found = False
                details.append({'date': d, 'total': day_total, 'found': 'wrong_lot',
                                'wrong_lot': in_wrong_lot[0]['lot'],
                                'lines': [x['raw'] for x in in_wrong_lot]})
            else:
                all_found = False
                details.append({'date': d, 'total': day_total, 'found': 'missing'})

        bucket_entry = {'acct': acct, 'name': name,
                        'deal_tab': deal['tab'], 'deal_loc': deal_loc,
                        'deal_car_desc': deal['car_desc'], 'deal_F': deal['owed'],
                        'csv_loc': acc_to_loc.get(acct, ''),
                        'april_total': deal_april_total,
                        'days': details}
        # NEW: when a payment looks "missing from Profit26", also check col G
        # — backup-in-col-G is acceptable per Rule 4. If found in col G, the
        # payment isn't truly dropped, just placed conservatively.
        col_g_entries_for_inprofit = parse_col_g_notes(deal['payment_notes'])
        for det in details:
            if det.get('found') == 'missing':
                col_g_match = [c for c in col_g_entries_for_inprofit
                               if abs(c['amount'] - det['total']) <= AMOUNT_TOL
                               and days_apart(c['date'], det['date']) <= DATE_TOL_DAYS]
                if col_g_match:
                    det['found'] = 'col_g_backup'
                    det['lines'] = [c['line'] for c in col_g_match]
        # Recompute all_found after col-G fallback rescue
        all_found = all(d.get('found') != 'missing' for d in details)

        if all_found:
            # If any day was found in col_g_backup (not Profit26), bucket
            # specially so user knows it's tracked but not in canonical place.
            if any(d.get('found') == 'col_g_backup' for d in details):
                inverse_results.setdefault('ok_in_col_g_backup_only', []).append(bucket_entry)
            else:
                inverse_results['ok_in_profit'].append(bucket_entry)
        elif wrong_lot_hits > 0 and not any(x.get('found') == 'missing' for x in details):
            inverse_results['wrong_lot_post'].append(bucket_entry)
        else:
            inverse_results['missing_from_profit'].append(bucket_entry)
    else:
        # F ≤ 0 → must be in col G dated notes for THIS deal.
        col_g_entries = parse_col_g_notes(deal['payment_notes'])
        same_day = defaultdict(list)
        for t in txns:
            same_day[t['date']].append(t)
        all_found = True
        details = []
        for d, day_txns in sorted(same_day.items()):
            day_total = round(sum(t['amount'] for t in day_txns), 2)
            matches = [c for c in col_g_entries
                       if abs(c['amount'] - day_total) <= AMOUNT_TOL
                       and days_apart(c['date'], d) <= DATE_TOL_DAYS]
            singles = [c for c in col_g_entries
                       if any(abs(c['amount'] - t['amount']) <= AMOUNT_TOL for t in day_txns)
                       and days_apart(c['date'], d) <= DATE_TOL_DAYS]
            if matches or singles:
                details.append({'date': d, 'total': day_total, 'found': 'col_g',
                                'lines': [c['line'] for c in (matches or singles)]})
            else:
                all_found = False
                details.append({'date': d, 'total': day_total, 'found': 'missing'})
        # NEW: when a F≤0 deal's payment is "missing from col G", check
        # Profit26 — it might have been placed there in error (wrong_deal
        # post). If so, the payment is tracked-but-misplaced, not dropped.
        if not all_found:
            last = name.split(',')[0].strip().upper()
            for det in details:
                if det.get('found') != 'missing':
                    continue
                # Search Profit26 (any lot) for matching txn
                tracked_in_profit = []
                for p in profit_april:
                    if p['last_name'] != last:
                        continue
                    if abs(p['amount'] - det['total']) > AMOUNT_TOL:
                        # Try single-txn match in case Profit has the LATEFEE/PAYMENT split
                        if not any(abs(p['amount'] - t['amount']) <= AMOUNT_TOL for t in same_day.get(det['date'], [])):
                            continue
                    if p.get('date') and days_apart(p['date'], det['date']) > DATE_TOL_DAYS:
                        continue
                    tracked_in_profit.append(p)
                if tracked_in_profit:
                    det['found'] = 'profit_misplaced'
                    det['lines'] = [x['raw'] for x in tracked_in_profit]
                    det['profit_lot'] = tracked_in_profit[0]['lot']
            all_found = all(d.get('found') != 'missing' for d in details)

        bucket_entry = {'acct': acct, 'name': name,
                        'deal_tab': deal['tab'], 'deal_loc': deal_loc,
                        'deal_car_desc': deal['car_desc'], 'deal_F': deal['owed'],
                        'csv_loc': acc_to_loc.get(acct, ''),
                        'april_total': deal_april_total,
                        'days': details}
        if all_found:
            if any(d.get('found') == 'profit_misplaced' for d in details):
                inverse_results.setdefault('tracked_in_profit_misplaced', []).append(bucket_entry)
            else:
                inverse_results['ok_in_col_g'].append(bucket_entry)
        else:
            inverse_results['missing_from_col_g'].append(bucket_entry)

# ── Step 7: Console summary ─────────────────────────────────────────────────
print()
print('='*70)
print('SUMMARY')
print('='*70)
print()
print('FORWARD pass — every April Profit26 line:')
fr = forward_results
print(f'  ok                  : {len(fr["ok"])}  ← exact CSV + correct deal/lot')
print(f'  threshold_overflow  : {len(fr["threshold_overflow"])}  ← valid: overflow when payment crossed F=0')
print(f'  cc_fee_4pct         : {len(fr["cc_fee_4pct"])}  ← valid: amount = CSV × 1.04 (CC fee)')
print(f'  wrong_lot           : {len(fr["wrong_lot"])}  ← cross-lot routing bug')
print(f'  wrong_deal (F≤0)    : {len(fr["wrong_deal"])}  ← post made on a deal not in profit')
print(f'  phantom (no CSV)    : {len(fr["phantom"])}  ← no matching CSV transaction')
print(f'  duplicate           : {len(fr["duplicate"])}  ← same line appears multiple times')
print(f'  no_deal             : {len(fr["no_deal"])}  ← last name not in any Deals tab')
print(f'  ambiguous_deal      : {len(fr["ambiguous_deal"])}  ← multiple Deals matches')
print(f'  unparseable         : {len(fr["unparseable"])}')

print()
print('INVERSE pass — every April CSV transaction:')
ir = inverse_results
print(f'  ok_in_profit                : {len(ir["ok_in_profit"])}  ← F>0 deal, posted to correct-lot Profit')
print(f'  ok_in_col_g                 : {len(ir["ok_in_col_g"])}  ← F≤0 deal, posted to col G')
print(f'  ok_in_col_g_backup_only     : {len(ir.get("ok_in_col_g_backup_only", []))}  ← F>0, but col G has it (Rule 4 backup)')
print(f'  tracked_in_profit_misplaced : {len(ir.get("tracked_in_profit_misplaced", []))}  ← F≤0 but found in Profit26 (wrong placement)')
print(f'  wrong_lot_post              : {len(ir["wrong_lot_post"])}  ← F>0, posted to wrong lot')
print(f'  missing_from_profit         : {len(ir["missing_from_profit"])}  ← F>0 but truly nowhere')
print(f'  missing_from_col_g          : {len(ir["missing_from_col_g"])}  ← F≤0 but truly nowhere ⚠️ DROPPED PAYMENT')
print(f'  no_deal                     : {len(ir["no_deal"])}  ← couldn’t link')
print(f'  ambiguous_deal              : {len(ir["ambiguous_deal"])}')

# Top issue tables
def show_table(items, title, fields, limit=15):
    if not items: return
    print()
    print(f'-- {title} ({len(items)}) --')
    for it in items[:limit]:
        parts = []
        for f in fields:
            v = it.get(f, '')
            if isinstance(v, float):
                v = f'${v:,.2f}'
            parts.append(f'{f}={v}')
        print('  ' + ' | '.join(parts))
    if len(items) > limit:
        print(f'  … and {len(items)-limit} more')

show_table(fr['phantom'], 'FORWARD: PHANTOM (no CSV)',
           ['lot','label','amount','last_name','date','deal_car_desc','deal_F'])
show_table(fr['wrong_lot'], 'FORWARD: WRONG LOT',
           ['lot','amount','last_name','date','deal_loc','deal_car_desc'])
show_table(fr['wrong_deal'], 'FORWARD: WRONG DEAL (F ≤ 0)',
           ['lot','amount','last_name','date','deal_car_desc','deal_F'])
show_table(fr['duplicate'], 'FORWARD: DUPLICATE',
           ['lot','label','amount','last_name','date','duplicate_count'])
show_table(ir['wrong_lot_post'], 'INVERSE: WRONG-LOT POST',
           ['name','deal_loc','csv_loc','april_total'])
show_table(ir['missing_from_profit'], 'INVERSE: MISSING from Profit (F>0)',
           ['name','deal_loc','deal_car_desc','april_total'])
show_table(ir['missing_from_col_g'], 'INVERSE: MISSING from col G (F≤0)',
           ['name','deal_loc','deal_car_desc','april_total'])

# ── Step 8: Write JSON report ───────────────────────────────────────────────
report = {
    'generated_at': datetime.now().isoformat(),
    'cutoff_date': CUTOFF_DATE,
    'amount_tol': AMOUNT_TOL,
    'date_tol_days': DATE_TOL_DAYS,
    'forward': forward_results,
    'inverse': inverse_results,
}
out = os.path.join(REPO, 'scripts', 'april_audit_report.json')
with open(out, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2, default=str)
print()
print(f'Full audit report → {out}')
