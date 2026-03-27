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

// ── HTTP helper (manual redirect + cookie tracking + retry) ──────────────────
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
  // GET login page to get CSRF token + session cookie
  const page = await cpFetch('/login');
  const html = await page.text();
  // CarPay uses CakePHP: field is _csrfToken
  const mCsrf = html.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
  if (!mCsrf) { console.error('CSRF token not found'); return false; }
  // Also grab _Token[fields] for CakePHP security component
  const mFields = html.match(/name="_Token\[fields\]"[^>]*value="([^"]+)"/);
  const tokenFields = mFields ? mFields[1] : '';

  // CarPay field names: username, password__not_in_db
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

// ── Switch Location ──────────────────────────────────────────────────────────
async function cpSelectDealer(dealerId) {
  await cpFetch('/dms/select-dealer?dealerId=' + dealerId);
}

// ── Parse customers table from HTML ─────────────────────────────────────────
function parseCustomers(html) {
  const customers = [];
  // Find the active customers tbody (first table body with rows)
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return customers;

  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  rows.forEach(row => {
    const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
    );
    if (tds.length < 9) return;
    // cols: Name, Account#, LastLogin, PayMethod, AutoPay(checkbox), Reminders, Blocked, NextPayment, DaysLate
    const name = tds[0];
    const account = tds[1];
    const nextPayment = tds[7] || '';
    const daysLateRaw = tds[8] || '0';
    // DaysLate: "(266)" means -266, "11" means +11
    const daysLate = parseInt(daysLateRaw.replace(/[()]/g, '').trim()) *
                     (daysLateRaw.includes('(') ? -1 : 1);
    // AutoPay: checkbox checked = "1" in value or checked attribute
    const autoPayTd = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])[4] || '';
    const autoPay = autoPayTd.includes('checked') || autoPayTd.includes('green');

    if (!name || !account) return;
    customers.push({
      name: name,
      account: account,
      days_late: isNaN(daysLate) ? 0 : daysLate,
      next_payment: nextPayment,
      auto_pay: autoPay
    });
  });
  return customers;
}

// ── Fetch all customers (paginate through all pages) ─────────────────────────
async function cpGetCustomers(dealerId) {
  await cpSelectDealer(dealerId);
  const all = [];
  let start = 0;
  const length = 100;

  while (true) {
    const res = await cpFetch('/dms/customers?start=' + start + '&length=' + length);
    const html = await res.text();
    const batch = parseCustomers(html);
    all.push.apply(all, batch);
    console.log('  Customers fetched so far:', all.length);

    // Check if more pages
    const totalMatch = html.match(/of\s+([\d,]+)\s+entries/);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;
    if (!batch.length || all.length >= total || total === 0) break;
    start += length;
  }
  return all;
}

// ── Parse payments table from HTML ───────────────────────────────────────────
function parsePayments(html) {
  const payments = [];
  // Find approved payments tbody (first tbody)
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return payments;

  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  rows.forEach(row => {
    const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
    );
    // cols: Name, Account#, Reference#, Date, Time, Platform, Collector, ApprovedInDMS,
    //       PaymentMethod, ConvFee, TotalWithFee, AmountSent, Memo
    if (tds.length < 11) return;
    const name = tds[0];
    const account = tds[1];
    const reference = tds[2];
    const date = tds[3];   // e.g. "March 27, 2026"
    const time = tds[4];   // e.g. "9:02 AM"
    const method = tds[5]; // Platform: "Customer Mobile App", "Automatic Payment", etc.
    const amountSent = tds[11] || tds[10] || '';

    if (!name || !account) return;
    payments.push({
      carpay_id: reference || null,
      name: name,
      account: account,
      reference: reference,
      date: date,
      time: time,
      method: method,
      amount_sent: amountSent
    });
  });
  return payments;
}

// ── Fetch all payments ────────────────────────────────────────────────────────
async function cpGetPayments(dealerId) {
  await cpSelectDealer(dealerId);
  const all = [];
  let start = 0;
  const length = 100;

  while (true) {
    const res = await cpFetch('/dms/recent-payments?start=' + start + '&length=' + length);
    const html = await res.text();
    const batch = parsePayments(html);
    all.push.apply(all, batch);
    console.log('  Payments fetched so far:', all.length);

    const totalMatch = html.match(/of\s+([\d,]+)\s+entries/);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;
    if (!batch.length || all.length >= total || total === 0) break;
    start += length;
  }
  return all;
}

// ── Supabase Upsert ──────────────────────────────────────────────────────────
async function sbUpsert(table, rows) {
  if (!rows.length) return 0;
  let upserted = 0;
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const res = await fetch(SB_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=representation' }),
      body: JSON.stringify(batch)
    });
    if (res.ok) { upserted += (await res.json()).length; }
    else { console.error('Upsert error for ' + table + ':', await res.text()); }
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

// ── Location Config ───────────────────────────────────────────────────────────
// Dealer IDs discovered from portal: DeBary=656, DeLand=657
const LOCATIONS = [
  { name: 'debary', dealerId: process.env.CARPAY_DEBARY_ID || '656' },
  { name: 'deland', dealerId: process.env.CARPAY_DELAND_ID || '657' }
];

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) { console.error('Missing SUPABASE_URL or SUPABASE_KEY'); process.exit(1); }
  if (!CP_EMAIL || !CP_PASSWORD) {
    console.log('CarPay credentials not configured — skipping sync.');
    process.exit(0);
  }

  const ok = await cpLogin(CP_EMAIL, CP_PASSWORD);
  if (!ok) { console.error('Login failed — exiting'); process.exit(1); }

  let totalCustomers = 0, totalPayments = 0;

  for (const loc of LOCATIONS) {
    console.log('\nSyncing ' + loc.name + ' (dealerId=' + loc.dealerId + ')...');

    const customers = await cpGetCustomers(loc.dealerId);
    const payments = await cpGetPayments(loc.dealerId);
    console.log('  Fetched: ' + customers.length + ' customers, ' + payments.length + ' payments');

    customers.forEach(c => { c.location = loc.name; });
    payments.forEach(p => { p.location = loc.name; });

    await sbDeleteByLocation('carpay_customers', loc.name);
    await sbDeleteByLocation('carpay_payments', loc.name);

    const custCount = await sbUpsert('carpay_customers', customers);
    const payCount = await sbUpsert('carpay_payments', payments);
    console.log('  Stored: ' + custCount + ' customers, ' + payCount + ' payments');

    totalCustomers += custCount;
    totalPayments += payCount;
  }

  console.log('\n=== CARPAY SYNC COMPLETE ===');
  console.log('Total: ' + totalCustomers + ' customers, ' + totalPayments + ' payments');
}

main().catch(e => { console.error(e); process.exit(1); });
