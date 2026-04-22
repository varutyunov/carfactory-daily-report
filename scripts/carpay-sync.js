// CarPay sync — Phase 1: list-page only.
//
// Previous version hit /dms/customer/{id} for every customer (vehicle,
// phone, email) AND for payment history. That's ~2× customer-count requests
// per run. CarPay asked us to stop — they flagged the traffic volume.
//
// Surgical replacement: fetch each list page once. DataTables server-renders
// every row inline in a single HTML response (confirmed by probe).
//   - /dms/customers          → name, account, phone, days_late, next_payment,
//                               auto_pay, carpay_id  (14 cols per row)
//   - /dms/recent-payments    → name, account, reference, date, time,
//                               method, amount_sent  (20 cols per row)
// Total per sync: 4 list requests + 1 login + 2 dealer-selects = 7 requests.
//
// What we DON'T get from list pages: email, vehicle year/make/model, current
// amount due, scheduled amount, payment frequency. These lived on the
// per-customer detail page. We preserve any existing values in Supabase
// rather than overwrite them with null. Phase 2 will address these gaps
// (add them as columns via CarPay's "Columns" UI if available, or do a
// rare slow sweep — TBD with user).

const fetch = require('node-fetch');

const BASE = 'https://dealers.carpay.com';
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const CP_EMAIL = process.env.CARPAY_EMAIL;
const CP_PASSWORD = process.env.CARPAY_PASSWORD;

const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

// ── Cookie Jar ───────────────────────────────────────────────────────────────
const jar = {};
function updateJar(res) {
  const cookies = res.headers.raw()['set-cookie'] || [];
  cookies.forEach(c => {
    const kv = c.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) jar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  });
}
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

async function cpFetch(url, opts, depth) {
  depth = depth || 0;
  if (depth > 10) throw new Error('Too many redirects');
  if (!url.startsWith('http')) url = BASE + url;

  let lastErr;
  for (let attempt = 0; attempt < 3; attempt++) {
    if (attempt > 0) {
      console.log('  Retrying (' + attempt + '/2): ' + url);
      await new Promise(r => setTimeout(r, 5000 * attempt));
    }
    try {
      const res = await fetch(url, Object.assign({}, opts, {
        headers: Object.assign({ 'Cookie': cookieHeader(), 'User-Agent': 'Mozilla/5.0' }, opts && opts.headers),
        redirect: 'manual',
        timeout: 60000
      }));
      updateJar(res);
      if (res.status >= 300 && res.status < 400) {
        let loc = res.headers.get('location') || '';
        if (!loc.startsWith('http')) loc = BASE + loc;
        return cpFetch(loc, { method: 'GET' }, depth + 1);
      }
      return res;
    } catch (e) {
      lastErr = e;
      if (e.type !== 'request-timeout') throw e;
    }
  }
  throw lastErr;
}

// ── Login ────────────────────────────────────────────────────────────────────
async function cpLogin(email, password) {
  const page = await cpFetch('/login');
  const html = await page.text();
  const mCsrf = html.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
  if (!mCsrf) { console.error('CSRF token not found'); return false; }
  const mFields = html.match(/name="_Token\[fields\]"[^>]*value="([^"]+)"/);
  const tokenFields = mFields ? mFields[1] : '';

  const body = 'username=' + encodeURIComponent(email) +
               '&password__not_in_db=' + encodeURIComponent(password) +
               '&_csrfToken=' + encodeURIComponent(mCsrf[1]) +
               '&_Token%5Bfields%5D=' + encodeURIComponent(tokenFields) +
               '&_Token%5Bunlocked%5D=' +
               '&redirect=' +
               '&remember_me_not_in_db=0';

  const res = await cpFetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  const text = await res.text();
  if (text.includes('Your Customers') || text.includes('/dms/')) {
    console.log('Login successful');
    return true;
  }
  console.error('Login failed — check credentials');
  return false;
}

async function cpSelectDealer(dealerId) {
  const res = await cpFetch('/dms/select-dealer?dealerId=' + dealerId);
  await res.text();
}

// ── Row cell helper ─────────────────────────────────────────────────────────
function cellText(tdHtml) {
  return tdHtml.replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function normalizePhone(raw) {
  const digits = (raw || '').replace(/\D/g, '');
  if (digits.length === 11 && digits[0] === '1') return digits.slice(1);
  if (digits.length === 10) return digits;
  return '';
}

// ── Parse /dms/customers HTML → [{ name, account, phone, ... }] ─────────────
// Column order (14 cols, confirmed April 2026 by probe):
//  0 Name     1 Account#    2 Last Login    3 Dealer Payment Method
//  4 Auto-Pay 5 Reminders   6 Blocked       7 Next Payment Date
//  8 Days Late  9 Phone     10 Last 6 VIN   11 Stock #
//  12 Co-Buyer  13 Actions
function parseCustomers(html) {
  const out = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return out;
  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const rawTds = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    if (rawTds.length < 14) continue;
    const tds = rawTds.map(cellText);

    const name = tds[0];
    const account = tds[1];
    if (!name || !account) continue;

    const nextPayment = tds[7] || '';
    // Days Late in UI uses "-(N)" for ahead-of-schedule and plain "N" for late.
    const daysLateRaw = tds[8] || '0';
    const magnitude = parseInt((daysLateRaw.match(/\d+/) || ['0'])[0], 10);
    const daysLate = daysLateRaw.includes('(') ? -magnitude : magnitude;

    const phone = normalizePhone(tds[9]);

    // Auto-pay cell contains an icon — no text in plaintext. Detect via HTML.
    const autoPayTd = rawTds[4] || '';
    const autoPay = /(checked|fa-check|green|true)/i.test(autoPayTd);

    const linkMatch = row.match(/\/dms\/customer\/(\d+)/);
    const carpayId = linkMatch ? linkMatch[1] : '';

    out.push({
      name, account,
      days_late: isNaN(daysLate) ? 0 : daysLate,
      next_payment: nextPayment,
      auto_pay: autoPay,
      carpay_id: carpayId,
      phone: phone
    });
  }
  return out;
}

// ── Parse /dms/recent-payments HTML → [{ name, account, ... }] ──────────────
// Column order (20 cols, confirmed April 2026):
//  0 Name     1 Account#    2 Stock#    3 Reference#    4 VIN
//  5 Date     6 Time        7 Origin    8 Platform      9 Collector
//  10 Company 11 Approved   12 Payment Method  13 Conv Fee
//  14 Total w/ Fee  15 Total w/o Platform Fee  16 Amount Sent to DMS
//  17 Last 4  18 Memo       19 Action
function parsePayments(html) {
  const out = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return out;
  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  for (const row of rows) {
    const rawTds = row.match(/<td[^>]*>[\s\S]*?<\/td>/g) || [];
    if (rawTds.length < 20) continue;
    const tds = rawTds.map(cellText);
    const name = tds[0];
    const account = tds[1];
    if (!name || !account) continue;
    out.push({
      name, account,
      reference: tds[3] || '',
      date: tds[5] || '',
      time: tds[6] || '',
      method: tds[12] || '',
      amount_sent: tds[16] || ''
    });
  }
  return out;
}

// ── Fetch the two list pages (once each, no pagination) ─────────────────────
async function cpGetCustomers(dealerId) {
  await cpSelectDealer(dealerId);
  // length=10000 covers any plausible customer count with zero pagination;
  // DataTables server echoes all rows in one response.
  const res = await cpFetch('/dms/customers?start=0&length=10000');
  const html = await res.text();
  return parseCustomers(html);
}

async function cpGetPayments(dealerId) {
  await cpSelectDealer(dealerId);
  const res = await cpFetch('/dms/recent-payments?start=0&length=10000');
  const html = await res.text();
  return parsePayments(html);
}

// ── Supabase helpers ────────────────────────────────────────────────────────
async function sbUpsert(table, rows) {
  if (!rows.length) return 0;
  const allKeys = {};
  rows.forEach(r => { Object.keys(r).forEach(k => { allKeys[k] = true; }); });
  const keyList = Object.keys(allKeys);
  const normalized = rows.map(r => {
    const out = {};
    keyList.forEach(k => { out[k] = r[k] !== undefined ? r[k] : null; });
    return out;
  });
  let upserted = 0;
  for (let i = 0; i < normalized.length; i += 50) {
    const batch = normalized.slice(i, i + 50);
    const res = await fetch(SB_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(batch)
    });
    if (res.ok) upserted += (await res.json()).length;
    else console.error('Upsert error for ' + table + ':', await res.text());
  }
  return upserted;
}

async function sbDeleteByLocation(table, location) {
  const res = await fetch(SB_URL + '/rest/v1/' + table + '?location=eq.' + location, {
    method: 'DELETE',
    headers: SB_HEADERS
  });
  if (!res.ok) console.error('Delete error ' + table + ' ' + location + ':', await res.text());
}

// Fetch fields we will NOT overwrite — email, vehicle, current_amount_due,
// scheduled_amount, payment_frequency, repo_flagged. Keyed by account.
async function sbLoadPreserveMap(location) {
  // Try * first so we keep working even if we misremembered a column name.
  const url = SB_URL + '/rest/v1/carpay_customers?location=eq.' + location + '&select=*';
  const res = await fetch(url, { method: 'GET', headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' }) });
  if (!res.ok) {
    console.error('  preserve-map query failed: ' + res.status + ' ' + (await res.text()).slice(0, 300));
    return {};
  }
  const rows = await res.json();
  console.log('  preserve-map raw rows: ' + rows.length + (rows[0] ? ' (sample keys: ' + Object.keys(rows[0]).join(',') + ')' : ''));
  const map = {};
  rows.forEach(row => { if (row.account) map[row.account] = row; });
  return map;
}

function applyPreserved(cust, preserved) {
  const p = preserved[cust.account];
  if (!p) return;
  if (p.email) cust.email = p.email;
  if (p.vehicle) cust.vehicle = p.vehicle;
  if (p.current_amount_due != null) cust.current_amount_due = p.current_amount_due;
  if (p.scheduled_amount) cust.scheduled_amount = p.scheduled_amount;
  if (p.payment_frequency) cust.payment_frequency = p.payment_frequency;
  if (p.repo_flagged) cust.repo_flagged = true;
  if (p.vin) cust.vin = p.vin;
  if (p.color) cust.color = p.color;
}

// ── Location config ─────────────────────────────────────────────────────────
const LOCATIONS = [
  { name: 'debary', dealerId: process.env.CARPAY_DEBARY_ID || '656' },
  { name: 'deland', dealerId: process.env.CARPAY_DELAND_ID || '657' }
];

// ── Main ────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE_URL or SUPABASE_KEY'); process.exit(1); }
  if (!CP_EMAIL || !CP_PASSWORD) {
    console.log('CarPay credentials not configured — skipping sync.');
    process.exit(0);
  }

  const ok = await cpLogin(CP_EMAIL, CP_PASSWORD);
  if (!ok) { console.error('Login failed — exiting'); process.exit(1); }

  let totalCust = 0, totalPay = 0;

  for (const loc of LOCATIONS) {
    console.log('\nSyncing ' + loc.name + ' (dealerId=' + loc.dealerId + ')...');

    const preserved = await sbLoadPreserveMap(loc.name);
    console.log('  Loaded preserve-map for ' + Object.keys(preserved).length + ' existing accounts');

    const customers = await cpGetCustomers(loc.dealerId);
    console.log('  Fetched ' + customers.length + ' customers from list page');

    const payments = await cpGetPayments(loc.dealerId);
    console.log('  Fetched ' + payments.length + ' payments from list page');

    customers.forEach(c => {
      c.location = loc.name;
      applyPreserved(c, preserved);
    });
    payments.forEach(p => { p.location = loc.name; });

    await sbDeleteByLocation('carpay_customers', loc.name);
    await sbDeleteByLocation('carpay_payments', loc.name);

    const custCount = await sbUpsert('carpay_customers', customers);
    const payCount = await sbUpsert('carpay_payments', payments);
    console.log('  Stored: ' + custCount + ' customers, ' + payCount + ' payments');
    totalCust += custCount;
    totalPay += payCount;
  }

  console.log('\n=== CARPAY SYNC COMPLETE ===');
  console.log('Total: ' + totalCust + ' customers, ' + totalPay + ' payments');
}

main().catch(e => { console.error(e); process.exit(1); });
