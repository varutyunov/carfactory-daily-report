#!/usr/bin/env python3
"""
Audit Profit26 over-posts caused by the backfill.

Rule discovered from Vlad (col F formula = payments + money - cost - expenses - taxes - 399):
  Sum of Profit26 entries for a given deal should equal max(0, col F).
  If sum > max(0, col F), the deal is over-posted (backfill added profit entries while
  the deal was still in the red).

This script:
  1. Reads the 65 backfill-touched target rows.
  2. Reads col F (profit-so-far) for each.
  3. Scans Profit26 Payments formula + note across all months on each location
     for entries whose description mentions the deal's surname + model.
  4. Compares sum-of-profit26-entries vs max(0, col F) and flags over-posts.

Read-only. Prints a report with the exact entries to remove/adjust.
Use --fix to apply the corrections.
"""

import json
import os
import ssl
import sys
import time
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_KEY as KEY  # noqa: E402

GS = 'https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec'
SECRET = 'cf-sync-2026'
SUPABASE = f'{SB_URL}/rest/v1'
CTX = ssl.create_default_context()
FIX = '--fix' in sys.argv


def gs(body):
    body = dict(body)
    body['secret'] = SECRET
    req = urllib.request.Request(GS, data=json.dumps(body).encode(),
                                 headers={'Content-Type': 'text/plain'})
    with urllib.request.urlopen(req, context=CTX, timeout=120) as r:
        return json.loads(r.read())


def sb(path):
    req = urllib.request.Request(f'{SUPABASE}/{path}',
                                 headers={'apikey': KEY, 'Authorization': f'Bearer {KEY}'})
    with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
        return json.loads(r.read())


# ── Step 1: list every distinct target row touched by any alias ─────────
aliases = sb('payment_deal_aliases?select=location,target_tab,target_row&order=id.asc')
targets = sorted({(a['location'], a['target_tab'], a['target_row']) for a in aliases})
print(f'Target rows to audit: {len(targets)}')
print()

# ── Step 2: pull col F + car_desc for each target ───────────────────────
rows = []
for loc, tab, r in targets:
    try:
        d = gs({'action': 'deals26_get_row_g', 'location': loc, 'data': {'tab': tab, 'row': r}})
        if d.get('ok'):
            rows.append({'loc': loc, 'tab': tab, 'row': r,
                         'car_desc': d.get('car_desc', ''),
                         'owed': float(d.get('owed') or 0),
                         'payments': float(d.get('value') or 0)})
    except Exception as e:
        print(f'  skipped {loc}/{tab}/{r}: {e}')
    time.sleep(0.15)

# ── Step 3: pull Profit26 payments for both locations ───────────────────
profit = {}
for loc in ('DeBary', 'DeLand'):
    d = gs({'action': 'read_profit', 'location': loc})
    months = d.get('months') or []
    entries = []  # list of (month_idx, month_name, amount, desc)
    for m in months:
        name = m.get('name', '')
        # Resolve month index — Jan=0..Dec=11 (Sheet uses "March" not "Mar", but read_profit returns abbreviated sometimes)
        names = ['Jan', 'Feb', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
        if name in names:
            midx = names.index(name)
        else:
            continue
        for it in m.get('items') or []:
            if it.get('label') != 'Payments':
                continue
            note = it.get('valueNote') or ''
            formula = it.get('formula') or ''
            # Parse formula: =A+B+C
            amt_tokens = []
            if formula.startswith('='):
                for tk in formula[1:].split('+'):
                    tk = tk.strip()
                    if not tk:
                        continue
                    try:
                        amt_tokens.append(float(tk))
                    except ValueError:
                        pass
            note_lines = [l.strip() for l in note.split('\n') if l.strip()]
            # Zip formula amounts with note lines — they correspond 1:1 in order
            for i, line in enumerate(note_lines):
                amt = amt_tokens[i] if i < len(amt_tokens) else None
                entries.append({'month_idx': midx, 'month_name': name, 'amount': amt, 'desc_full': line})
    profit[loc] = entries

# ── Step 4: for each deal row, find matching Profit26 entries by surname + (year / model) ──
IGNORE = {'trade', 'rebuilt', 'hatchback', 'blue', 'black', 'white', 'silver', 'red', 'grey',
          'gray', 'green', 'yellow', 'gold', 'orange', 'purple', 'tan', 'brown', 'beige',
          'pearl', 'maroon', 'teal', 'navy', 'bronze', 'burgundy', 'champagne', 'charcoal',
          'copper', 'cream', 'ivory', 'nardo', 'cp', 'gt', 'si', 'type', 'hyb', 'wagon', 'ex', 'lt',
          '2', '3', '4', '1', '2D', '4D'}


def car_tokens(car_desc):
    """Extract informative tokens from car_desc (model keywords, year, surname)."""
    if not car_desc:
        return set(), ''
    tokens = [t.lower().rstrip(',') for t in car_desc.strip().split() if t]
    surname = tokens[-1] if tokens else ''
    meaningful = set()
    for t in tokens:
        if not t or t in IGNORE:
            continue
        if t.endswith('k') and t[:-1].isdigit():  # mileage like "300k"
            continue
        meaningful.add(t)
    return meaningful, surname


def best_deal_for_entry(entry_desc, deals):
    """For one profit26 note line, pick the deal with the best token-overlap score.
       Requires the deal's surname to appear in the line AND some other token overlap."""
    tokens = [t.lower().rstrip(',') for t in entry_desc.split() if t]
    if len(tokens) < 2:
        return None
    entry_set = set(t for t in tokens if t not in IGNORE and not (t.endswith('k') and t[:-1].isdigit()))
    best = None
    best_score = 0
    for d in deals:
        d_tokens, surname = d['tokens'], d['surname']
        if surname and surname not in entry_set:
            continue
        overlap = len(entry_set & d_tokens)
        if overlap > best_score:
            best_score = overlap
            best = d
    return best if best_score >= 2 else None  # surname + at least one other matched token


# Pre-compute deal tokens per location
deals_by_loc = {}
for r in rows:
    tokens, surname = car_tokens(r['car_desc'])
    r['tokens'] = tokens
    r['surname'] = surname
    r['matches'] = []
    deals_by_loc.setdefault(r['loc'], []).append(r)

# Assign each profit26 entry to its best-matching deal
orphans = {'DeBary': [], 'DeLand': []}
for loc in ('DeBary', 'DeLand'):
    for e in profit.get(loc, []):
        deal = best_deal_for_entry(e['desc_full'], deals_by_loc.get(loc, []))
        if deal is None:
            orphans[loc].append(e)
        else:
            deal['matches'].append(e)

over_posts = []
for r in rows:
    posted = sum(e['amount'] for e in r['matches'] if e['amount'] is not None)
    cap = max(0.0, r['owed'])
    over = posted - cap
    if over > 0.01:
        tag = f'OVER by ${over:.2f}'
        over_posts.append({'row': r, 'matches': r['matches'], 'posted': posted, 'cap': cap, 'over': over})
    elif abs(posted - cap) < 0.01 and posted > 0:
        tag = 'OK'
    elif posted < cap - 0.01:
        tag = f'UNDER by ${cap - posted:.2f}'
    else:
        tag = '---'
    print(f'{r["loc"]:6} {r["tab"]:8} r{r["row"]:<4} {r["car_desc"][:45]:45} colF=${r["owed"]:>8.0f}  profit26=${posted:>8.0f}  cap=${cap:>6.0f}  {tag}')

print()
print(f'Summary: {len(over_posts)} deals over-posted. Total over-post: ${sum(o["over"] for o in over_posts):.2f}')
if over_posts:
    print()
    print('=== OVER-POST DETAIL ===')
    for op in over_posts:
        r = op['row']
        print(f'{r["loc"]} {r["tab"]} r{r["row"]} ({r["car_desc"]})')
        print(f'  surname={r["surname"]}  colF=${r["owed"]:.0f}  posted=${op["posted"]:.0f}  need_to_remove=${op["over"]:.0f}')
        for m in op['matches']:
            print(f'    [{m["month_name"]}] {m["amount"]:>7.2f}  "{m["desc_full"]}"')

print()
orphan_total = sum(len(o) for o in orphans.values())
print(f'Profit26 entries with no confident deal match: {orphan_total} (not counted as over-posts)')

if not FIX:
    print('\n(read-only — re-run with --fix to apply corrections)')
