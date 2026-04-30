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


def cash_sale_tokens(deal, car_desc):
    """Year (yShort + yFull), first model word, lowercase lastname."""
    cust = (deal.get('customer_name') or '').strip().split()
    last = (cust[-1] if cust else '').lower()

    year = ''
    model_first = ''
    vd = (deal.get('vehicle_desc') or '').strip().split()
    if vd and re.match(r'^(19|20)\d{2}$', vd[0]):
        year = vd[0]
        model_tok = ' '.join(vd[2:]) if len(vd) >= 3 else (vd[1] if len(vd) > 1 else '')
        model_first = (model_tok.split() or [''])[0].lower()
    elif car_desc:
        cd = car_desc.strip().split()
        if cd and re.match(r'^\d{2}$', cd[0]):
            year = '20' + cd[0]
        if len(cd) > 1:
            model_first = cd[1].lower()

    return {
        'y_short': year[-2:] if year else '',
        'y_full': year,
        'model': model_first,
        'last': last,
    }


def find_posted_note(note, tokens):
    """Token-match the note against the deal. Returns {amount, desc} or None.

    Rule: lastname AND (y_short OR y_full) must appear in the line. If
    model is non-empty, it must appear too. Mirrors the JS implementation
    so the server queue matches the in-app queue."""
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
        if tokens['model'] and tokens['model'] not in ll:
            continue
        m = _AMT_RE.match(line)
        if m:
            return {'amount': float(m.group(1)), 'desc': (m.group(2) or '').strip()}
    return None


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


def queue_correction(deal, owed, posted, car_desc):
    """Queue a cash_sale_correction review with the snapshot fields the
    in-app approve handler reads."""
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
        'reason': 'cash_sale_correction',
        'candidates': '[]',
        'status': 'pending',
        'created_at': datetime.now().isoformat(),
        'snapshot': {
            'posted_amount': posted.get('amount'),
            'posted_desc': posted.get('desc') or '',
            'queued_by': 'profit_sweep.py',
            'queued_at': datetime.now().isoformat(),
        },
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

    # 1. Pull cash deals (active + non-voided, has VIN)
    deals = sb_get(
        'deals',
        'deal_type=eq.cash&voided_at=is.null'
        '&select=id,customer_name,vehicle_desc,vin,location,'
        'created_at,deal_type,color&order=created_at.desc&limit=500'
    )
    deals = [d for d in (deals or []) if d.get('vin')]
    print(f'  {len(deals)} cash deals')

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

    # 3. Profit26 Cash Sales mirror cache (per location + month)
    profit_cache = {}

    def get_profit_note(loc, month_idx):
        key = f'{loc}|{month_idx}'
        if key in profit_cache:
            return profit_cache[key]
        try:
            rows = sb_get(
                'profit',
                f'location=eq.{urllib.parse.quote(loc)}'
                f'&month_idx=eq.{month_idx}'
                f'&label=eq.{urllib.parse.quote("Cash Sales")}'
                '&select=note&limit=5'
            )
        except Exception as e:
            print(f'  WARN profit fetch {loc} m={month_idx}: {e}')
            rows = []
        # Concatenate all matching rows' notes (usually 1 row per cell).
        note = '\n'.join((r.get('note') or '') for r in rows)
        profit_cache[key] = note
        return note

    queued_correction = 0
    queued_pending = 0
    skipped_already_queued = 0
    skipped_already_correct = 0
    skipped_not_eligible = 0

    for deal in deals:
        vin = deal['vin']
        d26 = d26_by_vin.get(vin)
        if not d26 or not d26.get('car_desc'):
            skipped_not_eligible += 1
            continue
        taxes = float(d26.get('taxes') or 0)
        owed = float(d26.get('owed') or 0)
        # Only sweep deals where math is known + profit is positive
        if taxes <= 0 or owed <= 0:
            skipped_not_eligible += 1
            continue

        # Skip if already queued (any reason).
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

        note = get_profit_note(loc, month_idx)
        tokens = cash_sale_tokens(deal, d26.get('car_desc'))
        posted = find_posted_note(note, tokens)
        car_desc = d26.get('car_desc') or ''

        if posted:
            if abs((posted.get('amount') or 0) - owed) < 1.0:
                skipped_already_correct += 1
                continue
            print(
                f'  CORRECT  {car_desc[:35]:35} '
                f'posted=${posted.get("amount")} owed=${owed}'
            )
            if APPLY:
                queue_correction(deal, owed, posted, car_desc)
            queued_correction += 1
        else:
            print(
                f'  PENDING  {car_desc[:35]:35} owed=${owed} (no Profit26 line)'
            )
            if APPLY:
                queue_pending(deal, owed, car_desc)
            queued_pending += 1

    print()
    print(f'Cash deals:                 {len(deals)}')
    print(f'  in deals26 + math known:  {len(deals) - skipped_not_eligible}')
    print(f'  already queued elsewhere: {skipped_already_queued}')
    print(f'  posted correctly:         {skipped_already_correct}')
    print(f'  cash_sale_correction:     {queued_correction}')
    print(f'  cash_sale_pending:        {queued_pending}')

    if not APPLY and (queued_correction or queued_pending):
        print()
        print('Dry-run only. Re-run with --apply to insert reviews.')

    return 0


if __name__ == '__main__':
    sys.exit(main())
