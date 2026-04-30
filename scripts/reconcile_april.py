#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
reconcile_april.py
Full bidirectional reconciliation of April 2026 payments against the
Payments/*.csv source-of-truth. Designed to make decisive corrections
when confidence is high, and push only the truly-uncertain to review.

The audit script (audit_april_profit.py) only IDENTIFIES drift; this
script also FIXES it.

What gets corrected automatically (HIGH confidence):
  1. DATE_WRONG — line's amount + customer + deal context all match a
     CSV transaction, but the date on the post differs. Rewrites the
     date portion to match the CSV paiddate. This is the #1 noise
     source from past audit-driven approvals (today's date stamped
     on a 4/13 catch-up).

  2. MISSING_SOLO — a CSV April txn has no matching post anywhere AND
     there's exactly one deal with that customer's surname (or VIN
     match via SoldInventory). For F>0 deals → Profit26 Payments;
     for F≤0 deals → col G of the deal. Adds the entry with the
     correct date.

What goes to review (LOW confidence):
  - Multiple deal candidates for one CSV txn (ambiguous)
  - CSV txn for an unknown customer
  - Posted line with no CSV match (phantom — operator may have used
    a non-CSV cash payment, can't auto-delete)
  - Posted line cross-lot from its deal (operator posted to the
    wrong lot — can't auto-move without re-running surname matcher
    against the OTHER lot's deals; safer to surface)

What is NEVER auto-modified:
  - col G entries that pre-date 2026-04-09 (the CSV cutoff) — those
    represent pre-April activity outside this script's scope.
  - Profit26 Cash Sales lines — those are deal closings, not
    recurring payments; reconciler only touches Payments cells.

Usage:
  python scripts/reconcile_april.py            # dry-run, prints plan
  python scripts/reconcile_april.py --apply    # executes
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import csv, glob, json, os, re, time, urllib.request, urllib.parse
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_KEY, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

CUTOFF_DATE = '2026-04-09'
APRIL_PREFIX = '2026-04-'
AMOUNT_TOL = 1.00
DATE_TOL_DAYS = 3
NOTE_MAX = 26  # Same as _PAY_NOTE_MAX in index.html

# Reference values that aren't real recurring payments:
SKIP_PAYMENT_REFS = {'OPEN', 'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF',
                     'OPEN REFINANCE OPEN', 'NETPAYOFF/WRITEOFF'}
PAYOFF_OK_REFS    = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}

APPLY = '--apply' in sys.argv
VERBOSE = '--verbose' in sys.argv or '-v' in sys.argv

# ── HTTP ────────────────────────────────────────────────────────────────────
def gas_post(body, retries=2, timeout=90):
    body['secret'] = GAS_SECRET
    data = json.dumps(body).encode()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data,
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if attempt < retries:
                time.sleep(3)
    raise last

def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_post(table, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{table}',
        data=data, headers={**SB_HDR, 'Content-Type': 'application/json',
                            'Prefer': 'return=representation'}, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_get_paginated(table, params=''):
    out = []
    offset = 0
    while True:
        page = sb_get(table, params + f'&limit=1000&offset={offset}')
        out.extend(page)
        if len(page) < 1000:
            break
        offset += 1000
    return out

# ── Note formatting (matches index.html _paymentNoteLineFit) ────────────────
COLORS = {'white','black','silver','red','blue','gray','grey','green','yellow',
          'gold','orange','purple','tan','brown','beige','pearl','maroon',
          'teal','navy','bronze','burgundy','champagne','charcoal','copper',
          'cream','ivory'}

def _fit_note_line(amount, year, model, color, lastname, date_str):
    """Build a 26-char-or-less payment note line:
        AMOUNT [YR] [MODEL] [COLOR] LASTNAME M/D
    Drop color first, then year, then collapse model to first token,
    then truncate lastname. amount + date are non-negotiable."""
    amt = '-' + str(int(abs(amount))) if amount < 0 else str(int(amount))
    if abs(amount - int(amount)) > 0.01:
        amt = ('-' if amount < 0 else '') + f'{abs(amount):.2f}'.rstrip('0').rstrip('.')
    yr = str(year) if year else ''
    if yr and len(yr) == 4:
        yr = yr[2:]
    mdl = (model or '').strip()
    clr = (color or '').strip().lower()
    if clr not in COLORS:
        clr = ''
    last = (lastname or '').strip().lower()
    last = re.sub(r'[^a-z]', '', last)
    dt = date_str or ''
    fixed = f'{amt}'
    tail = f' {dt}'
    def _try(year_in, model_in, color_in, last_in):
        parts = [fixed]
        if year_in: parts.append(year_in)
        if model_in: parts.append(model_in)
        if color_in: parts.append(color_in)
        if last_in: parts.append(last_in)
        s = ' '.join(parts) + tail
        return s, len(s)
    # Full
    s, n = _try(yr, mdl, clr, last)
    if n <= NOTE_MAX: return s
    # Drop color
    s, n = _try(yr, mdl, '', last)
    if n <= NOTE_MAX: return s
    # Drop year
    s, n = _try('', mdl, '', last)
    if n <= NOTE_MAX: return s
    # Collapse model to first token
    mdl_first = mdl.split()[0] if mdl else ''
    s, n = _try('', mdl_first, '', last)
    if n <= NOTE_MAX: return s
    # Truncate lastname
    if last:
        for L in range(len(last) - 1, 1, -1):
            s, n = _try('', mdl_first, '', last[:L])
            if n <= NOTE_MAX: return s
    # Final fallback: just amount + date
    return fixed + tail

# ── Parsers ─────────────────────────────────────────────────────────────────
_NOTE_AMT_RE   = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE  = re.compile(r'(\d{1,2})/(\d{1,2})\s*$')
_DATE_TAIL_FULL_RE = re.compile(r'^(.*?)(\s+)(\d{1,2})/(\d{1,2})\s*$')

def parse_line(line, year=2026):
    """Parse 'AMOUNT YR MODEL last M/D' into structured form.
    Returns dict with amount, date (yyyy-mm-dd or None), text (middle),
    raw, words, last_token, year_token."""
    raw = (line or '').strip()
    if not raw:
        return None
    m = _NOTE_AMT_RE.match(raw)
    if not m:
        return None
    try:
        amt = float(m.group(1).replace(',', ''))
    except ValueError:
        return None
    rest = m.group(2).strip()
    date_str = None
    md = _DATE_TAIL_RE.search(rest)
    if md:
        try:
            mo = int(md.group(1)); dy = int(md.group(2))
            if 1 <= mo <= 12 and 1 <= dy <= 31:
                date_str = f'{year:04d}-{mo:02d}-{dy:02d}'
                rest = rest[:md.start()].strip()
        except ValueError:
            pass
    words = rest.split()
    last_tok = words[-1].lower().rstrip('.,;:') if words else ''
    yr_tok = ''
    if words and re.match(r'^\d{2}$', words[0]):
        yr_tok = words[0]
    return {
        'amount': round(amt, 2), 'date': date_str,
        'text': rest, 'raw': raw, 'words': words,
        'last_token': last_tok, 'year_token': yr_tok,
    }

def parse_notes(notes, year=2026):
    out = []
    for ln in (notes or '').split('\n'):
        p = parse_line(ln, year)
        if p:
            out.append(p)
    return out

def days_apart(a, b):
    if not a or not b: return 999
    try:
        da = datetime.strptime(a, '%Y-%m-%d')
        db = datetime.strptime(b, '%Y-%m-%d')
        return abs((da - db).days)
    except Exception:
        return 999

_WORD_RE = re.compile(r'[a-z0-9]+')
def surname_in_text(last, text):
    if not last or len(last) < 3: return False
    ll = last.lower()
    words = _WORD_RE.findall((text or '').lower())
    for w in words:
        if w == ll: return True
        if len(w) >= 4 and ll.startswith(w): return True
        if len(ll) >= 4 and w.startswith(ll) and len(w) - len(ll) <= 3: return True
    return False

# ── Loaders ─────────────────────────────────────────────────────────────────
print('Loading sold-inventory CSVs…')
inv_by_acct = {}      # custaccountno → inv row (year, make, model, vin, lotno, lookupname)
inv_by_vin  = {}      # vin upper → inv row
inv_by_last = defaultdict(list)
# Try both old and new naming conventions
inv_files = [
    ('SoldInventoryDeBary.csv', 'DeBary'),
    ('SoldInventoryDeLand.csv', 'DeLand'),
    ('Sold Inventory.csv', 'DeBary'),
    ('Sold Inventory Deland.csv', 'DeLand'),
]
seen_paths = set()
for fname, loc in inv_files:
    path = os.path.join(REPO, fname)
    if not os.path.exists(path) or path in seen_paths:
        continue
    seen_paths.add(path)
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            acct = str(row.get('custaccountno', '')).strip()
            vin = (row.get('vin') or '').strip().upper()
            n = (row.get('lookupname') or '').strip().upper()
            row['_loc'] = loc
            if acct:
                inv_by_acct[acct] = row
            if vin:
                inv_by_vin[vin] = row
            if n:
                last = n.split(',')[0].strip().upper()
                inv_by_last[last].append(row)
    print(f'  {fname} ({loc})')

# Load CSV April txns
print('Loading payment CSVs…')
def latest_csv(folder):
    pattern = os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')
    files = sorted(glob.glob(pattern))
    return files[-1] if files else None

# txns: list of {date,amount,type,ref,acct,name,csv_loc}
all_april_txns = []
for csv_loc, folder in [('DeBary', 'Debary'), ('DeLand', 'Deland')]:
    path = latest_csv(folder)
    if not path:
        print(f'  WARN: no CSV for {csv_loc}')
        continue
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            name = (row.get('lookupname') or '').strip().upper()
            acct = str(row.get('custaccountno', '')).strip()
            ttype = (row.get('transtype') or '').strip()
            ref = (row.get('reference') or '').strip().upper()
            if ttype == 'PAYMENT':
                if ref in SKIP_PAYMENT_REFS: continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAYPICK':
                if ref in SKIP_PAYMENT_REFS: continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAY OFF':
                if ref not in PAYOFF_OK_REFS: continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'LATEFEE':
                amt = float(row.get('latefee', 0) or 0)
            else:
                continue
            if amt <= 0:
                continue
            try:
                dt = datetime.strptime(str(row.get('paiddate','')).split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except Exception:
                continue
            if not date_str.startswith('2026-04') or date_str < CUTOFF_DATE:
                continue
            all_april_txns.append({
                'date': date_str, 'amount': round(amt, 2),
                'type': ttype, 'ref': row.get('reference','').strip(),
                'acct': acct, 'name': name, 'csv_loc': csv_loc,
            })

print(f'  {len(all_april_txns)} April CSV txns post-{CUTOFF_DATE}')

# Group same-day same-acct txns into "logical payments" (PAYMENT+LATEFEE)
acct_day = defaultdict(list)
for t in all_april_txns:
    acct_day[(t['acct'], t['date'])].append(t)

logical_payments = []  # one entry per (acct, date) — the sum is what posts to sheet
for (acct, date), txns in acct_day.items():
    name = txns[0]['name']
    csv_loc = txns[0]['csv_loc']
    total = round(sum(t['amount'] for t in txns), 2)
    logical_payments.append({
        'acct': acct, 'date': date, 'name': name, 'csv_loc': csv_loc,
        'amount': total, 'parts': txns,
        'has_payment': any(t['type'] in ('PAYMENT','PAYPICK','PAY OFF') for t in txns),
        'has_latefee': any(t['type'] == 'LATEFEE' for t in txns),
    })
print(f'  → {len(logical_payments)} logical (acct,date) payments after grouping')

# Load deals
print('Loading deals…')
all_deals = []
rows = sb_get_paginated('deals26',
    'select=id,car_desc,owed,payments,payment_notes,location,sold_inv_vin,sort_order')
for r in rows:
    cd = (r.get('car_desc') or '').strip()
    if not cd: continue
    all_deals.append({
        'tab': 'Deals26', 'location': r.get('location') or 'DeBary',
        'car_desc': cd, 'owed': float(r.get('owed') or 0),
        'payments': float(r.get('payments') or 0),
        'payment_notes': r.get('payment_notes') or '',
        'vin': (r.get('sold_inv_vin') or '').strip().upper(),
        'sheet_row': r.get('sort_order'),
    })
print(f'  Deals26: {len(rows)}')
for tab in ['Deals25', 'Deals24']:
    for loc in ['DeBary', 'DeLand']:
        try:
            resp = gas_post({'action': 'read_all', 'tab': tab, 'location': loc})
            rows = (resp or {}).get('rows', [])
            for r in rows:
                cd = (r.get('car_desc') or '').strip()
                if not cd: continue
                all_deals.append({
                    'tab': tab, 'location': loc,
                    'car_desc': cd, 'owed': float(r.get('owed') or 0),
                    'payments': float(r.get('payments') or 0),
                    'payment_notes': r.get('payment_notes') or '',
                    'vin': (r.get('sold_inv_vin') or '').strip().upper(),
                    'sheet_row': r.get('_sheetRow'),
                })
            print(f'  {tab} {loc}: {len(rows)}')
        except Exception as e:
            print(f'  WARN {tab} {loc}: {e}')
            time.sleep(2)

deals_by_last = defaultdict(list)
deals_by_vin = {}
for d in all_deals:
    cd = d['car_desc']
    last = (cd.split()[-1] if cd.split() else '').upper().rstrip('.,;:')
    if last:
        deals_by_last[last].append(d)
    if d['vin']:
        deals_by_vin[d['vin']] = d

# Load Profit26 April Payments (parsed)
print('Loading Profit26…')
profit26 = {'DeBary': {'Payments': [], 'Cash Sales': []}, 'DeLand': {'Payments': [], 'Cash Sales': []}}
for loc in ['DeBary', 'DeLand']:
    try:
        resp = gas_post({'action': 'read_profit', 'location': loc})
    except Exception as e:
        print(f'  WARN profit {loc}: {e}')
        continue
    apr = next((m for m in (resp or {}).get('months', []) if m.get('name') == 'April'), None)
    if not apr: continue
    for it in apr.get('items', []):
        lbl = it.get('label')
        if lbl in ('Payments', 'Cash Sales'):
            for ln in (it.get('note', '') or '').split('\n'):
                p = parse_line(ln)
                if p:
                    p['lot'] = loc
                    p['label'] = lbl
                    profit26[loc][lbl].append(p)
print(f'  Profit26: DeBary Payments={len(profit26["DeBary"]["Payments"])} '
      f'DeLand Payments={len(profit26["DeLand"]["Payments"])}')

# ── Match logical payments → deals ──────────────────────────────────────────
print()
print('Matching logical payments to deals…')

def csv_last(name):
    """Single primary surname token — LAST word of the pre-comma portion.
    Cuban-naming convention: 'DIAZ ORALES, CARLOS' → 'ORALES' (mom's
    surname comes second in DMS, but Vlad's deals_by_last is keyed on the
    last word of car_desc). Returns last word — primary deal-lookup key."""
    pre = (name or '').split(',')[0].strip().upper()
    parts = pre.split()
    return parts[-1] if parts else ''

def csv_last_alts(name):
    """All surname-word alternates from the pre-comma portion. Yields
    last-first ('ORALES','DIAZ' for 'DIAZ ORALES'). Used to find the
    deal even if Vlad filed it under either word."""
    pre = (name or '').split(',')[0].strip().upper()
    parts = pre.split()
    seen = []
    for p in reversed(parts):
        if p and p not in seen:
            seen.append(p)
    return seen

def find_deal_for_payment(p):
    """Find the deal a logical payment belongs to. Returns (deal, confidence).
    Confidence: 'vin' > 'inv_year_model' > 'one_deal' > 'single_active' > None.
    Strategy:
      1. acct → inv → vin → deal (strongest).
      2. Try EACH surname alternate (last-first for Cuban compound names).
      3. multiple deals: try year+model from inv to narrow.
      4. multiple still: prefer deals with recent (April) col G activity.
      5. multiple still: None (ambiguous)."""
    acct = p['acct']
    inv = inv_by_acct.get(acct)
    if inv:
        vin = (inv.get('vin') or '').strip().upper()
        if vin and vin in deals_by_vin:
            return deals_by_vin[vin], 'vin'
    # Collect candidates from ALL surname alternates
    seen_ids = set()
    deals = []
    for last in csv_last_alts(p['name']):
        for d in deals_by_last.get(last, []):
            did = id(d)
            if did not in seen_ids:
                seen_ids.add(did)
                deals.append(d)
    if not deals:
        return None, 'no_surname_deal'
    if len(deals) == 1:
        return deals[0], 'one_deal'
    # Narrow by inv year+model if available
    if inv:
        yr = str(inv.get('year','')).strip()[-2:]
        mdl = (inv.get('model') or '').upper()
        narrowed = []
        for d in deals:
            cd_up = d['car_desc'].upper()
            cd_toks = cd_up.split()
            yr_match = bool(yr) and bool(cd_toks) and yr in cd_toks[0]
            mdl_match = bool(mdl) and any(t in cd_up for t in mdl.split() if len(t) >= 3)
            if yr_match and mdl_match:
                narrowed.append(d)
        if len(narrowed) == 1:
            return narrowed[0], 'inv_year_model'
    # Prefer deals with April col G activity
    def _has_april(d):
        cg = parse_notes(d['payment_notes'])
        return any((c.get('date') or '').startswith('2026-04') for c in cg)
    recent = [d for d in deals if _has_april(d)]
    if len(recent) == 1:
        return recent[0], 'single_active'
    return None, f'ambiguous({len(deals)})'

# Index logical payments by (deal_id, target_amount, target_date) for matching
matched_payments = []  # list of {payment, deal, confidence}
unmatched_payments = []
for p in logical_payments:
    d, conf = find_deal_for_payment(p)
    if d:
        matched_payments.append({'p': p, 'd': d, 'conf': conf})
    else:
        unmatched_payments.append({'p': p, 'reason': conf})

print(f'  matched: {len(matched_payments)} | unmatched: {len(unmatched_payments)}')

# ── Identify all current sheet posts in April ───────────────────────────────
# Each post has: source_kind ('col_g' or 'profit'), location, deal (or None),
# parsed line, raw, label
sheet_posts = []  # list of {kind, loc, deal, line}
for d in all_deals:
    for ln in parse_notes(d['payment_notes']):
        if (ln.get('date') or '').startswith('2026-04'):
            sheet_posts.append({'kind': 'col_g', 'loc': d['location'], 'deal': d, 'line': ln, 'label': None})
for loc in ('DeBary', 'DeLand'):
    for label in ('Payments', 'Cash Sales'):
        for ln in profit26[loc][label]:
            if (ln.get('date') or '').startswith('2026-04'):
                sheet_posts.append({'kind': 'profit', 'loc': loc, 'deal': None, 'line': ln, 'label': label})

print(f'  sheet posts (April-dated): {len(sheet_posts)}')

# Match each sheet post to a logical payment
# Strategy: amount match within $1 (or *1.04 for CC fee) + surname match
# + (if both have deal context) deal must agree.
def post_matches_payment(post, payment):
    pl = post['line']
    # Tight amount: $1 tolerance, plus optional 4% CC fee.
    if abs(pl['amount'] - payment['amount']) > AMOUNT_TOL:
        if abs(pl['amount'] - payment['amount'] * 1.04) > AMOUNT_TOL and \
           abs(pl['amount'] / 1.04 - payment['amount']) > AMOUNT_TOL:
            return False
    # Surname alternates (multi-word Cuban names): match against any.
    for last in csv_last_alts(payment['name']):
        if surname_in_text(last, pl['text']):
            return True
    return False

# Greedy pair-up by (deal/lot, amount): per group, sort posts and CSV
# txns by date, pair them in order. Any extras → unmatched. This avoids
# the "two same-amount payments paired with the wrong CSV txn" bug.
def _build_pairings():
    """Returns post_to_payment map and unmatched_payments_per_deal map.
    Pairing key: (deal-id-or-lot, amount-bucket, surname-key).
    """
    # Group posts and payments by (deal-or-lot, rounded_amount, surname)
    bucket_posts = defaultdict(list)
    bucket_payments = defaultdict(list)

    for sp in sheet_posts:
        if sp['label'] == 'Cash Sales':
            continue
        if not (sp['line'].get('date') or '').startswith('2026-04'):
            continue
        pl = sp['line']
        # Find what payment(s) could match this post
        cand_payments = [mp for mp in matched_payments if post_matches_payment(sp, mp['p'])]
        if not cand_payments:
            sp['_match'] = None; sp['_status'] = 'no_csv_match'
            continue
        # Bucket key: deal (when col_g and deal known) else (lot, amount, surname)
        if sp['kind'] == 'col_g' and sp['deal']:
            key = ('deal', id(sp['deal']), round(pl['amount']))
        else:
            # Use surname from line + lot
            last = pl.get('last_token','').upper()
            key = ('lot', sp['loc'], round(pl['amount']), last[:6])
        bucket_posts[key].append(sp)
        # Add candidate payments under same key (allowing different but compatible)
        for mp in cand_payments:
            ckey_options = [('deal', id(mp['d']), round(mp['p']['amount']))]
            for last in csv_last_alts(mp['p']['name']):
                ckey_options.append(('lot', mp['d']['location'], round(mp['p']['amount']), last[:6]))
            for ckey in ckey_options:
                if ckey == key:
                    if mp not in bucket_payments[key]:
                        bucket_payments[key].append(mp)
                    break

    # Within each bucket, pair posts and payments by date order
    for key in list(bucket_posts.keys()):
        posts = sorted(bucket_posts[key], key=lambda s: s['line'].get('date') or '')
        pmts  = sorted(bucket_payments.get(key, []), key=lambda m: m['p']['date'])
        # Greedy pair: smallest date-distance first
        used_post = set(); used_pmt = set()
        # Compute all pair distances
        pairs = []
        for i, sp in enumerate(posts):
            for j, mp in enumerate(pmts):
                d_post = sp['line'].get('date') or ''
                d_pmt = mp['p']['date']
                pairs.append((days_apart(d_post, d_pmt), i, j, sp, mp))
        pairs.sort()
        for dist, i, j, sp, mp in pairs:
            if i in used_post or j in used_pmt:
                continue
            used_post.add(i); used_pmt.add(j)
            sp['_match'] = mp
            sp['_status'] = 'matched'
        for i, sp in enumerate(posts):
            if i not in used_post:
                sp['_match'] = None
                sp['_status'] = 'no_csv_match'

_build_pairings()

# ── Build correction plan ───────────────────────────────────────────────────
print()
print('=' * 70)
print('Building correction plan…')
print('=' * 70)

corrections = {
    'date_fix_col_g':       [],  # col G line: amt+last+deal correct, date wrong
    'date_fix_profit':      [],  # profit line: amt+last+lot correct, date wrong
    'add_missing_col_g':    [],  # CSV txn → no post → add to col G (F≤0)
    'add_missing_profit':   [],  # CSV txn → no post → add to Profit26 (F>0)
    'ambiguous_csv':        [],  # multiple deals match the surname; review
    'phantom_post':         [],  # post → no CSV match (review)
    'wrong_lot_post':       [],  # post in wrong lot's profit (review)
    'unknown_customer':     [],  # CSV txn with no matching deal (review)
}

matched_payment_keys = set()
for sp in sheet_posts:
    mp = sp.get('_match')
    if mp:
        matched_payment_keys.add((mp['p']['acct'], mp['p']['date']))

TODAY_MD = datetime.now().strftime('%Y-%m-%d')

# 1. Posts WITH a match — check date & lot for corrections
for sp in sheet_posts:
    mp = sp.get('_match')
    if not mp:
        continue
    p = mp['p']
    d = mp['d']
    pl = sp['line']
    desired_date = p['date']
    posted_date = pl.get('date')
    desired_lot = d['location']

    if sp['label'] == 'Cash Sales':
        continue

    if sp['kind'] == 'profit' and sp['loc'] != desired_lot:
        corrections['wrong_lot_post'].append({
            'sp': sp, 'p': p, 'd': d,
            'note': f'posted to {sp["loc"]} but deal is in {desired_lot}',
        })
        continue

    # Date mismatch. SAFE-FIX rule: only when posted_date == TODAY (the
    # operator just-stamped today's date on a CSV catch-up payment that
    # actually occurred earlier). Other date mismatches go to review —
    # they could be legitimate split-day payments the matcher mis-paired.
    if posted_date and posted_date != desired_date:
        is_safe = posted_date == TODAY_MD
        bucket = 'date_fix_col_g' if sp['kind'] == 'col_g' else 'date_fix_profit'
        item = {'sp': sp, 'p': p, 'd': d,
                'old_date': posted_date, 'new_date': desired_date,
                'safe': is_safe}
        corrections[bucket].append(item)

# 2. Posts WITHOUT a match → phantom (push to review, don't auto-delete)
for sp in sheet_posts:
    if sp['_match']:
        continue
    if sp['label'] == 'Cash Sales':
        continue
    # Skip dates outside April or pre-cutoff
    if not (sp['line'].get('date') or '').startswith('2026-04'):
        continue
    if (sp['line'].get('date') or '') < CUTOFF_DATE:
        continue
    corrections['phantom_post'].append({'sp': sp})

# 3. Logical payments with NO matching post → add or review
HIGH_CONF = {'vin', 'inv_year_model', 'one_deal', 'single_active'}
for mp in matched_payments:
    p = mp['p']
    d = mp['d']
    if (p['acct'], p['date']) in matched_payment_keys:
        continue
    is_in_profit = (d['owed'] or 0) > 0
    target_kind = 'add_missing_profit' if is_in_profit else 'add_missing_col_g'
    if mp['conf'] in HIGH_CONF:
        corrections[target_kind].append({'p': p, 'd': d, 'conf': mp['conf']})
    else:
        # Low confidence — push to review instead.
        corrections['ambiguous_csv'].append({'p': p, 'd': d, 'conf': mp['conf']})

# 4. Unmatched payments (no surname-matching deal)
for u in unmatched_payments:
    corrections['unknown_customer'].append(u)

# Print summary
print()
print('PLAN SUMMARY:')
for k, v in corrections.items():
    print(f'  {k:24s}: {len(v)}')

# ── Detail tables ───────────────────────────────────────────────────────────
def show(items, title, fmt, limit=30):
    if not items: return
    print()
    print(f'-- {title} ({len(items)}) --')
    for it in items[:limit]:
        print('  ' + fmt(it))
    if len(items) > limit:
        print(f'  … and {len(items)-limit} more')

show(corrections['date_fix_col_g'], 'DATE FIX (col G)',
     lambda it: (f'{it["d"]["tab"]} {it["d"]["location"]} row {it["d"]["sheet_row"]} '
                 f'{it["d"]["car_desc"][:30]:30s} '
                 f'${it["sp"]["line"]["amount"]:>7} '
                 f'{it["old_date"]} → {it["new_date"]} '
                 f'[{it["sp"]["line"]["raw"]}]'))
show(corrections['date_fix_profit'], 'DATE FIX (Profit26)',
     lambda it: (f'{it["sp"]["loc"]:6s} ${it["sp"]["line"]["amount"]:>7} '
                 f'{it["old_date"]} → {it["new_date"]} '
                 f'[{it["sp"]["line"]["raw"]}]'))
show(corrections['add_missing_col_g'], 'ADD MISSING (col G)',
     lambda it: (f'{it["d"]["tab"]} {it["d"]["location"]} row {it["d"]["sheet_row"]} '
                 f'{it["d"]["car_desc"][:30]:30s} '
                 f'${it["p"]["amount"]:>7} {it["p"]["date"]} {it["p"]["name"][:30]} '
                 f'[F={it["d"]["owed"]:.0f}] {it["conf"]}'))
show(corrections['add_missing_profit'], 'ADD MISSING (Profit26)',
     lambda it: (f'{it["d"]["location"]:6s} {it["d"]["car_desc"][:30]:30s} '
                 f'${it["p"]["amount"]:>7} {it["p"]["date"]} {it["p"]["name"][:30]} '
                 f'[F={it["d"]["owed"]:.0f}] {it["conf"]}'))
show(corrections['phantom_post'], 'PHANTOM POSTS (no CSV match)',
     lambda it: (f'{it["sp"]["kind"]:6s} {it["sp"]["loc"]:6s} '
                 f'${it["sp"]["line"]["amount"]:>7} {it["sp"]["line"]["date"]} '
                 f'[{it["sp"]["line"]["raw"]}]'))
show(corrections['wrong_lot_post'], 'WRONG LOT POSTS',
     lambda it: (f'{it["sp"]["loc"]} → {it["d"]["location"]} '
                 f'${it["sp"]["line"]["amount"]:>7} {it["sp"]["line"]["date"]} '
                 f'[{it["sp"]["line"]["raw"]}]'))
show(corrections['unknown_customer'], 'UNKNOWN CUSTOMER',
     lambda it: (f'{it["p"]["csv_loc"]} acct={it["p"]["acct"]} '
                 f'${it["p"]["amount"]:>7} {it["p"]["date"]} {it["p"]["name"][:40]} '
                 f'[{it["reason"]}]'))

# Save plan
plan_path = os.path.join(REPO, 'scripts', 'reconcile_april_plan.json')
with open(plan_path, 'w', encoding='utf-8') as f:
    def _serializable(x):
        if isinstance(x, dict):
            return {k: _serializable(v) for k, v in x.items() if k != 'sp' or True}
        if isinstance(x, list):
            return [_serializable(v) for v in x]
        return x
    summary = {k: [{kk: vv for kk, vv in (it if isinstance(it, dict) else {}).items()
                    if kk not in ('sp',) and not (isinstance(vv, dict) and 'payment_notes' in vv)}
                   for it in v] for k, v in corrections.items()}
    json.dump({'generated': datetime.now().isoformat(),
               'summary': {k: len(v) for k, v in corrections.items()}},
              f, indent=2, default=str)

if not APPLY:
    print()
    print(f'Dry-run only. Re-run with --apply to execute.')
    sys.exit(0)

# ── APPLY phase ─────────────────────────────────────────────────────────────
# audit_log records every action — written to scripts/reconcile_april_log.txt
# at the end so Vlad can verify nothing was done wrong.
audit_log = []
def log(msg):
    audit_log.append(msg)
    print(msg)

log('')
log('=' * 70)
log(f'APPLYING corrections at {datetime.now().isoformat()}')
log('=' * 70)

# Only apply SAFE date fixes (posted_date == today)
safe_col_g_fixes = [c for c in corrections['date_fix_col_g'] if c['safe']]
unsafe_col_g_fixes = [c for c in corrections['date_fix_col_g'] if not c['safe']]
safe_profit_fixes = [c for c in corrections['date_fix_profit'] if c['safe']]
unsafe_profit_fixes = [c for c in corrections['date_fix_profit'] if not c['safe']]

log(f'Date fixes: col_G safe={len(safe_col_g_fixes)} unsafe={len(unsafe_col_g_fixes)} '
    f'/ Profit26 safe={len(safe_profit_fixes)} unsafe={len(unsafe_profit_fixes)}')
log(f'Add missing: col_G={len(corrections["add_missing_col_g"])} '
    f'/ Profit26={len(corrections["add_missing_profit"])}')
log(f'Push to review: phantom={len(corrections["phantom_post"])} '
    f'wrong_lot={len(corrections["wrong_lot_post"])} '
    f'unknown={len(corrections["unknown_customer"])} '
    f'unsafe_date_fixes={len(unsafe_col_g_fixes) + len(unsafe_profit_fixes)}')
log('')

# Group col-G safe date fixes by deal (batch per row)
col_g_by_deal = defaultdict(list)
for c in safe_col_g_fixes:
    key = (c['d']['tab'], c['d']['location'], c['d']['sheet_row'], c['d']['car_desc'])
    col_g_by_deal[key].append(c)

col_g_fixes_ok = col_g_fixes_err = 0
for key, group in col_g_by_deal.items():
    tab, loc, row, car_desc = key
    deal = group[0]['d']
    # Build new payment_notes by replacing each affected line
    cur_lines = (deal['payment_notes'] or '').split('\n')
    new_lines = list(cur_lines)
    changes_for_log = []
    for c in group:
        old_raw = c['sp']['line']['raw']
        new_raw = re.sub(r'(\d{1,2})/(\d{1,2})\s*$',
                         lambda m: f'{int(c["new_date"][5:7])}/{int(c["new_date"][8:10])}',
                         old_raw)
        # Find and replace in new_lines
        replaced = False
        for i, ln in enumerate(new_lines):
            if ln.strip() == old_raw.strip():
                new_lines[i] = new_raw
                replaced = True
                changes_for_log.append((old_raw, new_raw))
                break
        if not replaced:
            print(f'  WARN: could not find line to replace: {old_raw!r} in {tab} {loc} row {row}')
    new_notes = '\n'.join(new_lines).rstrip()
    # Compute total — sum amounts in new_lines
    total = 0.0
    for ln in new_lines:
        p = parse_line(ln)
        if p: total += p['amount']
    try:
        resp = gas_post({
            'action': 'correct_payments',
            'location': loc,
            'data': {
                'tab': tab, 'row': row,
                'new_total': round(total, 2),
                'new_notes': new_notes,
                'expected_car_desc': car_desc,
            }
        })
        if resp and resp.get('ok'):
            col_g_fixes_ok += len(changes_for_log)
            for old, new in changes_for_log:
                log(f'  COL_G_DATE_FIX {tab} {loc} r{row} ({car_desc[:30]}): "{old}" -> "{new}"')
        else:
            col_g_fixes_err += 1
            log(f'  ERR  COL_G {tab} {loc} r{row}: {resp}')
    except Exception as e:
        col_g_fixes_err += 1
        log(f'  ERR  COL_G {tab} {loc} r{row}: {e}')

# Profit26 date fixes — use profit_update_entry per line (only safe ones)
profit_fixes_ok = profit_fixes_err = 0
for c in safe_profit_fixes:
    sp = c['sp']
    pl = sp['line']
    # Build new description (text portion + new date)
    old_desc = pl['text'].strip()
    # Re-attach the new date
    new_desc = f'{old_desc} {int(c["new_date"][5:7])}/{int(c["new_date"][8:10])}' \
        if old_desc else f'{int(c["new_date"][5:7])}/{int(c["new_date"][8:10])}'
    # Refit if needed
    if len(f'{int(pl["amount"])} {new_desc}') > NOTE_MAX:
        # Try removing redundant tokens — keep as-is for now, the formatter
        # is on the GAS side via _fitProfitNoteLine.
        pass
    try:
        resp = gas_post({
            'action': 'profit_update_entry',
            'location': sp['loc'],
            'data': {
                'month_idx': 3,  # April = 3
                'row_type': 'payments',
                'old_amount': pl['amount'],
                'old_description': old_desc + (f' {int(c["old_date"][5:7])}/{int(c["old_date"][8:10])}' if c['old_date'] else ''),
                'new_amount': pl['amount'],
                'new_description': new_desc,
            }
        })
        if resp and resp.get('ok'):
            profit_fixes_ok += 1
            log(f'  PROFIT_DATE_FIX {sp["loc"]} April Payments: "{pl["raw"]}" -> "${int(pl["amount"])} {new_desc}"')
        else:
            profit_fixes_err += 1
            log(f'  ERR  PROFIT {sp["loc"]} "{pl["raw"]}" -> {resp}')
    except Exception as e:
        profit_fixes_err += 1
        log(f'  ERR  PROFIT {sp["loc"]} "{pl["raw"]}" -> {e}')

# Helper: build the formatted note line (matches index.html _paymentNoteLineFit)
def _build_note(amount, deal, name, date):
    cd = deal['car_desc']
    toks = cd.split()
    yr = ''
    if toks and re.match(r'^\d{2,4}$', toks[0]):
        yr = toks[0]
        if len(yr) == 4: yr = yr[2:]
    last = csv_last(name).lower() or (toks[-1].lower().rstrip('.,;:') if toks else '')
    color = ''
    model_tokens = []
    for t in toks[1:-1]:
        tl = t.lower()
        if tl in COLORS and not color:
            color = tl
            continue
        if re.match(r'^\d+k?$', tl): continue
        if tl in ('trade','rbt','2','3'): continue
        model_tokens.append(t)
    model = ' '.join(model_tokens)
    md = int(date[5:7]); dy = int(date[8:10])
    return _fit_note_line(amount, yr, model, color, last, f'{md}/{dy}')

add_col_g_ok = add_col_g_err = 0
add_profit_ok = add_profit_err = 0
# NOTE: Auto-adding missing entries is intentionally DISABLED. The
# matcher has gaps (multi-word surnames, first-name posts, CC fees on
# col G but not Profit26 etc.) and a missed match would result in
# DUPLICATE posts, not in catching real gaps. Instead we push each
# missing payment to review so Vlad can verify the deal target before
# any sheet write happens.

# PUSH REMAINING TO REVIEW
review_pushed = 0
def push_review(rv):
    """Push to payment_reviews with reason='csv_reconciliation'."""
    global review_pushed
    try:
        sb_post('payment_reviews', rv)
        review_pushed += 1
    except Exception as e:
        msg = str(e)
        if '23505' in msg or 'duplicate key' in msg.lower():
            return  # dedup
        print(f'  WARN review push failed: {e}')

# Push phantom_post
for c in corrections['phantom_post']:
    sp = c['sp']
    pl = sp['line']
    push_review({
        'customer_name': pl.get('last_token', '').upper(),
        'amount': pl['amount'],
        'vehicle_year': '', 'vehicle_make': '', 'vehicle_model': '', 'vehicle_color': '',
        'vehicle_vin': '',
        'location': sp['loc'],
        'payment_date': pl.get('date'),
        'payment_method': '',
        'note_line': pl['raw'],
        'reason': 'csv_reconciliation',
        'candidates': json.dumps([]),
        'status': 'pending',
        'snapshot': {
            'direction': 'phantom_in_sheet',
            'profit_lot': sp['loc'] if sp['kind'] == 'profit' else None,
            'profit_label': sp['label'],
            'profit_amount': pl['amount'],
            'profit_description': pl['text'],
            'note': 'No matching CSV transaction. Operator may have logged a non-CSV payment.',
        },
        'created_at': datetime.now().isoformat(),
    })

# Push wrong_lot_post
for c in corrections['wrong_lot_post']:
    sp = c['sp']; p = c['p']; d = c['d']
    push_review({
        'customer_name': csv_last(p['name']),
        'amount': p['amount'],
        'vehicle_year': '', 'vehicle_make': '', 'vehicle_model': '', 'vehicle_color': '',
        'vehicle_vin': '',
        'location': d['location'],
        'payment_date': p['date'],
        'payment_method': '',
        'note_line': sp['line']['raw'],
        'reason': 'csv_reconciliation',
        'candidates': json.dumps([]),
        'status': 'pending',
        'snapshot': {
            'direction': 'wrong_lot',
            'profit_lot': sp['loc'],
            'profit_label': sp['label'],
            'profit_amount': sp['line']['amount'],
            'profit_description': sp['line']['text'],
            'deal_lot': d['location'],
            'car_desc': d['car_desc'],
            'tab': d['tab'],
            'note': c['note'],
        },
        'created_at': datetime.now().isoformat(),
    })

# Push unknown_customer (only if amount notable)
for c in corrections['unknown_customer']:
    p = c['p']
    if p['amount'] < 50:  # skip tiny entries
        continue
    push_review({
        'customer_name': csv_last(p['name']),
        'amount': p['amount'],
        'vehicle_year': '', 'vehicle_make': '', 'vehicle_model': '', 'vehicle_color': '',
        'vehicle_vin': '',
        'location': p['csv_loc'],
        'payment_date': p['date'],
        'payment_method': '',
        'note_line': '',
        'reason': 'csv_reconciliation',
        'candidates': json.dumps([]),
        'status': 'pending',
        'snapshot': {
            'direction': 'unknown_customer',
            'csv_acct': p['acct'],
            'csv_name': p['name'],
            'note': c['reason'],
        },
        'created_at': datetime.now().isoformat(),
    })

# ── Summary ─────────────────────────────────────────────────────────────────
print()
print('=' * 70)
print('DONE')
print('=' * 70)
print(f'  col G date fixes : ok={col_g_fixes_ok}    err={col_g_fixes_err}')
print(f'  profit date fixes: ok={profit_fixes_ok}    err={profit_fixes_err}')
print(f'  added col G      : ok={add_col_g_ok}    err={add_col_g_err}')
print(f'  added Profit26   : ok={add_profit_ok}    err={add_profit_err}')
print(f'  pushed to review : {review_pushed}')
