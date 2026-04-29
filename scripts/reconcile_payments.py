#!/usr/bin/env python3
# -*- coding: utf-8 -*-
import sys, io
# Force UTF-8 output on Windows so Unicode chars don't crash
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')
"""
reconcile_payments.py
Reconciles Google Sheets Deals26/25/24 payment totals (col G) against
the ProfitMoneyCollected CSVs from the dealer management system.

Usage:
  py scripts/reconcile_payments.py              # dry-run report only
  py scripts/reconcile_payments.py --push       # also inserts payment_reviews rows

The script reads:
  - Payments/Debary/ProfitMoneyCollected_RunOn_*.csv  (most recent)
  - Payments/Deland/ProfitMoneyCollected_RunOn_*.csv  (most recent)
  - SoldInventoryDeBary.csv
  - SoldInventoryDeLand.csv
  - Deals26/25/24 from both locations via Apps Script read_all
  - deals26 from Supabase (faster than sheet for current year)

Link chain (primary — stock-number based, unambiguous):
  Deals row car_desc → lastName + year/model
  → SoldInventory row (matched by last name, narrowed by year/model)
  → SoldInventory stockno
  → Payment CSV custaccountno (exact match on stockno)
  → sum all PAYMENT totalamt + LATEFEE latefee, excluding OPEN/NETPAYOFF refs

Fallback (name-based, for unlinked rows with no inventory match):
  Deals row car_desc → lastName
  → Payment CSV lookupname (last-name prefix match)

Output (always):
  scripts/reconciliation_report.json

With --push:
  Inserts payment_reviews rows (reason='csv_reconciliation') for all
  rows where sheet total ≠ CSV total (within $1 tolerance).
"""

import csv, json, os, sys, re, urllib.request, urllib.parse, glob
from collections import defaultdict
from datetime import datetime

# ── Config ──────────────────────────────────────────────────────────────────
REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co'
SB_KEY = ('eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIs'
          'InJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYX'
          'QiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN'
          '7rJk9MCLRdkyv0INmuFwAVo')
SB_HDR = {'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY,
          'Content-Type': 'application/json', 'Prefer': 'return=representation'}

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

TOLERANCE = 1.00   # dollars — differences within this are "verified"
PUSH = '--push' in sys.argv

# Automation cutoff: only verify accounts with ≥1 CSV transaction on/after this
# date. Pre-automation accounts were entered by hand by the owner and are trusted.
# Automation went live ~April 9, 2026 — anything from then on is what we check.
CUTOFF_DATE = '2026-04-09'

# ── Helpers ─────────────────────────────────────────────────────────────────
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
                import time; time.sleep(3)
    raise last_err

def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def sb_post(table, row):
    data = json.dumps(row).encode()
    req = urllib.request.Request(f'{SB_URL}/rest/v1/{table}',
                                 data=data, headers=SB_HDR, method='POST')
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())

def latest_csv(folder):
    pattern = os.path.join(REPO, 'Payments', folder, 'ProfitMoneyCollected_RunOn_*.csv')
    files = sorted(glob.glob(pattern))
    return files[-1] if files else None

def extract_last_name(car_desc):
    """Extract last token from car_desc as the customer last name."""
    tokens = str(car_desc or '').strip().split()
    return tokens[-1].upper() if tokens else ''

def extract_year(car_desc):
    """Extract 2-digit year prefix from car_desc (e.g. '17 Forte...' → 2017)."""
    m = re.match(r'^(\d{2})\s', str(car_desc or '').strip())
    if not m:
        return None
    yr = int(m.group(1))
    return 2000 + yr if yr <= 50 else 1900 + yr

def extract_model(car_desc):
    """Extract model token (second word) from car_desc."""
    tokens = str(car_desc or '').strip().split()
    return tokens[1].upper() if len(tokens) > 1 else ''

def fmt_money(v):
    return f'${v:,.2f}'

# Parse payment_notes lines like "230 Camry malpica 4/13" → list of dated entries.
# Format: "<amount> <description> <M>/<D>" — one entry per line, separated by \n.
# The year is inferred from CUTOFF_DATE so M/D entries get tagged as the year
# automation has been running. Lines without a trailing M/D are pre-automation
# manual entries (no date) and are not counted into the automation total.
_NOTE_LINE_RE = re.compile(r'^\s*([\d,]+(?:\.\d+)?)\s+.+?\s+(\d{1,2})/(\d{1,2})\s*$')
def parse_payment_notes(notes, year=None):
    """Return list of {amount, date(YYYY-MM-DD), line} for dated note entries."""
    if not notes:
        return []
    if year is None:
        year = int(CUTOFF_DATE[:4])
    out = []
    for line in str(notes).split('\n'):
        line = line.strip()
        if not line:
            continue
        m = _NOTE_LINE_RE.match(line)
        if not m:
            continue
        try:
            amt = float(m.group(1).replace(',', ''))
            mo  = int(m.group(2))
            dy  = int(m.group(3))
            if not (1 <= mo <= 12 and 1 <= dy <= 31):
                continue
            out.append({'amount': round(amt, 2),
                        'date': f'{year:04d}-{mo:02d}-{dy:02d}',
                        'line': line})
        except (ValueError, TypeError):
            pass
    return out

# ── Step 1: Load SoldInventory CSVs ─────────────────────────────────────────
print('Loading SoldInventory CSVs…')
inv_by_last  = defaultdict(list)  # LAST → list of inventory rows
inv_by_stock = {}                  # stockno (str) → inventory row

for loc, fname in [('DeBary', 'SoldInventoryDeBary.csv'),
                   ('DeLand', 'SoldInventoryDeLand.csv')]:
    path = os.path.join(REPO, fname)
    if not os.path.exists(path):
        print(f'  WARNING: {fname} not found, skipping')
        continue
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            name = row.get('lookupname', '').strip()
            if not name:
                continue
            row['_loc'] = loc
            last = name.split(',')[0].strip().upper()
            inv_by_last[last].append(row)
            stockno = str(row.get('stockno', '')).strip()
            if stockno:
                inv_by_stock[stockno] = row

print(f'  {sum(len(v) for v in inv_by_last.values())} inventory records, '
      f'{len(inv_by_last)} unique last names, '
      f'{len(inv_by_stock)} unique stock numbers')

# ── Step 2: Load Payment CSVs ────────────────────────────────────────────────
print('Loading Payment CSVs…')
# Primary index: custaccountno (matches SoldInventory stockno)
acc_totals  = defaultdict(float)   # custaccountno (str) → total collected
acc_txns    = defaultdict(list)    # custaccountno (str) → list of {date,amt,type,ref}
# Fallback index: lookupname (for unlinked rows with no inventory match)
pay_totals  = defaultdict(float)   # lookupname.upper() → total collected
pay_by_name = defaultdict(list)    # lookupname.upper() → list of {date,amt,type,ref}

# Automation-era flags: which accounts/names have ≥1 payment on/after cutoff
acc_has_post_cutoff  = set()   # set of custaccountno
name_has_post_cutoff = set()   # set of lookupname.upper()

# Maps name → set of custaccountno's so we can disambiguate same-name customers
# who have multiple accounts (e.g. paid off one car and bought another).
name_to_accts = defaultdict(set)  # lookupname.upper() → {custaccountno, ...}
acc_to_name   = {}                # custaccountno → lookupname.upper()

SKIP_REFS = {'OPEN', 'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF',
             'OPEN REFINANCE OPEN', 'NETPAYOFF/WRITEOFF'}

# PAY OFF reference values that count as real cash collected (vs. writeoffs).
# NETPAYOFF        — customer paid the full payoff balance
# NETPAYOFF/NOWRITEOFF — same, explicitly no writeoff applied
# Excluded: NETPAYOFF/WRITEOFF and NETPAYOFF/PTWRITEOFF — partial/full writeoffs
# where the dealer absorbed the loss (not real cash collected).
PAYOFF_OK_REFS = {'NETPAYOFF', 'NETPAYOFF/NOWRITEOFF'}

for loc, folder in [('DeBary', 'Debary'), ('DeLand', 'Deland')]:
    path = latest_csv(folder)
    if not path:
        print(f'  WARNING: No payment CSV found for {loc}')
        continue
    print(f'  {loc}: {os.path.basename(path)}')
    with open(path, encoding='utf-8-sig') as f:
        for row in csv.DictReader(f):
            name  = row.get('lookupname', '').strip().upper()
            acct  = str(row.get('custaccountno', '')).strip()
            ttype = row.get('transtype', '').strip()
            ref   = row.get('reference', '').strip().upper()
            # Transaction types we count toward col G:
            #   PAYMENT  — regular payment (skip OPEN/NetPayoff refs which are
            #              down payments and system-calculated payoff entries)
            #   PAYPICK  — pickup payment (deferred down payment installment;
            #              also goes into col G/Profit). Skip writeoff variants.
            #   PAY OFF  — final payoff payment (customer's balloon to close the
            #              loan). All NetPayoff* refs are real cash collected.
            #   LATEFEE  — late fee charged (counts toward total collected)
            # Excluded: PAYOFF (REFIANCE PAYOFF — refinance accounting),
            #           DEPOSIT (sale deposit — col E), EARNEDINT (interest).
            if ttype == 'PAYMENT':
                if ref in SKIP_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAYPICK':
                if ref in SKIP_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'PAY OFF':
                # Final payoff — customer's last payment closing the loan.
                # Only include refs that represent cash actually collected.
                # WRITEOFF/PTWRITEOFF variants are skipped — those are amounts
                # the dealer wrote off, not money the customer paid.
                if ref not in PAYOFF_OK_REFS:
                    continue
                amt = float(row.get('totalamt', 0) or 0)
            elif ttype == 'LATEFEE':
                amt = float(row.get('latefee', 0) or 0)
            else:
                continue
            if amt <= 0:
                continue

            raw_date = row.get('paiddate', '')
            # Normalize "5/20/2025 12:00:00 AM" → "2025-05-20"
            try:
                dt = datetime.strptime(raw_date.split(' ')[0], '%m/%d/%Y')
                date_str = dt.strftime('%Y-%m-%d')
            except Exception:
                date_str = raw_date[:10]
            txn = {
                'date': date_str,
                'amount': round(amt, 2),
                'type': ttype,
                'ref': row.get('reference', '').strip(),
                'acct': acct
            }

            # Mark account as automation-touched if this txn is on/after cutoff
            if date_str >= CUTOFF_DATE:
                if acct:  acc_has_post_cutoff.add(acct)
                if name:  name_has_post_cutoff.add(name)

            # Primary: by custaccountno
            if acct:
                acc_totals[acct] += amt
                acc_txns[acct].append(txn)
            # Fallback: by name
            if name:
                pay_totals[name] += amt
                pay_by_name[name].append(txn)
            # Track name↔accounts mapping for same-name disambiguation
            if name and acct:
                name_to_accts[name].add(acct)
                acc_to_name[acct] = name

print(f'  {len(acc_totals)} unique account numbers with payments')
print(f'  {len(pay_totals)} unique names with payments, '
      f'{sum(len(v) for v in acc_txns.values())} total transactions')
print(f'  Automation-touched accounts (≥1 txn on/after {CUTOFF_DATE}): '
      f'{len(acc_has_post_cutoff)} by account, {len(name_has_post_cutoff)} by name')

# ── Step 3: Load all 6 Deals sheet tabs ──────────────────────────────────────
print('Loading Deals sheets from Apps Script…')
all_deals = []  # list of {tab, location, row_data}

# Current-year Deals26: prefer Supabase (faster) for DeBary/DeLand combined
try:
    d26_rows = sb_get('deals26', 'select=id,car_desc,payments,payment_notes,location&limit=2000')
    for r in d26_rows:
        all_deals.append({'tab': 'Deals26', 'location': r.get('location', 'DeBary'), 'row': r})
    print(f'  Deals26 (Supabase): {len(d26_rows)} rows')
except Exception as e:
    print(f'  Deals26 Supabase failed ({e}), falling back to sheet')
    for loc in ['DeBary', 'DeLand']:
        try:
            resp = gas_post({'action': 'read_all', 'tab': 'Deals26', 'location': loc})
            rows = resp.get('rows', [])
            for r in rows:
                all_deals.append({'tab': 'Deals26', 'location': loc, 'row': r})
            print(f'  Deals26 {loc} (sheet): {len(rows)} rows')
        except Exception as e2:
            print(f'  WARNING: Deals26 {loc} sheet failed: {e2}')

# Deals25 and Deals24: sheet only
for tab in ['Deals25', 'Deals24']:
    for loc in ['DeBary', 'DeLand']:
        try:
            resp = gas_post({'action': 'read_all', 'tab': tab, 'location': loc})
            rows = resp.get('rows', [])
            if not rows:
                print(f'  {tab} {loc}: empty/no sheet')
                continue
            for r in rows:
                all_deals.append({'tab': tab, 'location': loc, 'row': r})
            print(f'  {tab} {loc}: {len(rows)} rows')
        except Exception as e:
            print(f'  WARNING: {tab} {loc} failed: {e}')

print(f'  Total deals rows loaded: {len(all_deals)}')

# ── Step 4: Reconcile ────────────────────────────────────────────────────────
print('Reconciling…')

results = {
    'verified': [],
    'discrepant': [],    # sheet ≠ CSV (within tolerance)
    'unlinked_inv': [],  # no SoldInventory match for this last name
    'ambiguous': [],     # multiple SoldInventory entries for same last name
    'no_csv_payments': [],  # in SoldInventory but no CSV payments at all
    'skipped_zero': [],  # sheet payments=0 AND no CSV payments (likely cash sale)
    'skipped_pre_automation': [],  # account has no post-CUTOFF activity → trusted
}
stats = defaultdict(int)

for deal in all_deals:
    tab    = deal['tab']
    loc    = deal['location']
    r      = deal['row']
    car_desc    = str(r.get('car_desc', '') or '').strip()
    sheet_total = float(r.get('payments', 0) or 0)
    sheet_notes = str(r.get('payment_notes', '') or '').strip()
    sheet_row   = r.get('_sheetRow') or r.get('sort_order')  # sheet row or sort_order

    if not car_desc:
        stats['blank_car_desc'] += 1
        continue

    last = extract_last_name(car_desc)
    if not last:
        stats['no_last'] += 1
        continue

    # --- Find SoldInventory match ---
    inv_hits = inv_by_last.get(last, [])

    # Narrow by year + model if multiple hits
    if len(inv_hits) > 1:
        yr    = extract_year(car_desc)
        model = extract_model(car_desc)
        narrowed = [h for h in inv_hits
                    if (not yr or str(yr) == str(h.get('year', '')))
                    and (not model or model in h.get('model', '').upper())]
        if len(narrowed) >= 1:
            inv_hits = narrowed  # could be 1 (resolved) or still >1 (ambiguous)

    # If still multiple hits, try to resolve via stockno → payment CSV presence.
    # The customer's payment account number in the CSV equals the stockno in SoldInventory.
    if len(inv_hits) > 1:
        with_payments = [h for h in inv_hits
                         if str(h.get('stockno', '')).strip() in acc_totals]
        if len(with_payments) == 1:
            inv_hits = with_payments  # uniquely resolved via stockno

    if not inv_hits:
        # No SoldInventory record at all. Check if CSV has payments by last name anyway.
        csv_name_hit = next((k for k in pay_totals if k.split(',')[0].strip() == last), None)
        if csv_name_hit and pay_totals[csv_name_hit] > 0:
            entry = {
                'car_desc': car_desc, 'tab': tab, 'location': loc,
                'sheet_row': sheet_row, 'sheet_total': round(sheet_total, 2),
                'csv_total': round(pay_totals[csv_name_hit], 2),
                'csv_name': csv_name_hit,
                'vin': '', 'vehicle_year': '', 'vehicle_make': '', 'vehicle_model': '',
                'csv_transactions': pay_by_name.get(csv_name_hit, []),
                'sheet_notes': sheet_notes,
                'note': 'No SoldInventory record; CSV name matched by last name only'
            }
            results['unlinked_inv'].append(entry)
        elif sheet_total > 0:
            results['unlinked_inv'].append({
                'car_desc': car_desc, 'tab': tab, 'location': loc,
                'sheet_row': sheet_row, 'sheet_total': round(sheet_total, 2),
                'csv_total': 0, 'csv_name': None,
                'vin': '', 'vehicle_year': '', 'vehicle_make': '', 'vehicle_model': '',
                'csv_transactions': [], 'sheet_notes': sheet_notes,
                'note': 'No SoldInventory record and no CSV match; sheet has payments'
            })
        else:
            stats['no_inv_no_csv_no_sheet'] += 1
        continue

    if len(inv_hits) > 1:
        # Still ambiguous after all narrowing. Record which stocknos were tried.
        results['ambiguous'].append({
            'car_desc': car_desc, 'tab': tab, 'location': loc,
            'sheet_row': sheet_row, 'sheet_total': round(sheet_total, 2),
            'inv_matches': [{'lookupname': h.get('lookupname'),
                             'vin': h.get('vin'),
                             'stockno': h.get('stockno'),
                             'year': h.get('year'),
                             'model': h.get('model'),
                             'has_csv_payments': str(h.get('stockno','')).strip() in acc_totals}
                            for h in inv_hits],
            'sheet_notes': sheet_notes
        })
        stats['ambiguous'] += 1
        continue

    # ── Single match — link by full lookupname to find this car's CSV account ──
    # (custaccountno in CSV ≠ stockno in SoldInventory; the only reliable join
    # across the two exports is the customer's full lookupname.)
    inv_row  = inv_hits[0]
    stockno  = str(inv_row.get('stockno', '')).strip()
    csv_name = inv_row.get('lookupname', '').upper()

    # AUTOMATION-ERA FILTER: skip accounts the owner entered by hand pre-automation.
    # Only verify accounts where ≥1 payment was made on/after CUTOFF_DATE — those
    # are the ones automation has touched and the ones we need to confirm are right.
    if csv_name not in name_has_post_cutoff:
        stats['skipped_pre_automation'] += 1
        results['skipped_pre_automation'].append({
            'car_desc': car_desc, 'tab': tab, 'location': loc,
            'csv_name': csv_name,
            'csv_total': round(pay_totals.get(csv_name, 0.0), 2),
            'sheet_total': round(sheet_total, 2)
        })
        continue

    # Pick the right CSV account for THIS car. A customer may have multiple
    # custaccountno's (paid off one car, bought another). Filter to accounts with
    # ≥1 post-cutoff payment — that's the one automation has been writing to.
    accts_for_name = name_to_accts.get(csv_name, set())
    active_accts   = {a for a in accts_for_name if a in acc_has_post_cutoff}
    chosen_acct    = None
    if len(active_accts) == 1:
        chosen_acct = next(iter(active_accts))
        csv_total   = round(acc_totals[chosen_acct], 2)
        csv_txns    = sorted(acc_txns[chosen_acct], key=lambda x: x['date'])
    elif len(active_accts) > 1:
        # Same name with multiple currently-active accounts. Can't pick safely —
        # flag as ambiguous so it can be resolved by a human.
        results['ambiguous'].append({
            'car_desc': car_desc, 'tab': tab, 'location': loc,
            'sheet_row': sheet_row, 'sheet_total': round(sheet_total, 2),
            'csv_name': csv_name,
            'note': 'Multiple post-cutoff accounts under same name',
            'candidate_accts': [
                {'acct': a, 'total': round(acc_totals[a], 2),
                 'first_date': min(t['date'] for t in acc_txns[a]) if acc_txns[a] else '',
                 'last_date':  max(t['date'] for t in acc_txns[a]) if acc_txns[a] else ''}
                for a in sorted(active_accts)
            ],
            'sheet_notes': sheet_notes
        })
        stats['ambiguous'] += 1
        continue
    else:
        # Name flagged as post-cutoff but no specific active account found
        # (defensive — shouldn't happen). Fall back to the name-based total.
        csv_total = round(pay_totals.get(csv_name, 0.0), 2)
        csv_txns  = sorted(pay_by_name.get(csv_name, []), key=lambda x: x['date'])

    # ── Compute automation-era (post-cutoff) sums on both sides ──
    # Sheet side: parse dated note entries, keep only those ≥ CUTOFF_DATE.
    note_entries = parse_payment_notes(sheet_notes)
    sheet_post   = round(sum(e['amount'] for e in note_entries
                             if e['date'] >= CUTOFF_DATE), 2)
    # CSV side: filter txns to ≥ CUTOFF_DATE.
    csv_post     = round(sum(t['amount'] for t in csv_txns
                             if t['date'] >= CUTOFF_DATE), 2)

    # Both zero → skip (cash sale or pre-system deal with no payments)
    if sheet_total == 0 and csv_total == 0:
        stats['both_zero'] += 1
        results['skipped_zero'].append({'car_desc': car_desc, 'tab': tab, 'location': loc})
        continue

    # Primary check: automation contribution. Compare post-cutoff sums.
    # Pre-cutoff col G is owner-entered and trusted, so we don't compare it.
    diff_post = round(csv_post - sheet_post, 2)
    # Also compute legacy all-time diff for reference
    diff_total = round(csv_total - sheet_total, 2)

    base = {
        'car_desc': car_desc, 'tab': tab, 'location': loc,
        'sheet_row': sheet_row,
        'sheet_total': round(sheet_total, 2),
        'sheet_post_cutoff': sheet_post,
        'csv_total': csv_total,
        'csv_post_cutoff': csv_post,
        'difference': diff_post,             # primary signal: automation-era diff
        'difference_alltime': diff_total,    # informational: full-history diff
        'csv_name': csv_name,
        'csv_acct': chosen_acct,
        'stockno': stockno,
        'vin': inv_row.get('vin', ''),
        'vehicle_year': inv_row.get('year', ''),
        'vehicle_make': inv_row.get('make', ''),
        'vehicle_model': inv_row.get('model', ''),
        'csv_transactions': csv_txns,
        'csv_post_txns':    [t for t in csv_txns if t['date'] >= CUTOFF_DATE],
        'sheet_post_entries': [e for e in note_entries if e['date'] >= CUTOFF_DATE],
        'sheet_notes': sheet_notes
    }

    if abs(diff_post) <= TOLERANCE:
        results['verified'].append(base)
        stats['verified'] += 1
    else:
        base['direction'] = 'sheet_short' if diff_post > 0 else 'sheet_excess'
        results['discrepant'].append(base)
        stats['discrepant'] += 1

# ── Step 4b: Detect same-account double-binds ────────────────────────────────
# If two or more deals ended up linked to the same custaccountno, only one of
# them is actually correct — the customer has multiple deals (different cars)
# but only one active payment account. Move these to ambiguous so a human picks
# which deal the active account belongs to.
acct_to_deals = defaultdict(list)
for bucket in ('verified', 'discrepant'):
    for entry in results[bucket]:
        acct = entry.get('csv_acct')
        if acct:
            acct_to_deals[acct].append((bucket, entry))

reassigned = 0
for acct, hits in acct_to_deals.items():
    if len(hits) > 1:
        for bucket, entry in hits:
            try:
                results[bucket].remove(entry)
            except ValueError:
                pass
            results['ambiguous'].append({
                'car_desc':   entry['car_desc'],
                'tab':        entry['tab'],
                'location':   entry['location'],
                'sheet_row':  entry.get('sheet_row'),
                'sheet_total': entry['sheet_total'],
                'csv_name':   entry.get('csv_name'),
                'shared_acct': acct,
                'csv_total':  entry.get('csv_total', 0),
                'note':       f'Account {acct} is referenced by {len(hits)} deals — only one is the real owner',
                'siblings': [{'car_desc': h[1]['car_desc'], 'tab': h[1]['tab'], 'sheet_row': h[1].get('sheet_row')}
                             for h in hits if h[1] is not entry],
                'sheet_notes': entry.get('sheet_notes', '')
            })
            reassigned += 1
            stats['discrepant'] -= 1 if bucket == 'discrepant' else 0
            stats['verified']   -= 1 if bucket == 'verified' else 0
            stats['ambiguous']  += 1
if reassigned:
    print(f'  Reassigned {reassigned} same-account-shared deals to ambiguous')

# ── Step 5: Report ────────────────────────────────────────────────────────────
total_rows = len(all_deals)
print()
print('=' * 60)
print(f'RECONCILIATION REPORT — automation-era only (≥{CUTOFF_DATE})')
print('=' * 60)
print(f'Total deals rows scanned:        {total_rows}')
print(f'  Skipped (pre-automation):      {len(results["skipped_pre_automation"])}')
print(f'  Verified (within ${TOLERANCE:.0f}):           {len(results["verified"])}')
print(f'  Discrepant:                    {len(results["discrepant"])}')
print(f'  Unlinked (no inv match):       {len(results["unlinked_inv"])}')
print(f'  Ambiguous (multi-match):       {len(results["ambiguous"])}')
print(f'  Both zero (skipped):           {len(results["skipped_zero"])}')
print()

if results['discrepant']:
    print(f'-- DISCREPANCIES (post-{CUTOFF_DATE} only — automation-era) --')
    total_short = sum(d['difference'] for d in results['discrepant'] if d['difference'] > 0)
    total_excess = sum(abs(d['difference']) for d in results['discrepant'] if d['difference'] < 0)
    print(f'  Sheet underpaid (CSV > sheet): {fmt_money(total_short)}')
    print(f'  Sheet overpaid  (sheet > CSV): {fmt_money(total_excess)}')
    print()
    print(f'  {"":42}  {"sheet/csv post-cutoff":<30}  diff')
    for d in sorted(results['discrepant'], key=lambda x: abs(x['difference']), reverse=True)[:20]:
        arrow = '↑' if d['difference'] > 0 else '↓'
        print(f'  {arrow} {d["car_desc"][:40]:<40}  '
              f'{fmt_money(d["sheet_post_cutoff"])}/{fmt_money(d["csv_post_cutoff"]):<14}  '
              f'{fmt_money(abs(d["difference"])):<10} [{d["tab"]} {d["location"]}]')
    if len(results['discrepant']) > 20:
        print(f'  … and {len(results["discrepant"]) - 20} more (see report JSON)')

print()
if results['unlinked_inv']:
    print('-- UNLINKED (no SoldInventory match) --')
    for u in results['unlinked_inv'][:10]:
        print(f'  {u["car_desc"][:40]:<40} sheet={fmt_money(u["sheet_total"])} [{u["tab"]} {u["location"]}]')
    if len(results['unlinked_inv']) > 10:
        print(f'  … and {len(results["unlinked_inv"]) - 10} more')

# ── Step 6: Write JSON report ─────────────────────────────────────────────────
report_path = os.path.join(REPO, 'scripts', 'reconciliation_report.json')
report = {
    'generated_at': datetime.now().isoformat(),
    'stats': {
        'total_scanned': total_rows,
        'verified': len(results['verified']),
        'discrepant': len(results['discrepant']),
        'unlinked_inv': len(results['unlinked_inv']),
        'ambiguous': len(results['ambiguous']),
        'skipped_zero': len(results['skipped_zero']),
    },
    **results
}
with open(report_path, 'w', encoding='utf-8') as f:
    json.dump(report, f, indent=2, default=str)
print()
print(f'Full report written to: {report_path}')

# ── Step 7: Push to payment_reviews (--push only) ────────────────────────────
if not PUSH:
    print()
    print('Dry run complete. Run with --push to insert payment_reviews rows.')
    sys.exit(0)

print()
print('Pushing discrepancies to payment_reviews…')
push_items = results['discrepant'] + results['unlinked_inv']
pushed = 0
errors = 0
skipped_dup = 0

for item in push_items:
    # Check for existing pending review for this car_desc + tab to avoid dupes
    try:
        existing = sb_get('payment_reviews',
            f'reason=eq.csv_reconciliation'
            f'&status=eq.pending'
            f'&customer_name=eq.{urllib.parse.quote(item.get("csv_name","") or item["car_desc"])}'
            f'&limit=1')
        if existing:
            skipped_dup += 1
            continue
    except Exception:
        pass

    snapshot = {
        'car_desc':        item['car_desc'],
        'tab':             item['tab'],
        'sheet_row':       item.get('sheet_row'),
        'sheet_total':     item['sheet_total'],
        'csv_total':       item.get('csv_total', 0),
        'difference':      item.get('difference', item.get('csv_total', 0) - item['sheet_total']),
        'direction':       item.get('direction', 'unlinked'),
        'csv_transactions': item.get('csv_transactions', []),
        'sheet_notes':     item.get('sheet_notes', ''),
        'note':            item.get('note', ''),
        'vehicle_year':    item.get('vehicle_year', ''),
        'vehicle_make':    item.get('vehicle_make', ''),
        'vehicle_model':   item.get('vehicle_model', ''),
        'vehicle_vin':     item.get('vin', ''),
    }
    candidates = []
    if item.get('sheet_row') and item.get('tab'):
        candidates = [{'tab': item['tab'], 'row': item['sheet_row'],
                       'car_desc': item['car_desc'], 'location': item['location']}]

    diff_amt = abs(item.get('difference', item.get('csv_total', 0) - item['sheet_total']))
    review_row = {
        'customer_name':  item.get('csv_name') or item['car_desc'],
        'amount':         round(diff_amt, 2),
        'vehicle_vin':    item.get('vin', '') or '',
        'vehicle_year':   str(item.get('vehicle_year', '') or ''),
        'vehicle_make':   str(item.get('vehicle_make', '') or ''),
        'vehicle_model':  str(item.get('vehicle_model', '') or ''),
        'vehicle_color':  '',
        'location':       item['location'],
        'payment_date':   None,
        'payment_method': '',
        'note_line':      item['car_desc'],
        'reason':         'csv_reconciliation',
        'candidates':     json.dumps(candidates),
        'status':         'pending',
        'snapshot':       snapshot,
        'created_at':     datetime.now().isoformat()
    }

    try:
        sb_post('payment_reviews', review_row)
        pushed += 1
    except Exception as e:
        errors += 1
        print(f'  ERROR inserting review for {item["car_desc"]}: {e}')

print(f'  Pushed: {pushed} | Skipped (dup): {skipped_dup} | Errors: {errors}')
print('Done.')
