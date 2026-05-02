#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
profit_sweep.py — server-side mirror of the in-app
_sweepUnpostedCashSales loop.

Why this exists: the browser-side sweep only runs when Vlad has the
PWA open, on a 30-min interval. When he edits a deals26 row directly
in the Google Sheet (adds a missed expense, fixes a tax, etc.), the
row's `owed` recomputes BUT any previously-posted Profit26 Cash Sales
line stays at the old amount. The in-app sweep eventually catches the
drift and queues a cash_sale_correction review, but only if Vlad
reopens the app.

This script runs on a 30-min GitHub Actions cron and queues the same
correction reviews whether or not the app is open. Idempotent: skips
deals that already have a pending review.

Logic per cash deal (deal_type='cash', not voided, has VIN):
  1. Pull deals26 row, taxes>0, owed>0.
  2. Pull Profit26 Cash Sales note for the deal's location + month.
  3. Token-match (year + model + lastname) against note lines.
  4. Three outcomes:
       - Match found within $1 of owed       → already correct, skip
       - Match found but amount differs > $1 → queue cash_sale_correction
       - No match                            → queue cash_sale_pending

Usage:
  python scripts/profit_sweep.py            # dry-run
  python scripts/profit_sweep.py --apply    # actually queue reviews
"""
import json
import os
import re
import sys
import urllib.parse
import urllib.request
from datetime import datetime

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

APPLY = '--apply' in sys.argv
VERBOSE = '--verbose' in sys.argv or '-v' in sys.argv


# ── HTTP helpers ────────────────────────────────────────────────────────────
def sb_get(table, params=''):
    url = f'{SB_URL}/rest/v1/{table}?{params}'
    req = urllib.request.Request(url, headers=SB_HDR)
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


def sb_post(table, body):
    url = f'{SB_URL}/rest/v1/{table}'
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        url, data=data, method='POST',
        headers={**SB_HDR, 'Content-Type': 'application/json',
                 'Prefer': 'return=representation'},
    )
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read())


# ── Token-based posted-line matcher (mirrors _findPostedNoteForTokens) ──────
_AMT_RE = re.compile(r'^(-?\d+(?:\.\d+)?)\s*(.*)$')


_COLORS = {'white','black','gray','grey','silver','red','blue','green','yellow',
           'orange','purple','brown','gold','beige','tan','maroon'}


def cash_sale_tokens(deal, car_desc):
    """Year, ALL model words (alphanum-normalized), lowercase lastname.

    Profit26 note lines mirror d26.car_desc format (e.g. "08 CRV grey 217k
    2 Gonzalez"). vehicle_desc gives "2008 Honda CR-V" — its model token
    'cr-v' won't substring-match the line's 'crv'. So we prefer car_desc
    and only fall back to vehicle_desc when car_desc is empty/incomplete.

    Captures every non-color, non-numeric model word so idempotency /
    posted-line matching survives descriptor drift between posts of the
    same deal — caught a Caravan double-post where the older line had
    only "caravan" but the new car_desc started with "grand". Any of the
    model words appearing in a line is enough; surname + year already
    keeps the filter tight.
    """
    cust = (deal.get('customer_name') or '').strip().split()
    last = (cust[-1] if cust else '').lower()

    year = ''
    model_words = []
    if car_desc:
        cd = car_desc.strip().split()
        if cd and re.match(r'^\d{2}$', cd[0]):
            year = '20' + cd[0]
        for tok in cd[1:]:
            t = tok.lower()
            if not t:
                continue
            if re.match(r'^\d', t):
                break  # miles like "197k" or trailing deal_num — stop
            if t in _COLORS:
                continue
            model_words.append(t)
    if not year or not model_words:
        vd = (deal.get('vehicle_desc') or '').strip().split()
        if vd and re.match(r'^(19|20)\d{2}$', vd[0]):
            if not year:
                year = vd[0]
            if not model_words:
                # vehicle_desc form: "2016 Volkswagen Jetta" → keep
                # "Jetta" only (skip the make at vd[1]). For multi-word
                # models like "Grand Caravan" both words land here.
                for tok in vd[2:]:
                    t = tok.lower()
                    if not t:
                        continue
                    if re.match(r'^\d', t):
                        break
                    if t in _COLORS:
                        continue
                    model_words.append(t)

    model_first = model_words[0] if model_words else ''
    model_norm_words = [re.sub(r'[^a-z0-9]', '', w) for w in model_words]
    model_norm_words = [w for w in model_norm_words if w]
    return {
        'y_short': year[-2:] if year else '',
        'y_full': year,
        'model': model_first,
        'model_norm': model_norm_words[0] if model_norm_words else '',
        'model_words': model_words,
        'model_norm_words': model_norm_words,
        'last': last,
    }


def find_posted_note(note, tokens):
    """Token-match the note against the deal. Returns the FIRST matching
    line as {amount, desc} or None. Used by the cash-sale path where we
    expect at most one Profit26 line per deal."""
    if not tokens['last'] or not (tokens['y_short'] or tokens['y_full']):
        return None
    for raw_line in (note or '').split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        ll = line.lower()
        if tokens['last'] not in ll:
            continue
        has_year = (
            (tokens['y_short'] and tokens['y_short'] in ll) or
            (tokens['y_full'] and tokens['y_full'] in ll)
        )
        if not has_year:
            continue
        words = tokens.get('model_norm_words') or []
        if words:
            # Any-of-words match against alphanum-normalized line. Mirrors
            # JS _findPostedNoteForTokens so JS + Python sweeps agree.
            ll_norm = re.sub(r'[^a-z0-9]', '', ll)
            if not any(w and w in ll_norm for w in words):
                continue
        m = _AMT_RE.match(line)
        if m:
            return {'amount': float(m.group(1)), 'desc': (m.group(2) or '').strip()}
    return None


def find_all_posted_notes(note, tokens):
    """Token-match — return EVERY matching line as a list of
    {amount, desc}. Used by the finance-deal path where Profit26
    Payments can carry multiple lines for the same deal (one per
    ongoing payment that crossed the threshold). Caller sums the
    amounts and compares to deals26.owed for drift detection."""
    out = []
    if not tokens['last'] or not (tokens['y_short'] or tokens['y_full']):
        return out
    for raw_line in (note or '').split('\n'):
        line = raw_line.strip()
        if not line:
            continue
        ll = line.lower()
        if tokens['last'] not in ll:
            continue
        has_year = (
            (tokens['y_short'] and tokens['y_short'] in ll) or
            (tokens['y_full'] and tokens['y_full'] in ll)
        )
        if not has_year:
            continue
        words = tokens.get('model_norm_words') or []
        if words:
            # Any-of-words match against alphanum-normalized line. Mirrors
            # JS _findPostedNoteForTokens so JS + Python sweeps agree.
            ll_norm = re.sub(r'[^a-z0-9]', '', ll)
            if not any(w and w in ll_norm for w in words):
                continue
        m = _AMT_RE.match(line)
        if m:
            out.append({'amount': float(m.group(1)), 'desc': (m.group(2) or '').strip()})
    return out


# ── Queue helpers ───────────────────────────────────────────────────────────
def already_queued(deal_id):
    """Skip if any pending review for this deal exists. Mirrors the
    in-app sweep's alreadyQueued check — keeps the queue idempotent
    across overlapping runs (in-app + cron + tax-fill)."""
    try:
        rows = sb_get(
            'payment_reviews',
            f'deal_id=eq.{deal_id}&status=eq.pending&select=id&limit=1',
        )
        return bool(rows)
    except Exception:
        return True  # fail-safe: if we can't tell, don't dupe-queue


def queue_correction(deal, owed, posted, car_desc, row_type='cash_sales'):
    """Queue a cash_sale_correction review with the snapshot fields the
    in-app approve handler reads. row_type='cash_sales' (default) targets
    Profit26 Cash Sales; row_type='payments' targets Profit26 Payments
    (used for finance deals with one identifiable mismatched line).

    For multi-line finance drift (sum mismatch), `posted` is the
    representative first line and `posted_total` in the snapshot carries
    the actual sum so the approve handler / Vlad can see the full
    picture."""
    snap = {
        'posted_amount': posted.get('amount'),
        'posted_desc': posted.get('desc') or '',
        'row_type': row_type,
        'deal_type': deal.get('deal_type') or 'cash',
        'queued_by': 'profit_sweep.py',
        'queued_at': datetime.now().isoformat(),
    }
    if 'posted_total' in posted:
        snap['posted_total'] = posted['posted_total']
        snap['matched_line_count'] = posted.get('matched_line_count', 1)
    body = {
        'payment_id': None,
        'deal_id': deal['id'],
        'customer_name': deal.get('customer_name') or '',
        'amount': round(owed, 2),
        'vehicle_year': '',
        'vehicle_make': '',
        'vehicle_model': '',
        'vehicle_color': deal.get('color') or '',
        'vehicle_vin': deal.get('vin') or '',
        'location': deal.get('location') or 'DeBary',
        'payment_date': (deal.get('created_at') or
                         datetime.now().isoformat())[:10],
        'payment_method': deal.get('deal_type') or 'cash',
        'note_line': car_desc or '',
        'reason': 'cash_sale_correction',
        'candidates': '[]',
        'status': 'pending',
        'created_at': datetime.now().isoformat(),
        'snapshot': snap,
    }
    return sb_post('payment_reviews', body)


def queue_pending(deal, owed, car_desc):
    """Queue a cash_sale_pending review for a cash deal that's never
    been posted to Profit26. Mirrors _queueCashSaleReview() shape."""
    body = {
        'payment_id': None,
        'deal_id': deal['id'],
        'customer_name': deal.get('customer_name') or '',
        'amount': round(owed, 2),
        'vehicle_year': '',
        'vehicle_make': '',
        'vehicle_model': '',
        'vehicle_color': deal.get('color') or '',
        'vehicle_vin': deal.get('vin') or '',
        'location': deal.get('location') or 'DeBary',
        'payment_date': (deal.get('created_at') or
                         datetime.now().isoformat())[:10],
        'payment_method': 'cash',
        'note_line': car_desc or '',
        'reason': 'cash_sale_pending',
        'candidates': '[]',
        'status': 'pending',
        'created_at': datetime.now().isoformat(),
        'snapshot': {
            'queued_by': 'profit_sweep.py',
            'queued_at': datetime.now().isoformat(),
        },
    }
    return sb_post('payment_reviews', body)


# ── Main sweep ──────────────────────────────────────────────────────────────
def main():
    print(f'profit_sweep {"--apply" if APPLY else "(dry-run)"}')

    # 1. Pull active deals (cash + finance, non-voided, has VIN). The
    #    sweep handles both — cash deals post a single Profit26 Cash
    #    Sales line; finance deals post 1+ Profit26 Payments lines as
    #    ongoing payments cross threshold.
    deals = sb_get(
        'deals',
        'deal_type=in.(cash,finance)&voided_at=is.null'
        '&select=id,customer_name,vehicle_desc,vin,location,'
        'created_at,deal_type,color&order=created_at.desc&limit=500'
    )
    deals = [d for d in (deals or []) if d.get('vin')]
    cash_n = sum(1 for d in deals if d.get('deal_type') == 'cash')
    fin_n = sum(1 for d in deals if d.get('deal_type') == 'finance')
    print(f'  {len(deals)} deals  (cash={cash_n} finance={fin_n})')

    # 2. Pull deals26 rows by VIN — need taxes + owed + sort_order
    vin_list = [d['vin'] for d in deals]
    if not vin_list:
        print('Nothing to sweep.')
        return 0
    inlist = '(' + ','.join(f'"{v}"' for v in vin_list) + ')'
    d26_rows = sb_get(
        'deals26',
        f'sold_inv_vin=in.{urllib.parse.quote(inlist)}'
        '&select=id,sort_order,sold_inv_vin,car_desc,owed,taxes,location'
    )
    d26_by_vin = {r.get('sold_inv_vin', '').strip(): r for r in (d26_rows or [])
                  if r.get('sold_inv_vin')}
    print(f'  {len(d26_by_vin)} matching deals26 rows')

    # 3. Profit26 mirror cache (per location + month + label).
    profit_cache = {}

    def get_profit_note(loc, month_idx, label):
        key = f'{loc}|{month_idx}|{label}'
        if key in profit_cache:
            return profit_cache[key]
        try:
            rows = sb_get(
                'profit',
                f'location=eq.{urllib.parse.quote(loc)}'
                f'&month_idx=eq.{month_idx}'
                f'&label=eq.{urllib.parse.quote(label)}'
                '&select=note&limit=5'
            )
        except Exception as e:
            print(f'  WARN profit fetch {loc} m={month_idx} {label}: {e}')
            rows = []
        note = '\n'.join((r.get('note') or '') for r in rows)
        profit_cache[key] = note
        return note

    queued_correction_cash = 0
    queued_correction_fin = 0
    queued_pending = 0
    skipped_already_queued = 0
    skipped_already_correct = 0
    skipped_not_eligible = 0

    for deal in deals:
        vin = deal['vin']
        deal_type = deal.get('deal_type') or 'cash'
        d26 = d26_by_vin.get(vin)
        if not d26 or not d26.get('car_desc'):
            skipped_not_eligible += 1
            continue
        taxes = float(d26.get('taxes') or 0)
        owed = float(d26.get('owed') or 0)
        # Need taxes filled and positive owed (= profit) to sweep a deal.
        # Finance deals with owed<=0 still in pre-profit territory: their
        # ongoing payments populate col G, no Profit26 mismatch to chase.
        if taxes <= 0 or owed <= 0:
            skipped_not_eligible += 1
            continue

        if already_queued(deal['id']):
            skipped_already_queued += 1
            continue

        loc = d26.get('location') or deal.get('location') or 'DeBary'
        try:
            sale_dt = datetime.fromisoformat(
                (deal.get('created_at') or '').replace('Z', '+00:00')
            )
            month_idx = sale_dt.month - 1
        except Exception:
            month_idx = datetime.now().month - 1

        tokens = cash_sale_tokens(deal, d26.get('car_desc'))
        car_desc = d26.get('car_desc') or ''

        # ── Cash deal: one Profit26 Cash Sales line per deal ──────────
        if deal_type == 'cash':
            note = get_profit_note(loc, month_idx, 'Cash Sales')
            posted = find_posted_note(note, tokens)
            if posted:
                if abs((posted.get('amount') or 0) - owed) < 1.0:
                    skipped_already_correct += 1
                    continue
                print(
                    f'  CASH-CORR  {car_desc[:35]:35} '
                    f'posted=${posted.get("amount")} owed=${owed}'
                )
                if APPLY:
                    queue_correction(deal, owed, posted, car_desc, row_type='cash_sales')
                queued_correction_cash += 1
            else:
                print(
                    f'  CASH-PEND  {car_desc[:35]:35} owed=${owed} (no Profit26 line)'
                )
                if APPLY:
                    queue_pending(deal, owed, car_desc)
                queued_pending += 1
            continue

        # ── Finance deal: 1+ Profit26 Payments lines per deal ─────────
        # For finance deals, the down-payment-alone-exceeds-cost case is
        # rare but real (Civic Yellow's pre-tax state was an example).
        # More common: ongoing payments cross threshold, each producing
        # its own Profit26 Payments line. The SUM of those lines should
        # equal the deal's current owed.
        #
        # If the sum mismatches owed by > $1, queue a correction so Vlad
        # can decide. We do NOT auto-rebucket per the project's
        # don't-retroactively-move-col-G-to-Profit26 rule; this only
        # surfaces the drift.
        note_pay = get_profit_note(loc, month_idx, 'Payments')
        matches = find_all_posted_notes(note_pay, tokens)
        actual_total = round(sum(m['amount'] for m in matches), 2)

        if not matches:
            # No Profit26 Payments line yet for this finance deal. The
            # in-app deal-pending approve queues a cash_sale_pending,
            # which posts to Cash Sales — that's correct for finance
            # deals where the down covered all costs (one entry, not
            # ongoing). Skip here to avoid duplicating that path.
            skipped_not_eligible += 1
            continue

        if abs(actual_total - owed) < 1.0:
            skipped_already_correct += 1
            continue

        # Build a "representative" posted dict with the first line for
        # the snapshot, plus the sum so the approve UI sees the whole
        # picture.
        first = matches[0]
        rep = {
            'amount': first['amount'],
            'desc': first['desc'],
            'posted_total': actual_total,
            'matched_line_count': len(matches),
        }
        print(
            f'  FIN-CORR   {car_desc[:35]:35} '
            f'posted_sum=${actual_total} (lines={len(matches)}) owed=${owed}'
        )
        if APPLY:
            queue_correction(deal, owed, rep, car_desc, row_type='payments')
        queued_correction_fin += 1

    print()
    print(f'Deals scanned:              {len(deals)}')
    print(f'  not eligible (math/post): {skipped_not_eligible}')
    print(f'  already queued elsewhere: {skipped_already_queued}')
    print(f'  posted correctly:         {skipped_already_correct}')
    print(f'  cash_sale_correction (cash):       {queued_correction_cash}')
    print(f'  cash_sale_correction (finance):    {queued_correction_fin}')
    print(f'  cash_sale_pending (cash, missing): {queued_pending}')

    if not APPLY and (queued_correction_cash or queued_correction_fin or queued_pending):
        print()
        print('Dry-run only. Re-run with --apply to insert reviews.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
