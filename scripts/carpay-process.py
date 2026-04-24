#!/usr/bin/env python3
"""
Server-side CarPay payment processor. Mirrors the in-app
_appendCarPayPaymentToDeals26 flow with the v561 Stage-2 resolver.

For each carpay_payment since 2026-04-09 that isn't already in
carpay_payment_postings:
  1. _carpayParseDate + parse_amount to build the payload
  2. Stage-2 resolver (VIN > carpay_account > customer name)
     - confident link → post via deals26_append_payment_direct
       with check_dup, then profit-cap to Profit26
     - ambiguous     → queue payment_reviews with their cars only
  3. fall through → queue payment_reviews with reason
     approve_first / no_vehicle / no_customer

Records each outcome to carpay_payment_postings keyed by reference.
Idempotent — safe to re-run; refs already in postings are skipped.
"""

import json
import re
import ssl
import sys
import time
import urllib.parse
import urllib.request
from collections import Counter
from datetime import datetime

KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo'
SB = 'https://hphlouzqlimainczuqyc.supabase.co/rest/v1'
GS = 'https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec'
SECRET = 'cf-sync-2026'
CUTOFF = '2026-04-09'
CTX = ssl.create_default_context()


def sb_get(path):
    req = urllib.request.Request(f'{SB}/{path}',
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


def sb_post(path, body):
    req = urllib.request.Request(f'{SB}/{path}', data=json.dumps(body).encode(),
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                                          'Content-Type': 'application/json',
                                          'Prefer': 'return=representation'},
                                 method='POST')
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


def sb_upsert(path, body):
    # Upsert via Prefer: resolution=merge-duplicates (requires an index/constraint)
    req = urllib.request.Request(f'{SB}/{path}', data=json.dumps(body).encode(),
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                                          'Content-Type': 'application/json',
                                          'Prefer': 'resolution=merge-duplicates,return=representation'},
                                 method='POST')
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


def gs(body):
    body = dict(body); body['secret'] = SECRET
    req = urllib.request.Request(GS, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, context=CTX, timeout=60) as r:
        return json.loads(r.read())


# ── helpers mirroring the in-app JS ────────────────────────────────────

def parse_amount(s):
    if s is None:
        return 0.0
    t = re.sub(r'[^0-9.\-]', '', str(s))
    try:
        return float(t) if t else 0.0
    except ValueError:
        return 0.0


def parse_date(s):
    # "April 23, 2026" → "2026-04-23"
    if not s:
        return ''
    try:
        return datetime.strptime(str(s).strip(), '%B %d, %Y').strftime('%Y-%m-%d')
    except ValueError:
        pass
    try:
        return datetime.strptime(str(s).strip(), '%b %d, %Y').strftime('%Y-%m-%d')
    except ValueError:
        pass
    return ''


def norm_loc(s):
    t = (s or '').lower()
    if t == 'debary': return 'DeBary'
    if t == 'deland': return 'DeLand'
    return 'DeBary'


def parse_vehicle(s):
    s = (s or '').strip()
    if not s:
        return ('', '', '')
    parts = s.split()
    year = ''
    rest = parts[:]
    if parts and re.match(r'^(19|20)\d{2}$', parts[0]):
        year = parts[0]
        rest = parts[1:]
    make = rest[0] if rest else ''
    model = ' '.join(rest[1:]) if len(rest) > 1 else ''
    if not model and make:
        model, make = make, ''
    return (year, make, model)


def last_names(name):
    s = (name or '').strip()
    if not s:
        return []
    if ',' in s:
        raw = s.split(',', 1)[0].strip()
        parts = [p for p in raw.split() if p]
        return [p.lower() for p in parts]
    parts = [p for p in s.split() if p]
    if not parts:
        return []
    if len(parts) == 1:
        return [parts[0].lower()]
    if len(parts) == 2:
        return [parts[1].lower()]
    return [parts[-2].lower(), parts[-1].lower()]


def last_name(name):
    a = last_names(name)
    return a[-1] if a else ''


def build_note(amount, year, model, color, lname, date_str):
    MAX = 26
    year2 = ''
    if year:
        s = str(year).strip()
        if len(s) == 4:
            year2 = s[2:]
        elif len(s) == 2:
            year2 = s
    md = ''
    if date_str:
        try:
            y, m, d = date_str.split('-')
            md = f'{int(m)}/{int(d)}'
        except (ValueError, AttributeError):
            pass
    amt_str = str(int(amount)) if float(amount) == int(amount) else str(amount)
    def fit(parts):
        return ' '.join(p for p in parts if p)
    model = (model or '').strip()
    color_l = (color or '').lower()
    lname_l = (lname or '').lower()
    reserved = len(amt_str) + (len(md) + 1 if md else 0) + (1 if amt_str else 0)
    budget = MAX - reserved
    core = fit([year2, model, color_l, lname_l])
    if len(core) > budget: core = fit([year2, model, '', lname_l])
    if len(core) > budget: core = fit(['', model, '', lname_l])
    if len(core) > budget:
        model_short = model.split()[0] if model else ''
        core = fit(['', model_short, '', lname_l])
        if len(core) > budget:
            maxlast = budget - len(model_short) - (1 if model_short else 0)
            if maxlast < 1:
                core = model_short[:budget]
            else:
                core = (model_short + (' ' if model_short else '') + lname_l[:maxlast]).strip()
    out = []
    if amt_str: out.append(amt_str)
    if core: out.append(core)
    if md: out.append(md)
    return ' '.join(out)


def profit_cap(amount, owed_after):
    amt = float(amount)
    after = float(owed_after)
    if amt <= 0:
        return 0
    before = after - amt
    if before >= 0:
        return amt
    if after <= 0:
        return 0
    return after


def resolve_deal_link(vin, carpay_account, customer_name, location):
    loc = location or 'DeBary'
    v = (vin or '').strip().upper()
    if v:
        try:
            r = sb_get(f'deal_links?vin=eq.{urllib.parse.quote(v)}&active=eq.true&select=*&limit=1')
            if r:
                return {'link': r[0]}
        except urllib.error.HTTPError:
            pass
    if carpay_account:
        try:
            r = sb_get(f'deal_links?carpay_account=eq.{urllib.parse.quote(str(carpay_account))}&location=eq.{urllib.parse.quote(loc)}&active=eq.true&select=*&limit=1')
            if r:
                return {'link': r[0]}
        except urllib.error.HTTPError:
            pass
    name = (customer_name or '').strip()
    if name:
        safe = name.replace('"', '')
        q = (f'or=(name.ilike.{urllib.parse.quote(safe)},'
             f'name_aliases.cs.{urllib.parse.quote(json.dumps([safe]))})'
             f'&select=id&limit=5')
        try:
            custs = sb_get(f'customers?{q}')
            if custs:
                ids = [c['id'] for c in custs]
                dls = sb_get(f'deal_links?customer_id=in.({",".join(str(i) for i in ids)})&active=eq.true&select=*')
                if dls:
                    if len(dls) == 1:
                        return {'link': dls[0]}
                    return {'ambiguous': dls}
        except urllib.error.HTTPError:
            pass
    return None


def append_profit(payload, amount, location):
    """Post to Profit26 Payments row for the month of payment_date."""
    date_str = payload.get('payment_date') or ''
    if date_str:
        try:
            month_idx = int(date_str.split('-')[1]) - 1
        except (ValueError, IndexError):
            month_idx = datetime.now().month - 1
    else:
        month_idx = datetime.now().month - 1
    year, make, model = payload.get('vehicle_year', ''), payload.get('vehicle_make', ''), payload.get('vehicle_model', '')
    lname = last_name(payload.get('customer_name'))
    color = payload.get('vehicle_color', '')
    desc = build_note(amount, year, model, color, lname,
                      payload.get('payment_date', ''))
    # Strip the amount prefix for description
    prefix = (str(int(amount)) if float(amount) == int(amount) else str(amount)) + ' '
    if desc.startswith(prefix):
        desc = desc[len(prefix):]
    gs({'action': 'profit_append_entry', 'location': location,
        'data': {'month_idx': month_idx, 'row_type': 'payments',
                 'amount': amount, 'description': desc}})


def record_posting(cp, payload, outcome):
    body = {
        'reference': cp['reference'],
        'account': cp.get('account'),
        'status': outcome.get('status') or 'unknown',
        'location': payload.get('location') or norm_loc(cp.get('location')),
        'amount': payload.get('amount'),
        'target_tab': outcome.get('target_tab'),
        'target_row': outcome.get('target_row'),
        'car_desc': outcome.get('car_desc'),
        'review_id': outcome.get('review_id'),
        'error': outcome.get('error'),
        'processed_at': datetime.utcnow().isoformat() + 'Z',
    }
    try:
        sb_post('carpay_payment_postings', body)
    except Exception as e:
        print(f'  record_posting err: {e}')


def queue_review(payload, reason, candidates):
    body = {
        'payment_id': None,
        'customer_name': payload.get('customer_name') or '',
        'amount': payload.get('amount') or 0,
        'vehicle_year': payload.get('vehicle_year') or '',
        'vehicle_make': payload.get('vehicle_make') or '',
        'vehicle_model': payload.get('vehicle_model') or '',
        'vehicle_color': payload.get('vehicle_color') or '',
        'vehicle_vin': payload.get('vehicle_vin') or '',
        'location': payload.get('location'),
        'payment_date': payload.get('payment_date') or None,
        'payment_method': payload.get('payment_method') or '',
        'note_line': build_note(payload['amount'],
                                payload.get('vehicle_year'),
                                payload.get('vehicle_model'),
                                payload.get('vehicle_color'),
                                last_name(payload.get('customer_name')),
                                payload.get('payment_date')),
        'reason': reason,
        'candidates': json.dumps(candidates or []),
        'status': 'pending',
    }
    res = sb_post('payment_reviews', body)
    return res[0]['id'] if isinstance(res, list) and res else None


# ── main ───────────────────────────────────────────────────────────────

def main():
    print('Loading CarPay state...')
    carpay_payments = sb_get('carpay_payments?select=reference,name,account,amount_sent,date,method,location&limit=10000')
    carpay_customers = sb_get('carpay_customers?select=account,name,vehicle,location&limit=5000')
    cust_by_key = {}
    for c in carpay_customers:
        key = (c.get('account') or '') + '|' + (c.get('location') or '').lower()
        cust_by_key[key] = c
    processed_refs = set()
    post_rows = sb_get('carpay_payment_postings?select=reference&limit=10000')
    for p in post_rows:
        if p.get('reference'):
            processed_refs.add(p['reference'])
    print(f'  {len(carpay_payments)} CarPay payments total')
    print(f'  {len(processed_refs)} already in postings (will skip)')
    print(f'  {len(carpay_customers)} CarPay customers roster')

    todo = [cp for cp in carpay_payments if cp.get('reference') and cp['reference'] not in processed_refs]
    print(f'  {len(todo)} to process (post-cutoff + not yet in postings)')
    print()

    counters = Counter()
    for i, cp in enumerate(todo, 1):
        # Build payload
        iso = parse_date(cp.get('date'))
        if iso and iso < CUTOFF:
            record_posting(cp, {'location': norm_loc(cp.get('location'))},
                           {'status': 'skipped_pre_cutoff', 'error': f'date {iso} before cutoff {CUTOFF}'})
            counters['pre_cutoff'] += 1
            continue
        cust = (cust_by_key.get((cp.get('account') or '') + '|' + (cp.get('location') or '').lower())
                or cust_by_key.get((cp.get('account') or '') + '|debary')
                or cust_by_key.get((cp.get('account') or '') + '|deland')
                or None)
        year, make, model = parse_vehicle(cust.get('vehicle') if cust else None)
        payload = {
            'customer_name': cp.get('name') or (cust and cust.get('name')) or '',
            'amount': parse_amount(cp.get('amount_sent')),
            'payment_date': iso,
            'payment_method': cp.get('method') or '',
            'vehicle_year': year, 'vehicle_make': make, 'vehicle_model': model,
            'vehicle_color': '', 'vehicle_vin': '',
            'location': norm_loc(cp.get('location')),
            'carpay_account': cp.get('account'),
            'carpay_reference': cp.get('reference'),
        }
        if payload['amount'] == 0:
            record_posting(cp, payload, {'status': 'zero_amount'})
            counters['zero'] += 1
            continue

        label = f'[{i}/{len(todo)}] {(payload["customer_name"] or "")[:22]:22} ${payload["amount"]:<7} acc={cp.get("account") or "":5}'

        # Stage-2 resolver
        try:
            resolved = resolve_deal_link(payload.get('vehicle_vin'),
                                         payload.get('carpay_account'),
                                         payload.get('customer_name'),
                                         payload.get('location'))
        except Exception as e:
            print(f'{label} -> resolver error: {e}')
            counters['error'] += 1
            continue

        if resolved and resolved.get('link'):
            lk = resolved['link']
            try:
                res = gs({
                    'action': 'deals26_append_payment_direct',
                    'location': lk.get('location') or payload['location'],
                    'data': {
                        'tab': lk['target_tab'], 'row': lk['target_row'],
                        'amount': payload['amount'],
                        'note_line': build_note(payload['amount'], year, model, '',
                                                last_name(payload['customer_name']), iso),
                        'last_names': last_names(payload['customer_name']),
                        'check_dup': True,
                        'expected_car_desc': lk.get('car_desc'),  # v65 drift guard
                    },
                })
            except Exception as e:
                print(f'{label} -> direct post err: {e}')
                counters['error'] += 1
                continue

            # v65: row drift or surname mismatch — deactivate stale link
            # and queue review.
            if res.get('ok') is False and res.get('error') in ('row_drift', 'surname_mismatch'):
                try:
                    req = urllib.request.Request(
                        f'{SB}/deal_links?id=eq.{lk["id"]}',
                        data=json.dumps({'active': False}).encode(),
                        headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}',
                                 'Content-Type': 'application/json'},
                        method='PATCH')
                    urllib.request.urlopen(req, context=CTX, timeout=30).read()
                except Exception:
                    pass
                rid = queue_review(payload, 'row_drift', [])
                record_posting(cp, payload, {'status': 'review', 'review_id': rid})
                counters['row_drift'] += 1
                print(f'{label} -> ROW_DRIFT stale link {lk["id"]} deactivated (expected="{lk.get("car_desc","")[:35]}", actual="{res.get("actual_car_desc","")[:35]}")')
                continue
            if res.get('ok') is False:
                print(f'{label} -> direct post failed: {res}')
                counters['error'] += 1
                continue
            st = res.get('status')
            if st == 'already_posted':
                record_posting(cp, payload, {'status': 'already_posted',
                                             'target_tab': lk['target_tab'],
                                             'target_row': lk['target_row'],
                                             'car_desc': lk.get('car_desc')})
                counters['already'] += 1
                print(f'{label} -> already_posted {lk["target_tab"]} r{lk["target_row"]}')
                continue
            if st == 'possible_duplicate':
                rid = queue_review(payload, 'possible_duplicate',
                                   [{'tab': lk['target_tab'], 'row': lk['target_row'],
                                     'car_desc': lk.get('car_desc'), 'location': lk.get('location'),
                                     'has_last': True, 'has_car': True}])
                record_posting(cp, payload, {'status': 'review', 'review_id': rid})
                counters['review_dup'] += 1
                print(f'{label} -> possible_dup review {rid}')
                continue
            # matched — post to Profit26 (profit cap)
            owed = float(res.get('owed') or 0)
            cap = profit_cap(payload['amount'], owed)
            if cap > 0:
                try:
                    append_profit(payload, cap, lk.get('location') or payload['location'])
                except Exception as e:
                    print(f'  (profit append warn: {e})')
            record_posting(cp, payload, {'status': 'posted',
                                         'target_tab': lk['target_tab'],
                                         'target_row': lk['target_row'],
                                         'car_desc': lk.get('car_desc')})
            counters['posted'] += 1
            print(f'{label} -> POSTED {lk["target_tab"]} r{lk["target_row"]} profit=${cap:.0f}')
            time.sleep(0.15)
            continue

        if resolved and resolved.get('ambiguous'):
            cands = [{'tab': l['target_tab'], 'row': l['target_row'],
                      'car_desc': l.get('car_desc'), 'location': l.get('location'),
                      'has_last': True, 'has_car': True} for l in resolved['ambiguous']]
            rid = queue_review(payload, 'multiple_customer_deals', cands)
            record_posting(cp, payload, {'status': 'review', 'review_id': rid})
            counters['review_ambig'] += 1
            print(f'{label} -> AMBIG ({len(cands)} deals) review {rid}')
            continue

        # No resolver hit — queue with reason based on what we know
        if not cust:
            reason = 'no_customer'
        elif not model:
            reason = 'no_vehicle'
        else:
            reason = 'approve_first'
        rid = queue_review(payload, reason, [])
        record_posting(cp, payload, {'status': 'review', 'review_id': rid})
        counters[reason] += 1
        if i % 20 == 0 or i == len(todo):
            print(f'{label} -> {reason}')

    print()
    print('=' * 60)
    print(f'Processed {len(todo)} payments')
    for k, v in sorted(counters.items(), key=lambda x: -x[1]):
        print(f'  {k:20} {v}')


if __name__ == '__main__':
    import urllib.error
    sys.exit(main())
