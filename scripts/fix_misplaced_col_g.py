#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
fix_misplaced_col_g.py
Cleans up the off-by-one Deals26 col G writes from today's audit run.

Background: audit_2026.py used Supabase's deals26.sort_order as the
sheet row when calling deals26_append_payment_direct. Sort_order is
header-offset from sheet row (sort_order = _sheetRow - 1), so writes
landed on the row one above the intended deal. Apps Script's surname
matcher caught some of them (rerouted to correct row) but mis-routed
others.

This script:
  1. Reads every Deals26 row's current col G via Apps Script read_all.
  2. For each row, parses each col G line.
  3. If a line's surname doesn't match the row's car_desc surname,
     it's misplaced. Find the correct row by matching the line's
     surname against deals_by_surname.
  4. Move the line: remove from current row, append to correct row.
"""
import sys, io
if sys.stdout.encoding and sys.stdout.encoding.lower() != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8', errors='replace')

import json, os, re, time, urllib.request
from collections import defaultdict

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _sb_config import SB_URL, SB_HDR  # noqa: E402

GAS_URL = ('https://script.google.com/macros/s/'
           'AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec')
GAS_SECRET = 'cf-sync-2026'
APPLY = '--apply' in sys.argv

def gas(b, retries=2):
    b['secret'] = GAS_SECRET
    last = None
    for a in range(retries+1):
        try:
            req = urllib.request.Request(GAS_URL, data=json.dumps(b).encode(),
                headers={'Content-Type':'application/plain'}, method='POST')
            with urllib.request.urlopen(req, timeout=90) as r:
                return json.loads(r.read())
        except Exception as e:
            last = e
            if a < retries: time.sleep(3)
    raise last

_AMT_RE = re.compile(r'^\s*(-?[\d,]+(?:\.\d+)?)\s+(.+?)\s*$')
_DATE_TAIL_RE = re.compile(r'(\d{1,2}/\d{1,2})\s*$')
_WORD_RE = re.compile(r'[a-z0-9]+')

def parse_line(line):
    raw = (line or '').strip()
    if not raw: return None
    m = _AMT_RE.match(raw)
    if not m: return None
    try: amt = float(m.group(1).replace(',', ''))
    except ValueError: return None
    rest = m.group(2)
    return {'raw': raw, 'amount': round(amt, 2), 'rest': rest}

def has_date(line):
    return bool(_DATE_TAIL_RE.search(line))

# Surname tokens from a car_desc (last token primarily)
def car_desc_surname(cd):
    toks = (cd or '').split()
    if not toks: return ''
    return toks[-1].lower().rstrip('.,;:')

# Surname tokens from a line's text (any 4+ char word, lowercased)
def line_surname_tokens(rest):
    # Strip trailing date if present
    txt = _DATE_TAIL_RE.sub('', rest).strip().lower()
    # 3+ chars (Lee, Cox, Pa, etc. happen — 3 covers most)
    return [w for w in _WORD_RE.findall(txt) if len(w) >= 3]

def surname_matches(line_text, car_surname):
    if not car_surname or len(car_surname) < 3:
        return True  # can't disambiguate
    tokens = line_surname_tokens(line_text)
    cs = car_surname.lower()
    for w in tokens:
        if w == cs: return True
        if cs.startswith(w) and len(w) >= 3: return True  # truncation (Lee, Cox)
        if w.startswith(cs) and len(w) - len(cs) <= 3: return True
    return False

# ── Load Deals26 + account links ───────────────────────────────────────────
print('Loading Deals26 rows…')
all_rows = []  # {tab, loc, sheet_row, car_desc, payment_notes}
for loc in ['DeBary', 'DeLand']:
    resp = gas({'action':'read_all','tab':'Deals26','location':loc})
    for r in (resp or {}).get('rows', []):
        cd = (r.get('car_desc') or '').strip()
        if not cd: continue
        all_rows.append({
            'tab': 'Deals26', 'loc': loc,
            'sheet_row': r.get('_sheetRow'),
            'car_desc': cd,
            'payment_notes': r.get('payment_notes') or '',
        })
print(f'  {len(all_rows)} Deals26 rows total')

# Load account links so we can pick "the linked deal" when ambiguous
print('Loading deal_account_links…')
def sb_all(t, p=''):
    out, off = [], 0
    while True:
        url = f'{SB_URL}/rest/v1/{t}?{p}&limit=1000&offset={off}'
        with urllib.request.urlopen(urllib.request.Request(url, headers=SB_HDR), timeout=30) as r:
            page = json.loads(r.read())
        out.extend(page); off += 1000
        if len(page) < 1000: break
    return out
links = sb_all('deal_account_links','select=deal_key,deal_tab,deal_loc,deal_row,custaccountno,car_desc_at_link')
# Index link → deal_key. deal_row in links is sort_order (0-based offset);
# sheet_row = sort_order + 1.
linked_deal_keys = set()
for l in links:
    if l['deal_tab'] != 'Deals26': continue
    sheet_row = (l['deal_row'] or 0) + 1
    linked_deal_keys.add((l['deal_loc'], sheet_row))
print(f'  {len(linked_deal_keys)} Deals26 links')

# Index by surname for relocation
deals_by_surname = defaultdict(list)
for r in all_rows:
    s = car_desc_surname(r['car_desc'])
    if s and len(s) >= 3:
        deals_by_surname[s].append(r)

# ── Detect misplaced lines ─────────────────────────────────────────────────
print()
print('Scanning for misplaced col G entries…')

misplaced = []  # {from_row: row, line: parsed, suggested_to: [matching_rows]}

for r in all_rows:
    car_surname = car_desc_surname(r['car_desc'])
    notes = r['payment_notes']
    if not notes.strip(): continue
    for ln in notes.split('\n'):
        s = ln.strip()
        if not s: continue
        if not has_date(s): continue
        # Only consider 2026 entries (we just added them today)
        # Heuristic: require date_tail M/D and surname mismatch
        p = parse_line(s)
        if not p: continue
        if surname_matches(p['rest'], car_surname):
            continue
        # Find candidate destination rows by line's surname tokens
        line_toks = line_surname_tokens(p['rest'])
        candidates = []
        for tok in line_toks:
            for dest in deals_by_surname.get(tok, []):
                if dest is r: continue
                if dest['loc'] != r['loc']: continue  # don't cross lots
                if dest not in candidates:
                    candidates.append(dest)
        misplaced.append({
            'from_row': r,
            'line': s,
            'amount': p['amount'],
            'candidates': candidates,
        })

print(f'  {len(misplaced)} misplaced col G entries detected')

# ── Plan ────────────────────────────────────────────────────────────────────
print()
print('PLAN:')
plan = []
for m in misplaced:
    fr = m['from_row']
    cands = m['candidates']
    if len(cands) == 1:
        to = cands[0]
        plan.append({**m, 'to_row': to, 'action': 'MOVE'})
        print(f'  MOVE  from r{fr["sheet_row"]:>3} ({fr["car_desc"][:30]:30s}) '
              f'→ r{to["sheet_row"]:>3} ({to["car_desc"][:30]:30s}) | "{m["line"]}"')
    elif len(cands) == 0:
        plan.append({**m, 'to_row': None, 'action': 'NO_TARGET'})
        print(f'  ?     no surname-matching dest found for "{m["line"]}" on r{fr["sheet_row"]} ({fr["car_desc"][:30]})')
    else:
        # Disambiguate using account links: prefer the candidate that has
        # a deal_account_link (means it's the active one for that customer).
        linked = [c for c in cands if (c['loc'], c['sheet_row']) in linked_deal_keys]
        if len(linked) == 1:
            to = linked[0]
            plan.append({**m, 'to_row': to, 'action': 'MOVE_LINKED'})
            print(f'  MOVE+ from r{fr["sheet_row"]:>3} ({fr["car_desc"][:30]:30s}) '
                  f'→ r{to["sheet_row"]:>3} ({to["car_desc"][:30]:30s}) [linked] | "{m["line"]}"')
        else:
            plan.append({**m, 'to_row': None, 'action': 'AMBIGUOUS'})
            cand_descs = ', '.join(f'r{c["sheet_row"]} ({c["car_desc"][:20]})' for c in cands[:3])
            print(f'  AMBIG ({len(cands)} candidates) for "{m["line"]}" on r{fr["sheet_row"]}: {cand_descs}')

# Summary
counts = defaultdict(int)
for p in plan: counts[p['action']] += 1
print()
print(f'SUMMARY:  MOVE={counts["MOVE"]}  NO_TARGET={counts["NO_TARGET"]}  AMBIGUOUS={counts["AMBIGUOUS"]}')

if not APPLY:
    print()
    print('Dry-run. Re-run with --apply to move misplaced entries.')
    sys.exit(0)

# ── Apply ──────────────────────────────────────────────────────────────────
print()
print('Applying moves…')

# Group moves by destination row (so we batch additions)
removes = defaultdict(list)   # (loc, sheet_row, car_desc) → [lines to remove]
appends = defaultdict(list)   # (loc, sheet_row, car_desc) → [lines to append]
for p in plan:
    if p['action'] not in ('MOVE', 'MOVE_LINKED'): continue
    fr = p['from_row']; to = p['to_row']
    fr_key = (fr['loc'], fr['sheet_row'], fr['car_desc'])
    to_key = (to['loc'], to['sheet_row'], to['car_desc'])
    removes[fr_key].append(p['line'])
    appends[to_key].append({'line': p['line'], 'amount': p['amount']})

ok = err = 0

# Step 1: Remove from source rows (correct_payments with new notes)
for (loc, row, car_desc), lines in removes.items():
    src = next((r for r in all_rows if r['loc']==loc and r['sheet_row']==row), None)
    if not src: continue
    cur_lines = src['payment_notes'].split('\n')
    keep = []
    to_drop = list(lines)
    for ln in cur_lines:
        s = ln.strip()
        if s in to_drop:
            to_drop.remove(s)
            continue
        keep.append(ln)
    new_notes = '\n'.join(keep).rstrip()
    new_total = 0.0
    for ln in keep:
        p = parse_line(ln)
        if p: new_total += p['amount']
    try:
        resp = gas({'action':'correct_payments','location':loc,
            'data':{'tab':'Deals26','row':row,
                    'new_total':round(new_total,2),
                    'new_notes':new_notes,
                    'expected_car_desc':car_desc}})
        if resp and resp.get('ok'):
            ok += 1
            print(f'  ✓ removed {len(lines)} from r{row} ({car_desc[:30]})')
        else:
            err += 1
            print(f'  ✗ remove from r{row}: {resp}')
    except Exception as e:
        err += 1
        print(f'  ✗ remove r{row}: {e}')

# Step 2: Append to destination rows
for (loc, row, car_desc), entries in appends.items():
    for ent in entries:
        try:
            # Use _paymentNoteLineFit-equivalent already in line, just append.
            # Use deals26_append_payment_direct with bypass + dup check.
            note_line = ent['line']
            # extract surname from line for last_names hint
            p = parse_line(note_line)
            tokens = line_surname_tokens(p['rest'] if p else '')
            try:
                resp = gas({'action':'deals26_append_payment_direct','location':loc,
                    'data':{'tab':'Deals26','row':row,
                            'amount': ent['amount'], 'note_line': note_line,
                            'last_names': tokens[:3],
                            'bypass_surname_check': True, 'check_dup': True}})
                if resp and resp.get('ok'):
                    ok += 1
                    print(f'  ✓ added to r{row} ({car_desc[:30]}): {note_line}')
                else:
                    err += 1
                    print(f'  ✗ add to r{row}: {resp}')
            except Exception as e:
                err += 1
                print(f'  ✗ add r{row}: {e}')
        except Exception as e:
            err += 1
            print(f'  ✗ row {row}: {e}')

print()
print(f'Done: ok={ok} err={err}')
