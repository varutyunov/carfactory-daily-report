#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
review_revalidate.py
Re-checks every pending payment_reviews row against current sheet state and
auto-resolves any whose underlying issue no longer exists.

Why this exists: payment_reviews is append-only. The live payment flow and
the audit script both INSERT review cards but nothing was clearing them
when the underlying payment finally landed (manual Apps Script post,
operator-led posting via the queue's Apply Fix flow, etc.). Result: queue
accumulates "ghost" cards for issues that are already resolved.

The browser-side `_reviewAutoStale` handles live-flow reviews when the
user opens the Review tab. But it skips csv_reconciliation reviews
(they have no vehicle_year/model/vin to match on) AND it never runs
unless the user opens the tab. This script runs server-side on every
cron tick (invoked by inventory-sync.js).

Resolution rules per direction:

  phantom_in_sheet   → resolved iff the offending Profit26 line is GONE
                       (snapshot.profit_lot + profit_amount + last name).
                       If still present, leave pending — phantom is still
                       phantom.

  wrong_lot          → resolved iff the offending line is GONE from the
                       wrong lot. (Even better signal: also present in
                       correct lot — but absence from wrong lot is
                       sufficient because the user fixed the routing.)

  missing_from_profit (F>0 deal) → resolved iff amount + surname now
                       appears in correct-lot Profit26 Payments OR in
                       the deal's col G (allows for sum-of-lines: if
                       same-day col G entries sum to ≈ amount).

  missing_from_col_g (F≤0 deal) → resolved iff amount + surname now
                       appears in the deal's col G (sum tolerated).

Live-flow reasons (multiple / no_match / partial / approve_first /
possible_duplicate / deal_pending) are ALSO re-checked: if Profit26
Payments OR col G of any deal with matching surname now contains a
matching line, mark resolved. Mirrors the in-app `_reviewAutoStale`
logic but runs without requiring the user to open the tab.

Usage:
  python scripts/review_revalidate.py            # dry-run, prints actions
  python scripts/review_revalidate.py --apply    # actually patches DB
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')
if sys.stderr.encoding and sys.stderr.encoding.lower() != 'utf-8':
    sys.stderr = io.TextIOWrapper(sys.stderr.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request, urllib.parse
from collections import defaultdict
from datetime import datetime

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_KEY, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'

AMOUNT_TOL = 1.00
DATE_TOL_DAYS = 3

APPLY = '--apply' in sys.argv
VERBOSE = '--verbose' in sys.argv or '-v' in sys.argv

# ── HTTP ────────────────────────────────────────────────────────────────────
def gas_post(body, retries=2):
    body['secret'] = GAS_SECRET
    data = json.dumps(body).encode()
    last = None
    for attempt in range(retries + 1):
        try:
            req = urllib.request.Request(GAS_URL, data=data,
                headers={'Content-Type': 'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
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

def sb_patch(table, row_id, body):
    url = f'{SB_URL}/rest/v1/{table}?id=eq.{row_id}'
    data = json.dumps(body).encode()
    req = urllib.request.Request(url, data=data,
        headers={**SB_HDR, 'Content-Type': 'application/json',
                 'Prefer': 'return=minimal'}, method='PATCH')
    with urllib.request.urlopen(req, timeout=30) as r:
        return r.status

# ── Helpers ─────────────────────────────────────────────────────────────────
_NOTE_DATED_RE = re.compile(r'^\s*([\d,]+(?:\.\d+)?)\s+.+?\s+(\d{1,2})/(\d{1,2})\s*$')
_NOTE_AMT_RE   = re.compile(r'^\s*([\d,]+(?:\.\d+)?)\s+(.+?)\s*$')

def parse_notes(notes, year=2026):
    """Parse a payment_notes / Profit26 cell into structured lines.
    Returns list of {amount, date(opt), text, raw}."""
    out = []
    if not notes:
        return out
    for ln in str(notes).split('\n'):
        ln = ln.rstrip()
        if not ln.strip():
            continue
        m = _NOTE_AMT_RE.match(ln)
        if not m:
            continue
        try:
            amt = float(m.group(1).replace(',', ''))
        except ValueError:
            continue
        rest = m.group(2)
        date_str = None
        dm = _NOTE_DATED_RE.match(ln)
        if dm:
            try:
                mo = int(dm.group(2)); dy = int(dm.group(3))
                if 1 <= mo <= 12 and 1 <= dy <= 31:
                    date_str = f'{year:04d}-{mo:02d}-{dy:02d}'
            except ValueError:
                pass
        out.append({'amount': round(amt, 2), 'date': date_str,
                    'text': rest, 'raw': ln.strip()})
    return out

def days_apart(a, b):
    if not a or not b:
        return 999
    try:
        da = datetime.strptime(a, '%Y-%m-%d')
        db = datetime.strptime(b, '%Y-%m-%d')
        return abs((da - db).days)
    except Exception:
        return 999

def last_name_from_review(rv):
    """Extract surname for matching. Prefers the deal's car_desc tail (the
    canonical surname on the row) over customer_name, because customer_name
    can be a CSV-format 'LAST, FIRST' or a payer name that differs from the
    deal owner."""
    snap = rv.get('snapshot') or {}
    cd = snap.get('car_desc') or ''
    if cd:
        toks = str(cd).strip().split()
        if toks:
            tail = toks[-1].lower().rstrip('.,;:')
            if len(tail) >= 3:
                return tail
    n = rv.get('customer_name') or ''
    if not n:
        return ''
    s = str(n).strip()
    if ',' in s:
        return s.split(',')[0].strip().lower().rstrip('.,;:')
    parts = s.split()
    return (parts[-1] if parts else '').lower().rstrip('.,;:')

_WORD_RE = re.compile(r'[a-z0-9]+')

def _surname_in_text(last_name, text):
    """Word-boundary surname match. Avoids 'silva' colliding with 'silverado'
    or 'toro' colliding with 'toronado'. Tolerates truncation: a 6-char
    surname matches if any word in text is the surname OR the surname is
    a prefix of a word with at least 4 char overlap.

    Examples that should match:
      surname='garraway', text='challenger garraw 4/15' → 'garraw' is a
        word, garraway[:6]='garraw' → match
      surname='garraw',  text='challenger garraway 4/15' → garraway
        starts with garraw → match
    Examples that should NOT match:
      surname='silva',   text='silverado blue 4/15' → silverado is a word
        of length 9, silva[:5]='silva' is not a prefix of 'silverado' if
        we require min(len(surname), len(word)) chars... actually wait,
        silva[:5]='silva' and silverado starts with 'silver' which is
        'silv'+'er'. silva's first 4 chars are 'silv', silverado's first
        4 are 'silv'. 4-char overlap.
      So we tighten: require at least 5 char overlap unless the surname
        IS a complete word in text."""
    ll = (last_name or '').lower()
    if len(ll) < 3:
        return False
    words = _WORD_RE.findall((text or '').lower())
    for w in words:
        if w == ll:
            return True
        # Truncation: line's word is the full surname truncated
        # (line='garraw' for surname='garraway').
        if len(w) >= 4 and ll.startswith(w):
            return True
        # Truncation: review's surname is a truncation of a word in line
        # (surname='garraw' matches 'garraway' in line).
        if len(ll) >= 4 and w.startswith(ll) and len(w) - len(ll) <= 3:
            return True
    return False

def line_matches(line, amount, last_name, date=None, allow_cc_fee=False):
    """A line matches if amount within $1 AND surname appears as a
    whole-word in text. Date is optional — if given, must be within
    DATE_TOL_DAYS.

    CC-fee tolerance (line amount = base × 1.04) is OFF by default
    because it admits too many false positives ($280 ≈ $270 × 1.037).
    Callers explicitly opt in for col-G-vs-CSV checks where CC fees
    are common."""
    delta = abs(line['amount'] - amount)
    if delta > AMOUNT_TOL:
        if not allow_cc_fee:
            return False
        if abs(line['amount'] - amount * 1.04) > AMOUNT_TOL and \
           abs(line['amount'] / 1.04 - amount) > AMOUNT_TOL:
            return False
    if last_name and not _surname_in_text(last_name, line['text']):
        return False
    if date and line.get('date'):
        if days_apart(line['date'], date) > DATE_TOL_DAYS:
            return False
    return True

def sum_match_same_day(lines, amount, last_name, target_date=None):
    """Check if any same-day group of lines sums to approximately `amount`
    AND at least one line has the surname (word-boundary). Used for split
    posts (Johnson: 422.56 + 750 ≈ CSV $1149 — though here the SUM is
    $1172.56 not $1149, so this won't match Johnson; but it WILL match
    cases where the audit's CSV pair-grouping was right and col G has
    them split)."""
    by_day = defaultdict(list)
    for ln in lines:
        if ln.get('date'):
            by_day[ln['date']].append(ln)
    for d, group in by_day.items():
        if target_date and days_apart(d, target_date) > DATE_TOL_DAYS:
            continue
        if last_name and not any(_surname_in_text(last_name, g['text']) for g in group):
            continue
        total = round(sum(g['amount'] for g in group), 2)
        if abs(total - amount) <= AMOUNT_TOL:
            return group
    return None

# ── Loaders ─────────────────────────────────────────────────────────────────
def load_deals():
    """Returns dict: (location, tab) → list of deal rows. Each row has
    car_desc, owed, payment_notes, location, tab."""
    deals = []
    rows = sb_get('deals26',
        'select=id,car_desc,owed,payments,payment_notes,location,sold_inv_vin&limit=2000')
    for r in rows:
        cd = (r.get('car_desc') or '').strip()
        if not cd:
            continue
        deals.append({
            'tab': 'Deals26', 'location': r.get('location') or 'DeBary',
            'car_desc': cd, 'owed': float(r.get('owed') or 0),
            'payment_notes': r.get('payment_notes') or '',
            'vin': (r.get('sold_inv_vin') or '').strip().upper(),
        })
    print(f'  deals26: {len(rows)}')
    for tab in ['Deals25', 'Deals24']:
        for loc in ['DeBary', 'DeLand']:
            try:
                resp = gas_post({'action': 'read_all', 'tab': tab, 'location': loc})
                rows = (resp or {}).get('rows', [])
                for r in rows:
                    cd = (r.get('car_desc') or '').strip()
                    if not cd:
                        continue
                    deals.append({
                        'tab': tab, 'location': loc,
                        'car_desc': cd, 'owed': float(r.get('owed') or 0),
                        'payment_notes': r.get('payment_notes') or '',
                        'vin': (r.get('sold_inv_vin') or '').strip().upper(),
                    })
                print(f'  {tab} {loc}: {len(rows)}')
            except Exception as e:
                print(f'  WARN: {tab} {loc} read failed: {e}')
                time.sleep(2)
    return deals

def load_profit():
    """Returns dict: location → {label → [parsed_lines]} for April."""
    out = {'DeBary': {}, 'DeLand': {}}
    for loc in ['DeBary', 'DeLand']:
        try:
            resp = gas_post({'action': 'read_profit', 'location': loc})
        except Exception as e:
            print(f'  WARN: profit {loc} read failed: {e}')
            continue
        for m in (resp or {}).get('months', []):
            if m.get('name') != 'April':
                continue
            for it in m.get('items', []):
                lbl = it.get('label')
                if lbl in ('Payments', 'Cash Sales', 'Extras'):
                    out[loc][lbl] = parse_notes(it.get('note', '') or '')
    print(f'  Profit26: DeBary {sum(len(v) for v in out["DeBary"].values())} '
          f'lines, DeLand {sum(len(v) for v in out["DeLand"].values())} lines')
    return out

# ── Resolution checks per direction ─────────────────────────────────────────
def find_deal(rv, deals):
    """Find the deal this review targets. Strategy: VIN match first, then
    car_desc exact match within snapshot's tab+lot, then surname+location
    fallback (one matching deal only)."""
    snap = rv.get('snapshot') or {}
    vin = (rv.get('vehicle_vin') or '').strip().upper()
    if vin:
        for d in deals:
            if d.get('vin') == vin:
                return d
    cd = (snap.get('car_desc') or '').strip()
    tab = snap.get('tab') or ''
    loc = rv.get('location') or snap.get('deal_lot') or ''
    if cd and tab and loc:
        for d in deals:
            if (d['car_desc'] == cd and d['tab'] == tab and d['location'] == loc):
                return d
    # Fallback: surname + location, exactly one match
    last = last_name_from_review(rv)
    if last and loc:
        cands = [d for d in deals
                 if d['location'] == loc
                 and last in d['car_desc'].lower()]
        if len(cands) == 1:
            return cands[0]
    return None

def _phantom_line_still_present(plot, plabel, pamt, pdesc, last, profit):
    """Search for the specific phantom line: amount + (descriptor tokens
    OR surname). Returns True if the line is still on the sheet."""
    lines = profit.get(plot, {}).get(plabel, [])
    pdesc_toks = [t for t in _WORD_RE.findall((pdesc or '').lower()) if len(t) >= 3]
    for ln in lines:
        if abs(ln['amount'] - float(pamt)) > AMOUNT_TOL:
            continue
        tl = ln['text'].lower()
        # Match by description tokens (e.g. 'pilot black jasmine 4/28' →
        # tokens ['pilot','black','jasmine']; need ≥2 to match) OR by
        # whole-word surname.
        ln_toks = set(_WORD_RE.findall(tl))
        token_overlap = sum(1 for t in pdesc_toks if t in ln_toks)
        surname_match = bool(last) and _surname_in_text(last, tl)
        # Strong signal: ≥2 description tokens overlap OR surname matches
        # AND at least one descriptor token overlaps.
        if token_overlap >= 2 or (surname_match and (token_overlap >= 1 or not pdesc_toks)):
            return True
    return False

def check_phantom(rv, profit):
    """Phantom is resolved iff the offending Profit26 line is GONE.
    Identifier: snapshot.profit_lot + profit_amount + description/surname."""
    snap = rv.get('snapshot') or {}
    plot = snap.get('profit_lot')
    pamt = snap.get('profit_amount') if snap.get('profit_amount') is not None else rv.get('amount')
    pdesc = (snap.get('profit_description') or '').lower()
    plabel = snap.get('profit_label') or 'Payments'
    last = last_name_from_review(rv)
    if not plot or pamt is None:
        return None  # can't identify
    if _phantom_line_still_present(plot, plabel, pamt, pdesc, last, profit):
        return None
    return f'phantom line gone from {plot} {plabel}'

def check_wrong_lot(rv, profit):
    """Wrong-lot is resolved iff the offending line is GONE from the wrong
    (posting) lot. Identifier same as phantom: profit_lot/amount/desc."""
    snap = rv.get('snapshot') or {}
    wrong = snap.get('profit_lot')
    pamt = snap.get('profit_amount') if snap.get('profit_amount') is not None else rv.get('amount')
    pdesc = (snap.get('profit_description') or '').lower()
    plabel = snap.get('profit_label') or 'Payments'
    last = last_name_from_review(rv)
    if not wrong or pamt is None:
        return None
    if _phantom_line_still_present(wrong, plabel, pamt, pdesc, last, profit):
        return None
    return f'wrong-lot line gone from {wrong}'

def check_missing(rv, deals, profit, in_profit_required):
    """For missing_from_profit (in_profit_required=True): match against
    correct-lot Profit26 Payments OR deal's col G OR ANY deal with the
    same surname (covers the audit-picked-wrong-deal case where the
    payment landed on a different car for the same customer).
    For missing_from_col_g (in_profit_required=False): same fallthrough,
    col G only.
    Single-line match OR same-day sum match."""
    snap = rv.get('snapshot') or {}
    amt = float(rv.get('amount') or 0)
    last = last_name_from_review(rv)
    if amt <= 0 or not last:
        return None
    txns = snap.get('csv_transactions') or []
    target_date = (sorted(t.get('date','') for t in txns if t.get('date')) or [None])[0]

    # 1. Audit-targeted deal first (strongest signal)
    deal = find_deal(rv, deals)
    if deal:
        cg = parse_notes(deal['payment_notes'])
        for ln in cg:
            if line_matches(ln, amt, last, target_date, allow_cc_fee=True):
                return f'col G of audit-target {deal["tab"]} {deal["location"]} {deal["car_desc"]}: {ln["raw"]}'
        sm = sum_match_same_day(cg, amt, last, target_date)
        if sm:
            return f'col G same-day sum on audit-target {deal["car_desc"]} ({len(sm)} lines)'

    # 2. Profit26 of the deal's location, both labels (only when F>0)
    if in_profit_required and deal:
        loc = deal['location']
        for label in ('Payments', 'Cash Sales'):
            for ln in profit.get(loc, {}).get(label, []):
                if line_matches(ln, amt, last, target_date, allow_cc_fee=True):
                    return f'Profit26 {loc} {label}: {ln["raw"]}'

    # 3. Fall through: ANY deal with surname match (covers audit picking
    # wrong target — Santiago's 328xi vs 12 Accord case).
    for d in deals:
        if deal and d is deal:
            continue
        if not _surname_in_text(last, d['car_desc']):
            continue
        cg = parse_notes(d['payment_notes'])
        for ln in cg:
            if line_matches(ln, amt, last, target_date, allow_cc_fee=True):
                return f'col G of sibling {d["tab"]} {d["location"]} {d["car_desc"]}: {ln["raw"]}'
        sm = sum_match_same_day(cg, amt, last, target_date)
        if sm:
            return f'col G same-day sum on sibling {d["car_desc"]} ({len(sm)} lines)'

    # 4. Profit26 fallback for in_profit_required: ALL lots (covers cross-lot).
    if in_profit_required:
        for loc in ('DeBary', 'DeLand'):
            for label in ('Payments', 'Cash Sales'):
                for ln in profit.get(loc, {}).get(label, []):
                    if line_matches(ln, amt, last, target_date, allow_cc_fee=True):
                        return f'Profit26 {loc} {label}: {ln["raw"]}'

    return None

def check_live_flow(rv, deals, profit):
    """Live-flow reasons (multiple, no_match, partial, possible_duplicate,
    approve_first, no_vehicle, no_customer). Resolved if Profit26 OR a
    surname-matching deal's col G has the amount + surname (word-boundary)
    within $1.

    Date proximity is REQUIRED when the line has a date and the review
    has either a payment_date or a created_at (audit ran 4/28; lines
    older than 4/25 are unrelated to the queue card)."""
    amt = float(rv.get('amount') or 0)
    last = last_name_from_review(rv)
    if amt <= 0 or not last:
        return None
    # Use payment_date if present. Don't fall back to created_at — audit
    # catch-up cards have a created_at that lags the actual payment by
    # weeks, and tight date proximity would block resolution. Without a
    # payment_date, surname + amount alone must be sufficient (which is
    # safer now that surname matching is word-boundary).
    target_date = rv.get('payment_date')
    loc = rv.get('location') or ''
    # 1. Profit26 (current lot, both labels)
    if loc:
        for label in ('Payments', 'Cash Sales'):
            for ln in profit.get(loc, {}).get(label, []):
                if line_matches(ln, amt, last, date=target_date):
                    return f'Profit26 {loc} {label} has: {ln["raw"]}'
    # 2. col G of any deal with matching surname (word-boundary).
    # Avoid the previous bug where last[:4] in cd_l matched 'silv' to
    # 'Silverado' — use _surname_in_text on car_desc.
    for d in deals:
        if not _surname_in_text(last, d['car_desc']):
            continue
        cg = parse_notes(d['payment_notes'])
        for ln in cg:
            if line_matches(ln, amt, last, date=target_date):
                return f'col G of {d["tab"]} {d["location"]} {d["car_desc"]}: {ln["raw"]}'
        sm = sum_match_same_day(cg, amt, last, target_date=target_date)
        if sm:
            return f'col G same-day sum on {d["tab"]} {d["location"]} {d["car_desc"]}'
    return None

# ── Main ────────────────────────────────────────────────────────────────────
def load_deal_ids():
    """Returns dict: deal_id → voided_at (None for live deals). Used to
    detect orphan reviews (deal_id points to a row that's gone or voided
    after the review was queued)."""
    out = {}
    try:
        rows = sb_get('deals', 'select=id,voided_at&limit=2000')
        for r in rows:
            out[r.get('id')] = r.get('voided_at')
    except Exception as e:
        print(f'  WARN: deals lookup failed for orphan check: {e}')
    return out


def main():
    print(f'review_revalidate {"--apply" if APPLY else "(dry-run)"}')
    print('Loading deals…')
    deals = load_deals()
    print('Loading deals (id+voided_at) for orphan check…')
    deal_state = load_deal_ids()
    print(f'  {len(deal_state)} deal rows')
    print('Loading Profit26…')
    profit = load_profit()

    print('Loading pending reviews…')
    reviews = sb_get('payment_reviews',
        'status=eq.pending&select=id,reason,customer_name,amount,vehicle_year,'
        'vehicle_model,vehicle_vin,location,note_line,snapshot,created_at,'
        'deal_id,payment_id&order=created_at.desc&limit=500')
    print(f'  {len(reviews)} pending')

    resolved = []
    skipped = 0
    for rv in reviews:
        snap = rv.get('snapshot') or {}
        direction = snap.get('direction') or ''
        reason = rv.get('reason') or ''
        rid = rv.get('id')
        nm = (rv.get('customer_name') or '')[:25]
        amt = rv.get('amount')

        result = None
        # Orphan check (runs first, applies to ANY reason that has a
        # deal_id): if the deal got deleted or voided after this review
        # was queued, the review is stale. Mirrors the in-app
        # _reviewAutoStale orphan path so the queue stays clean even
        # when the cron is running and the user isn't on the Review tab.
        # Skip when deal_state lookup failed to avoid auto-resolving
        # everything on a transient API error.
        if rv.get('deal_id') and deal_state:
            did = rv['deal_id']
            if did not in deal_state:
                result = f'orphan: deal_id={did} no longer exists'
            elif deal_state.get(did):
                result = f'orphan: deal_id={did} voided at {deal_state[did]}'

        # Direction-first dispatch: many `multiple` and `no_match` reviews
        # historically had snapshot.direction set by the audit (the audit
        # used to inherit the live-flow row's reason instead of overwriting
        # it to csv_reconciliation). Direction is the authoritative
        # classifier — use it whenever set.
        if not result and direction == 'phantom_in_sheet':
            result = check_phantom(rv, profit)
        elif not result and direction == 'wrong_lot':
            result = check_wrong_lot(rv, profit)
        elif not result and direction == 'missing_from_profit':
            result = check_missing(rv, deals, profit, in_profit_required=True)
        elif not result and direction == 'missing_from_col_g':
            result = check_missing(rv, deals, profit, in_profit_required=False)
        elif not result and reason in ('multiple', 'no_match', 'partial',
                        'possible_duplicate', 'approve_first',
                        'no_vehicle', 'no_customer'):
            result = check_live_flow(rv, deals, profit)
        # deal_pending / cash_sale_* / inv_* are left to the in-app
        # validator (they need stronger signals like sold_inv_vin presence
        # in deals26) — except for the orphan path above, which the cron
        # handles regardless of reason.

        if result:
            resolved.append((rid, nm, amt, reason, direction, result))
            if VERBOSE:
                print(f'  RESOLVE {rid} {nm:25s} ${amt} {reason:25s} '
                      f'{direction or "-":20s} ← {result}')
        else:
            skipped += 1
            if VERBOSE:
                print(f'  keep    {rid} {nm:25s} ${amt} {reason:25s} '
                      f'{direction or "-":20s}')

    print()
    print(f'Resolvable: {len(resolved)} / Keep: {skipped}')
    if not resolved:
        return 0

    print()
    for rid, nm, amt, reason, direction, why in resolved:
        print(f'  {rid:5d} {nm:25s} ${amt:>8} {reason:22s} {direction:22s} ← {why}')

    if not APPLY:
        print()
        print('Dry-run only. Re-run with --apply to PATCH status=auto_resolved.')
        return 0

    print()
    print('Applying…')
    ok = err = 0
    for rid, nm, amt, reason, direction, why in resolved:
        try:
            rv = next((r for r in reviews if r.get('id') == rid), None)
            new_snap = {**(rv.get('snapshot') or {}),
                        'auto_resolved': True,
                        'auto_resolved_at': datetime.now().isoformat(),
                        'auto_resolved_reason': why}
            sb_patch('payment_reviews', rid, {
                'status': 'auto_resolved',
                'snapshot': new_snap,
            })
            ok += 1
        except Exception as e:
            err += 1
            print(f'  ERR id={rid}: {e}')
    print(f'Done. ok={ok} err={err}')
    return 0 if err == 0 else 1

if __name__ == '__main__':
    sys.exit(main())
