#!/usr/bin/env python3
"""
One-time populate of the `customers` + `deal_links` tables from existing
Supabase data (payment_deal_aliases, carpay_account_aliases, carpay_customers,
carpay_payments). Safe to re-run — upserts by natural keys.

Merge strategy (strongest identifier first):
  1. VIN -> unique per car. If a VIN is already on a deal_link, reuse it.
  2. CarPay account -> unique per car per location.
  3. Customer name -> fuzzy: normalize + last-name bucket.

Run:
    python scripts/populate-customers.py --dry-run   # show plan
    python scripts/populate-customers.py             # apply
"""

import json
import re
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request

SUPABASE = 'https://hphlouzqlimainczuqyc.supabase.co/rest/v1'
KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo'
CTX = ssl.create_default_context()
DRY = '--dry-run' in sys.argv


def sb(method, path, body=None):
    url = f'{SUPABASE}/{path}'
    hdrs = {'apikey': KEY, 'Authorization': f'Bearer {KEY}'}
    if body is not None:
        hdrs['Content-Type'] = 'application/json'
        hdrs['Prefer'] = 'return=representation'
    req = urllib.request.Request(url, data=json.dumps(body).encode() if body else None,
                                 headers=hdrs, method=method)
    try:
        with urllib.request.urlopen(req, context=CTX, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        raise RuntimeError(f'HTTP {e.code}: {e.read().decode()[:200]}')


def norm_name(s):
    """Canonicalize a name for matching: upper, strip punctuation, sort surnames."""
    if not s:
        return ''
    s = re.sub(r'[^a-zA-Z0-9,\s]', ' ', str(s).upper())
    s = re.sub(r'\s+', ' ', s).strip()
    return s


def last_names(s):
    if not s:
        return []
    s = re.sub(r'[^a-zA-Z,\s]', ' ', str(s))
    s = re.sub(r'\s+', ' ', s).strip()
    if ',' in s:
        pre = s.split(',', 1)[0].strip()
        return [t.lower() for t in pre.split() if t]
    parts = [t for t in s.split() if t]
    if not parts:
        return []
    if len(parts) == 1:
        return [parts[0].lower()]
    if len(parts) == 2:
        return [parts[1].lower()]
    return [parts[-2].lower(), parts[-1].lower()]


def first_lastname(s):
    ln = last_names(s)
    return ln[-1] if ln else ''


# ── Load source data ────────────────────────────────────────────────────

print('Loading source tables...')
aliases = sb('GET', 'payment_deal_aliases?select=*&order=created_at.asc&limit=5000')
# CarPay "aliases" = posted rows in carpay_payment_postings (status=posted + has target_row)
cp_aliases_raw = sb('GET', 'carpay_payment_postings?status=in.(posted,already_posted)&target_tab=not.is.null&target_row=not.is.null&select=account,location,target_tab,target_row,car_desc&order=processed_at.asc&limit=5000')
# Dedupe by (account, location) — latest row wins (but older ones all agree on same row)
_seen_key = {}
cp_aliases = []
for a in cp_aliases_raw:
    key = (a.get('account'), (a.get('location') or '').lower())
    if key in _seen_key:
        continue
    _seen_key[key] = True
    cp_aliases.append({'id': len(cp_aliases) + 1, **a})
cp_customers = sb('GET', 'carpay_customers?select=*&limit=5000')
print(f'  payment_deal_aliases: {len(aliases)}')
print(f'  carpay_account_aliases: {len(cp_aliases)}')
print(f'  carpay_customers: {len(cp_customers)}')

existing_customers = sb('GET', 'customers?select=*&limit=5000') if not DRY else []
existing_links = sb('GET', 'deal_links?select=*&limit=5000') if not DRY else []
print(f'  existing customers: {len(existing_customers)}')
print(f'  existing deal_links: {len(existing_links)}')


# ── Build dedupe indexes ────────────────────────────────────────────────

cust_by_name = {}       # normalized-name -> customer id
cust_by_lastname = {}   # lastname -> list of customer ids (fuzzy fallback)
for c in existing_customers:
    n = norm_name(c.get('name'))
    if n:
        cust_by_name[n] = c['id']
    for ln in last_names(c.get('name')):
        cust_by_lastname.setdefault(ln, []).append(c['id'])

link_by_vin = {l['vin']: l for l in existing_links if l.get('vin')}
link_by_account = {(l['carpay_account'], l.get('location', '').lower()): l
                   for l in existing_links if l.get('carpay_account')}
link_by_row = {(l['location'], l['target_tab'], l['target_row']): l for l in existing_links}


# ── Plans ───────────────────────────────────────────────────────────────

plan_customers_new = []    # list of (name, aliases[], source_note)
plan_links_new = []        # list of dicts for deal_links (customer resolved later)
plan_merges = []           # (existing_customer_id, new_alias_name, source)

# Local mutable maps as we synthesize
next_tmp_id = -1  # negative ids for customers-in-plan not yet inserted
tmp_cust_by_name = dict(cust_by_name)


def ensure_customer(display_name, source):
    """Return an id (real if exists, negative placeholder if planned new).
    Merge rule: ONLY exact normalized-name match. Two people sharing a
    surname (Marta Garcia vs Waldo Borroto Garcia) stay separate —
    surname alone is too weak to merge on. Later layers (VIN, CarPay
    account) provide strong identifiers for true dedup."""
    global next_tmp_id
    if not display_name or not display_name.strip():
        return None
    n = norm_name(display_name)
    if n in tmp_cust_by_name:
        cid = tmp_cust_by_name[n]
        if cid < 0:
            pc = plan_customers_new[-cid - 1]
            if display_name not in pc['aliases']:
                pc['aliases'].append(display_name)
        else:
            plan_merges.append((cid, display_name, source))
        return cid
    # Brand new customer — don't fuzzy-merge on surname alone
    tmp_id = next_tmp_id
    next_tmp_id -= 1
    plan_customers_new.append({
        'tmp_id': tmp_id,
        'name': display_name,
        'aliases': [display_name],
        'source': source,
    })
    tmp_cust_by_name[n] = tmp_id
    return tmp_id


def plan_link(customer_id, *, vin=None, carpay_account=None, location='',
              target_tab='', target_row=0, car_desc='', source=''):
    if customer_id is None:
        return
    key_row = (location, target_tab, target_row)
    # Dedupe: if a link already exists for this (loc, tab, row), skip.
    if key_row in link_by_row:
        return
    # Dedupe within the plan itself
    for p in plan_links_new:
        if (p['location'], p['target_tab'], p['target_row']) == key_row:
            # Merge identifiers onto the first matching plan
            if vin and not p.get('vin'):
                p['vin'] = vin
            if carpay_account and not p.get('carpay_account'):
                p['carpay_account'] = carpay_account
            return
    plan_links_new.append({
        'customer_id': customer_id,
        'location': location,
        'target_tab': target_tab,
        'target_row': int(target_row) if target_row else 0,
        'vin': vin or None,
        'carpay_account': carpay_account or None,
        'car_desc': car_desc or None,
        'source': source,
    })


# ── Pass 1: payment_deal_aliases (richest — has VIN + name + target row) ──

print('\nPass 1: payment_deal_aliases...')
# Preload payments keyed by VIN so we can pull full customer_name when available.
# This gives us the real full name (e.g. "MARTA GARCIA") instead of the alias's
# stored lowercase lastname — which disambiguates different people sharing a surname.
payments_by_vin = {}
try:
    pmts = sb('GET', 'payments?vehicle_vin=not.is.null&select=vehicle_vin,customer_name&limit=5000')
    for p in pmts:
        v = (p.get('vehicle_vin') or '').strip().upper()
        if v and v not in payments_by_vin:
            payments_by_vin[v] = p.get('customer_name', '').strip()
except Exception as e:
    print(f'  warning: could not preload VIN->name map: {e}')
print(f'  preloaded {len(payments_by_vin)} VIN->name mappings from payments table')

for a in aliases:
    vin = (a.get('vin') or '').strip().upper() or None
    # Strongest source: VIN -> payments.customer_name (full name)
    # Medium: car_desc's last word (actual surname on the row)
    # Weakest: alias's customer_name_lower (same surname collides for different people)
    display_name = None
    if vin and payments_by_vin.get(vin):
        display_name = payments_by_vin[vin]
    if not display_name:
        cd = (a.get('car_desc') or '').strip()
        if cd:
            toks = cd.split()
            # Trailing numeric junk like "trade" is rare; last word is usually surname
            if toks:
                display_name = toks[-1].title()
    if not display_name:
        cust_hint = a.get('customer_name_lower') or ''
        display_name = cust_hint.title() if cust_hint else '(unknown)'
    cid = ensure_customer(display_name, 'payment_deal_aliases')
    plan_link(cid, vin=vin, location=a.get('location', ''),
              target_tab=a.get('target_tab', 'Deals26'),
              target_row=a.get('target_row', 0),
              car_desc=a.get('car_desc'),
              source=f'payment_deal_aliases #{a["id"]}')


# ── Pass 2: carpay_account_aliases (has account + target row, may lack name) ──

print('Pass 2: carpay_account_aliases...')
# Index carpay_customers by account|location for name lookup
cp_cust_by_key = {}
for cc in cp_customers:
    cp_cust_by_key[(cc['account'], (cc.get('location') or '').lower())] = cc

for a in cp_aliases:
    cc = cp_cust_by_key.get((a['account'], (a.get('location') or '').lower()))
    display_name = cc['name'] if (cc and cc.get('name')) else f"CarPay #{a['account']}"
    cid = ensure_customer(display_name, 'carpay_account_aliases')
    plan_link(cid, carpay_account=a.get('account'),
              location=a.get('location', ''),
              target_tab=a.get('target_tab', 'Deals26'),
              target_row=a.get('target_row', 0),
              car_desc=a.get('car_desc'),
              source=f'carpay_account_aliases #{a["id"]}')


# ── Pass 3: carpay_customers that aren't linked yet ────────────────────

print('Pass 3: carpay_customers with no link yet...')
linked_accounts = {(a['account'], (a.get('location') or '').lower()) for a in cp_aliases}
unlinked_count = 0
for cc in cp_customers:
    key = (cc['account'], (cc.get('location') or '').lower())
    if key in linked_accounts:
        # Already got a link via Pass 2 — but may need to attach the real name
        ensure_customer(cc['name'] or f"CarPay #{cc['account']}", 'carpay_customers')
        continue
    # No link exists yet — create a customer row so future payment resolution
    # has somewhere to land. Do NOT create a deal_link (we don't know the deal).
    ensure_customer(cc['name'] or f"CarPay #{cc['account']}", 'carpay_customers')
    unlinked_count += 1
print(f'  {unlinked_count} customers known to CarPay with no deal link yet')


# ── Report ──────────────────────────────────────────────────────────────

print('\n== PLAN ==')
print(f'  new customers: {len(plan_customers_new)}')
print(f'  new deal_links: {len(plan_links_new)}')
print(f'  alias merges onto existing customers: {len(plan_merges)}')

if plan_customers_new[:10]:
    print('\nSample new customers:')
    for p in plan_customers_new[:10]:
        print(f'  "{p["name"]}" (aliases: {len(p["aliases"])}) from {p["source"]}')

if plan_links_new[:10]:
    print('\nSample new deal_links:')
    for p in plan_links_new[:10]:
        ids = []
        if p.get('vin'): ids.append(f'VIN {p["vin"][-6:]}')
        if p.get('carpay_account'): ids.append(f'CP#{p["carpay_account"]}')
        print(f'  cust={p["customer_id"]} {p["location"]} {p["target_tab"]} r{p["target_row"]} [{", ".join(ids)}] {p.get("car_desc", "")[:40]}')

if DRY:
    print('\n(dry run — no writes)')
    sys.exit(0)


# ── Apply ──────────────────────────────────────────────────────────────

print('\nApplying...')

# 1. Insert new customers, capture real IDs, remap negative tmp ids
tmp_to_real = {}
if plan_customers_new:
    payload = [{
        'name': p['name'],
        'name_aliases': list(set(p['aliases'])),
    } for p in plan_customers_new]
    # Insert in chunks of 100
    for i in range(0, len(payload), 100):
        chunk = payload[i:i+100]
        tmp_chunk = plan_customers_new[i:i+100]
        res = sb('POST', 'customers', chunk)
        for j, row in enumerate(res):
            tmp_to_real[tmp_chunk[j]['tmp_id']] = row['id']
    print(f'  inserted {len(payload)} customers')

# 2. Merge aliases onto existing customers
merge_by_id = {}
for cid, alias_name, src in plan_merges:
    merge_by_id.setdefault(cid, set()).add(alias_name)
for cid, new_aliases in merge_by_id.items():
    existing_c = next((c for c in existing_customers if c['id'] == cid), None)
    if not existing_c:
        continue
    cur = set(existing_c.get('name_aliases') or [])
    cur.update(new_aliases)
    # add canonical name to aliases too
    if existing_c.get('name'):
        cur.add(existing_c['name'])
    sb('PATCH', f'customers?id=eq.{cid}', {'name_aliases': list(cur)})
if merge_by_id:
    print(f'  merged aliases onto {len(merge_by_id)} existing customers')

# 3. Insert deal_links (remap customer_id if negative)
if plan_links_new:
    link_payload = []
    for p in plan_links_new:
        cid = p['customer_id']
        if cid < 0:
            cid = tmp_to_real.get(cid)
            if cid is None:
                continue
        link_payload.append({
            'customer_id': cid,
            'location': p['location'],
            'target_tab': p['target_tab'],
            'target_row': p['target_row'],
            'vin': p.get('vin'),
            'carpay_account': p.get('carpay_account'),
            'car_desc': p.get('car_desc'),
            'active': True,
        })
    inserted = 0
    for i in range(0, len(link_payload), 100):
        chunk = link_payload[i:i+100]
        try:
            res = sb('POST', 'deal_links', chunk)
            inserted += len(res)
        except RuntimeError as e:
            # Likely a unique-constraint collision — retry individually
            for single in chunk:
                try:
                    sb('POST', 'deal_links', single)
                    inserted += 1
                except RuntimeError as e2:
                    print(f'    skip {single.get("vin") or single.get("carpay_account")}: {e2}')
    print(f'  inserted {inserted} deal_links')

print('\nDone.')
