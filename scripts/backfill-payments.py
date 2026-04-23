#!/usr/bin/env python3
"""
Server-side payment backfill — replays payments from the Supabase `payments`
table through the v59 Apps Script matcher with `check_dup: true` so existing
notes aren't double-posted. Confident matches auto-post to Deals26 col G
(and Profit26 if owed > 0). Ambiguous / no-match cases are queued to
`payment_reviews` with status=pending for Vlad to approve in the app.

Rules replicated from index.html:
  - _profitShouldPropagate: skip raw_ocr_text prefixed with "Deal — " / "Deposit — "
  - _paymentLastNames: 2-surname Hispanic handling (before the comma, else last 2 tokens)
  - _paymentNoteLine / _paymentFormatPieces (v545): include 2-digit year,
    fit to 26 chars, drop order color → year → model reduced → lastname trunc
  - _findDealAlias: VIN first, then lastname+model+location
  - check_dup: true on all matcher calls so re-runs are safe

Usage:
    python scripts/backfill-payments.py            # live
    python scripts/backfill-payments.py --dry-run  # no writes
"""

import json
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

SHEETS_URL = 'https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec'
SHEETS_SECRET = 'cf-sync-2026'
SUPABASE_URL = 'https://hphlouzqlimainczuqyc.supabase.co'
SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo'

PAY_NOTE_MAX = 26
THROTTLE_MS = 150

DRY_RUN = '--dry-run' in sys.argv
LIMIT = None
for a in sys.argv:
    if a.startswith('--limit='):
        LIMIT = int(a.split('=', 1)[1])
CTX = ssl.create_default_context()


# ── Supabase ────────────────────────────────────────────────────────────────

def sb_get(path, params=''):
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    if params:
        url += ('&' if '?' in url else '?') + params
    req = urllib.request.Request(url, headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
    })
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read())


def sb_post(path, body):
    if DRY_RUN:
        return [{'id': 0, 'dry_run': True}]
    url = f'{SUPABASE_URL}/rest/v1/{path}'
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={
        'apikey': SUPABASE_KEY,
        'Authorization': f'Bearer {SUPABASE_KEY}',
        'Content-Type': 'application/json',
        'Prefer': 'return=representation',
    }, method='POST')
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read())


def gs_post(body):
    if DRY_RUN:
        return {'ok': True, 'status': 'dry_run'}
    body = dict(body)
    body['secret'] = SHEETS_SECRET
    req = urllib.request.Request(SHEETS_URL, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
        return json.loads(r.read())


# ── Payment helpers (ported from index.html) ────────────────────────────────

def profit_should_propagate(p):
    if not p:
        return False
    raw = p.get('raw_ocr_text') or ''
    if raw.startswith('Deal \u2014 '):
        return False
    if raw.startswith('Deposit \u2014 '):
        return False
    return True


def payment_last_names(customer_name):
    if not customer_name:
        return []
    s = str(customer_name).strip()
    if not s:
        return []
    if ',' in s:
        raw = s.split(',', 1)[0].strip()
        parts = [t for t in raw.split() if t]
        return [t.lower() for t in parts]
    parts = [t for t in s.split() if t]
    if not parts:
        return []
    if len(parts) == 1:
        return [parts[0].lower()]
    if len(parts) == 2:
        return [parts[1].lower()]
    return [parts[-2].lower(), parts[-1].lower()]


def payment_last_name(customer_name):
    a = payment_last_names(customer_name)
    return a[-1] if a else ''


def two_digit_year(y):
    if not y:
        return ''
    s = str(y).strip()
    if len(s) == 4:
        return s[2:]
    if len(s) == 2:
        return s
    if s.isdigit():
        return s[-2:]
    return ''


def format_date_md(date_str):
    if not date_str:
        return ''
    try:
        # Expect YYYY-MM-DD
        y, m, d = date_str.split('-')
        return f'{int(m)}/{int(d)}'
    except Exception:
        return ''


def format_pieces(payload):
    model = (payload.get('vehicle_model') or '').strip()
    color = (payload.get('vehicle_color') or '').strip().lower()
    last = payment_last_name(payload.get('customer_name') or '').lower()
    year = two_digit_year(payload.get('vehicle_year'))
    date_str = format_date_md(payload.get('payment_date'))
    return {'year': year, 'model': model, 'color': color, 'last': last, 'date': date_str}


def fit_core(*parts):
    return ' '.join([p for p in parts if p])


def payment_note_line(amount, payload):
    amt = float(amount) if amount is not None else 0.0
    amt_str = f'-{int(abs(amt))}' if amt < 0 else f'{int(amt)}' if amt == int(amt) else ('-' + str(abs(amt)) if amt < 0 else str(amt))
    if amt == int(amt):
        amt_str = str(int(amt)) if amt >= 0 else ('-' + str(int(abs(amt))))
    pieces = format_pieces(payload)
    date = pieces['date']
    reserved = len(amt_str) + (1 + len(date) if date else 0)
    core_budget = PAY_NOTE_MAX - reserved - (1 if amt_str else 0)
    if core_budget < 3:
        return (amt_str + (' ' + date if date else '')).strip()
    year = pieces['year']
    model = pieces['model']
    color = pieces['color']
    last = pieces['last']
    # Step 1: everything
    core = fit_core(year, model, color, last)
    # Step 2: drop color
    if len(core) > core_budget:
        core = fit_core(year, model, '', last)
    # Step 3: drop year
    if len(core) > core_budget:
        core = fit_core('', model, '', last)
    # Step 4: reduce model to first token
    if len(core) > core_budget:
        model_short = model.split()[0] if model else ''
        core = fit_core('', model_short, '', last)
        if len(core) > core_budget:
            max_last = core_budget - len(model_short) - (1 if model_short else 0)
            if max_last < 1:
                core = model_short[:core_budget]
            else:
                core = (model_short + (' ' if model_short else '') + last[:max_last]).strip()
    out = []
    if amt_str:
        out.append(amt_str)
    if core:
        out.append(core)
    if date:
        out.append(date)
    return ' '.join(out)


def payment_desc_from_payload(payload):
    amt = float(payload.get('amount') or 0)
    line = payment_note_line(amt, payload)
    amt_str = str(int(amt)) if amt == int(amt) else str(amt)
    prefix = amt_str + ' '
    if line.startswith(prefix):
        return line[len(prefix):]
    return line


def queue_review(payload, reason, candidates, note_line):
    row = {
        'payment_id': payload.get('id') or None,
        'customer_name': payload.get('customer_name') or '',
        'amount': parse_amount(payload.get('amount')),
        'vehicle_year': str(payload.get('vehicle_year') or ''),
        'vehicle_make': payload.get('vehicle_make') or '',
        'vehicle_model': payload.get('vehicle_model') or '',
        'vehicle_color': payload.get('vehicle_color') or '',
        'vehicle_vin': payload.get('vehicle_vin') or '',
        'location': payload.get('location') or 'DeBary',
        'payment_date': payload.get('payment_date') or None,
        'payment_method': payload.get('payment_method') or '',
        'note_line': note_line,
        'reason': reason,
        'candidates': json.dumps(candidates or []),
        'status': 'pending',
    }
    sb_post('payment_reviews', row)


# ── Alias lookup ────────────────────────────────────────────────────────────

def find_alias(payload):
    vin = (payload.get('vehicle_vin') or '').strip().upper()
    loc = payload.get('location') or 'DeBary'
    if vin:
        rows = sb_get('payment_deal_aliases',
                      f'vin=eq.{urllib.parse.quote(vin)}&location=eq.{urllib.parse.quote(loc)}&order=created_at.desc&limit=1&select=target_tab,target_row,car_desc')
        if rows:
            return rows[0]
    # Fall back to lastname + model + location
    last = payment_last_name(payload.get('customer_name'))
    model = (payload.get('vehicle_model') or '').strip().lower()
    if last and model:
        rows = sb_get('payment_deal_aliases',
                      f'customer_name_lower=eq.{urllib.parse.quote(last)}&vehicle_model_lower=eq.{urllib.parse.quote(model)}&location=eq.{urllib.parse.quote(loc)}&order=created_at.desc&limit=1&select=target_tab,target_row,car_desc')
        if rows:
            return rows[0]
    return None


def save_alias(payload, matched):
    row = {
        'vin': ((payload.get('vehicle_vin') or '').strip().upper()) or None,
        'customer_name_lower': payment_last_name(payload.get('customer_name')) or None,
        'vehicle_model_lower': (payload.get('vehicle_model') or '').strip().lower() or None,
        'location': matched.get('location') or payload.get('location') or 'DeBary',
        'target_tab': matched.get('tab'),
        'target_row': matched.get('row'),
        'car_desc': matched.get('car_desc'),
        'created_by': 'backfill-v59',
        'source_review_id': None,
    }
    try:
        sb_post('payment_deal_aliases', row)
    except Exception as e:
        print(f'  alias save failed: {e}')


# ── Main per-payment flow (mirror of _appendPaymentToDeals26Checked) ────────

def parse_amount(v):
    if v is None:
        return 0.0
    s = str(v).strip()
    s = s.replace('$', '').replace(',', '')
    try:
        return float(s) if s else 0.0
    except ValueError:
        return 0.0


def process_payment(p):
    if not profit_should_propagate(p):
        return {'skipped': 'filter'}
    amt = parse_amount(p.get('amount'))
    p = dict(p, amount=amt)  # normalize for downstream helpers
    if amt == 0:
        return {'skipped': 'zero'}
    last = payment_last_name(p.get('customer_name'))
    model = (p.get('vehicle_model') or '').strip()
    if not last or not model:
        return {'skipped': 'no_name_or_model'}
    loc = p.get('location') or 'DeBary'
    note_line = payment_note_line(amt, p)

    # Alias short-circuit
    alias = find_alias(p)
    if alias:
        resp = gs_post({
            'action': 'deals26_append_payment_direct',
            'location': loc,
            'data': {
                'tab': alias['target_tab'],
                'row': alias['target_row'],
                'amount': amt,
                'note_line': note_line,
                'last_names': payment_last_names(p.get('customer_name')),
                'check_dup': True,
            },
        })
        if resp.get('ok') is False:
            return {'error': resp.get('error') or 'alias_post_failed'}
        st = resp.get('status')
        if st == 'already_posted':
            return {'skipped': 'already_posted_alias'}
        if st == 'possible_duplicate':
            queue_review(p, 'possible_duplicate', [{'tab': alias['target_tab'],
                                                   'row': alias['target_row'],
                                                   'car_desc': alias.get('car_desc', '')}],
                         note_line)
            return {'queued': 'possible_duplicate'}
        # Posted via alias — profit gate
        owed = float(resp.get('owed') or 0)
        if owed > 0:
            try:
                _post_to_profit(p, amt)
            except Exception as e:
                print(f'  profit append failed: {e}')
        return {'posted_alias': True}

    # Run matcher
    resp = gs_post({
        'action': 'deals26_append_payment',
        'location': loc,
        'data': {
            'last_name': last,
            'last_names': payment_last_names(p.get('customer_name')),
            'year': str(p.get('vehicle_year') or '').strip(),
            'make': (p.get('vehicle_make') or '').strip(),
            'model': model,
            'color': (p.get('vehicle_color') or '').strip(),
            'amount': amt,
            'note_line': note_line,
            'check_dup': True,
        },
    })
    if resp.get('ok') is False:
        return {'error': resp.get('error') or 'matcher_failed'}
    st = resp.get('status')

    if st == 'matched':
        # Post to Profit26 if owed > 0
        owed = float(resp.get('owed') or 0)
        if owed > 0:
            matched_loc = resp.get('location') or loc
            try:
                _post_to_profit(dict(p, location=matched_loc), amt)
            except Exception as e:
                print(f'  profit append failed: {e}')
        # Save alias
        try:
            save_alias(p, {
                'location': resp.get('location') or loc,
                'tab': resp.get('tab'),
                'row': resp.get('row'),
                'car_desc': resp.get('car_desc'),
            })
        except Exception:
            pass
        return {'posted': True, 'tab': resp.get('tab'), 'row': resp.get('row')}

    if st == 'already_posted':
        return {'skipped': 'already_posted'}
    if st == 'possible_duplicate':
        queue_review(p, 'possible_duplicate', resp.get('candidates') or [], note_line)
        return {'queued': 'possible_duplicate'}
    if st in ('multiple', 'partial', 'no_match'):
        queue_review(p, st, resp.get('candidates') or [], note_line)
        return {'queued': st}
    return {'error': f'unknown_status:{st}'}


def _post_to_profit(payload, amt):
    # Month from payment_date
    date_str = payload.get('payment_date') or ''
    if date_str:
        m = int(date_str.split('-')[1])
    else:
        from datetime import datetime
        m = datetime.now().month
    month_idx = m - 1
    desc = payment_desc_from_payload(payload)
    gs_post({
        'action': 'profit_append_entry',
        'location': payload.get('location') or 'DeBary',
        'data': {'month_idx': month_idx, 'row_type': 'payments', 'amount': amt, 'description': desc},
    })


# ── Main loop ───────────────────────────────────────────────────────────────

def main():
    print('=' * 60)
    print(f'  Payment backfill - v59 matcher{"   (DRY RUN)" if DRY_RUN else ""}')
    print('=' * 60)
    payments = sb_get('payments',
                      'select=id,customer_name,amount,payment_method,payment_date,vehicle_year,vehicle_make,vehicle_model,vehicle_color,vehicle_vin,location,raw_ocr_text&order=created_at.asc&limit=2000')
    eligible = [p for p in payments if profit_should_propagate(p)]
    print(f'\nLoaded {len(payments)} payments, {len(eligible)} eligible (filter excluded {len(payments) - len(eligible)}).')
    if LIMIT:
        eligible = eligible[:LIMIT]
        print(f'Limited to first {len(eligible)} for this run.')
    print()

    counts = {'posted': 0, 'posted_alias': 0, 'skipped': 0, 'queued': 0, 'error': 0}
    for i, p in enumerate(eligible, 1):
        label = f'[{i}/{len(eligible)}] id={p["id"]} {(p.get("customer_name") or "")[:26]:26} ${p.get("amount")} {(p.get("vehicle_model") or ""):14} {p.get("location")}'
        try:
            res = process_payment(p)
            key = next(iter(res))
            val = res[key]
            if key in counts:
                counts[key] += 1
            elif key == 'posted':
                counts['posted'] += 1
            elif key == 'posted_alias':
                counts['posted_alias'] += 1
            elif key == 'skipped':
                counts['skipped'] += 1
            elif key == 'queued':
                counts['queued'] += 1
            else:
                counts['error'] += 1
            detail = f'{key}={val}' if key != 'posted' else f'posted row={res.get("row")} tab={res.get("tab")}'
            print(f'{label}  ->{detail}')
        except urllib.error.HTTPError as e:
            counts['error'] += 1
            print(f'{label}  ->HTTP {e.code}: {e.read().decode()[:180]}')
        except Exception as e:
            counts['error'] += 1
            print(f'{label}  ->ERROR {e}')
        time.sleep(THROTTLE_MS / 1000.0)

    print()
    print('=' * 60)
    print(f'  Done · posted {counts["posted"]} (+{counts["posted_alias"]} via alias) · skipped {counts["skipped"]} · queued {counts["queued"]} · errors {counts["error"]}')
    print('=' * 60)


if __name__ == '__main__':
    main()
