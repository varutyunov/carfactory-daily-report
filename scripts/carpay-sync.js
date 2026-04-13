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

// ── Switch Location ──────────────────────────────────────────────────────────
async function cpSelectDealer(dealerId) {
  const res = await cpFetch('/dms/select-dealer?dealerId=' + dealerId);
  await res.text();
}

// ── Parse customers table from HTML ─────────────────────────────────────────
function parseCustomers(html) {
  const customers = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return customers;

  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  rows.forEach(row => {
    const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
    );
    if (tds.length < 9) return;
    const name = tds[0];
    const account = tds[1];
    const nextPayment = tds[7] || '';
    const daysLateRaw = tds[8] || '0';
    const daysLate = parseInt(daysLateRaw.replace(/[()]/g, '').trim()) *
                     (daysLateRaw.includes('(') ? -1 : 1);
    const autoPayTd = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || [])[4] || '';
    const autoPay = autoPayTd.includes('checked') || autoPayTd.includes('green');
    const linkMatch = row.match(/\/dms\/customer\/(\d+)/);
    const carpayId = linkMatch ? linkMatch[1] : '';

    if (!name || !account) return;
    customers.push({
      name, account,
      days_late: isNaN(daysLate) ? 0 : daysLate,
      next_payment: nextPayment,
      auto_pay: autoPay,
      carpay_id: carpayId
    });
  });
  return customers;
}

// ── Fetch all customers (paginate) ──────────────────────────────────────────
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

    const totalMatch = html.match(/of\s+([\d,]+)\s+entries/);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;
    if (!batch.length || all.length >= total || total === 0) break;
    start += length;
  }
  return all;
}

// ── Parse customer detail page for vehicle, phone, email, balance ───────────
const CAR_MAKES = ['Acura','Alfa','Aston','Audi','Bentley','BMW','Buick','Cadillac','Chevrolet','Chevy','Chrysler','Dodge','Ferrari','Fiat','Ford','Genesis','GMC','Honda','Hyundai','Infiniti','Jaguar','Jeep','Kia','Lamborghini','Land','Lexus','Lincoln','Maserati','Mazda','McLaren','Mercedes','Mini','Mitsubishi','Nissan','Pontiac','Porsche','Ram','Rolls','Saab','Saturn','Scion','Subaru','Tesla','Toyota','Volkswagen','Volvo','Oldsmobile','Mercury','Plymouth','Hummer','Isuzu','Suzuki','Daewoo'];
// Words that appear in CarPay UI text and should NOT be treated as vehicle names
const NOT_VEHICLE = ['successful','regular','schedule','payment','customer','online','mobile','approved','complete','pending','failed','declined','amount','frequency','login','dealer','account','balance','history','transaction'];

function isValidVehicle(v) {
  if (!v) return false;
  const words = v.toLowerCase().split(/\s+/);
  // Must have at least year + one word
  if (words.length < 2) return false;
  // Second word (make) must not be a known CarPay UI term
  if (NOT_VEHICLE.some(bad => words[1] === bad || words.slice(1).join(' ').startsWith(bad))) return false;
  return true;
}

function parseCustomerDetails(html) {
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // ── Vehicle extraction (7 strategies) ──
  let vehicle = '';

  // Strategy 1: "Login as Customer YEAR MAKE MODEL Customer ID"
  let m = text.match(/Login as Customer\s+(\d{4}\s+[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+Customer ID/);
  if (m) vehicle = m[1].trim();

  // Strategy 2: "YEAR MAKE MODEL Customer ID:"
  if (!vehicle) {
    m = text.match(/(\d{4}\s+[A-Za-z]+\s+[A-Za-z]+)\s+Customer ID/);
    if (m) vehicle = m[1].trim();
  }

  // Strategy 3: "Vehicle:" label
  if (!vehicle) {
    m = text.match(/Vehicle\s*:?\s*(\d{4}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3})/i);
    if (m) vehicle = m[1].trim();
  }

  // Strategy 4: <title> tag
  if (!vehicle) {
    const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (titleMatch) {
      m = titleMatch[1].match(/(\d{4}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3})/);
      if (m && isValidVehicle(m[1])) vehicle = m[1].trim();
    }
  }

  // Strategy 5: Headings with vehicle info
  if (!vehicle) {
    const headingMatches = html.match(/<h[1-4][^>]*>[\s\S]*?<\/h[1-4]>/gi) || [];
    for (const h of headingMatches) {
      const hText = h.replace(/<[^>]+>/g, '').trim();
      m = hText.match(/(\d{4}\s+[A-Za-z]+(?:\s+[A-Za-z]+){0,3})/);
      if (m && isValidVehicle(m[1])) { vehicle = m[1].trim(); break; }
    }
  }

  // Strategy 6: Broad scan for YEAR + known car make
  if (!vehicle) {
    const allYearMatches = text.match(/((?:19|20)\d{2})\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,3})/g);
    if (allYearMatches) {
      for (const ym of allYearMatches) {
        const parts = ym.split(/\s+/);
        const year = parseInt(parts[0]);
        if (year >= 1990 && year <= 2029 && parts.length >= 2) {
          const possibleMake = parts[1];
          if (CAR_MAKES.some(mk => possibleMake.toLowerCase().startsWith(mk.toLowerCase().slice(0, 3)))) {
            vehicle = ym.trim();
            break;
          }
        }
      }
      // No last-resort fallback — only accept known car makes to avoid false positives
    }
  }

  // Strategy 7: Data attributes
  if (!vehicle) {
    const dataMatch = html.match(/data-vehicle="([^"]+)"/i) || html.match(/data-car="([^"]+)"/i);
    if (dataMatch && dataMatch[1].match(/\d{4}/)) vehicle = dataMatch[1].trim();
  }

  // ── Phone extraction ──
  let phone = '';
  // Find tel: links, skip toll-free
  const telMatches = html.match(/href="tel:([^"]+)"/g) || [];
  for (const t of telMatches) {
    let ph = t.replace(/href="tel:/, '').replace(/"/, '').replace(/\D/g, '');
    if (ph.length === 11 && ph[0] === '1') ph = ph.slice(1);
    if (ph.length === 10 && !ph.startsWith('877') && !ph.startsWith('800') && !ph.startsWith('888')) {
      phone = ph; break;
    }
  }
  if (!phone) {
    const phoneMatches = text.match(/\+?1?\s*\((\d{3})\)\s*(\d{3})[.\-\s](\d{4})/g) || [];
    for (const pm of phoneMatches) {
      let digits = pm.replace(/\D/g, '');
      if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
      if (digits.length === 10 && !digits.startsWith('877') && !digits.startsWith('800') && !digits.startsWith('888')) {
        phone = digits; break;
      }
    }
  }

  // ── Email extraction ──
  let email = '';
  const mailtoMatch = html.match(/href="mailto:([^"]+)"/i);
  if (mailtoMatch) email = mailtoMatch[1].trim().toLowerCase();
  if (!email || !email.includes('@')) {
    const emailMatch = text.match(/([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
    email = emailMatch ? emailMatch[1].toLowerCase() : '';
  }

  // ── Scheduled amount, frequency, amount due ──
  const schedMatch = text.match(/Regular Scheduled Amount:\s*\$([\d,]+\.?\d*)/i);
  const scheduledAmount = schedMatch ? '$' + schedMatch[1] : '';

  const freqMatch = text.match(/Payment Frequency:\s*([A-Za-z-]+)/i);
  const paymentFrequency = freqMatch ? freqMatch[1] : '';

  const dueMatch = text.match(/Current Amount Due:\s*\$([\d,]+\.?\d*)/i);
  const currentAmountDue = dueMatch ? parseFloat(dueMatch[1].replace(/,/g, '')) : null;

  return { vehicle, phone, email, scheduledAmount, paymentFrequency, currentAmountDue };
}

// ── Fetch customer details (vehicle, phone, email) for all customers ────────
async function cpGetCustomerDetails(dealerId, customers, location) {
  await cpSelectDealer(dealerId);
  const batchSize = 5;
  let fetched = 0;

  // Load existing vehicle data so SPA-page customers keep their vehicles
  const existingDetails = {};
  try {
    const exRes = await fetch(SB_URL + '/rest/v1/carpay_customers?location=eq.' + location + '&vehicle=neq.&select=account,vehicle', {
      headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' })
    });
    if (exRes.ok) {
      (await exRes.json()).forEach(c => { existingDetails[c.account] = c.vehicle; });
      console.log('  Loaded ' + Object.keys(existingDetails).length + ' existing vehicles to preserve');
    }
  } catch(e) {}

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (cust) => {
      if (!cust.carpay_id) return;
      try {
        const res = await cpFetch('/dms/customer/' + cust.carpay_id);
        const html = await res.text();
        const details = parseCustomerDetails(html);
        cust.vehicle = details.vehicle || '';
        cust.phone = details.phone || '';
        cust.email = details.email || '';
        cust.scheduled_amount = details.scheduledAmount || '';
        cust.payment_frequency = details.paymentFrequency || '';
        cust.current_amount_due = details.currentAmountDue;
        // If HTML parsing failed, use previously saved vehicle data (from bookmarklet)
        if (!details.vehicle && existingDetails[cust.account]) {
          cust.vehicle = existingDetails[cust.account];
          console.log('  ℹ Kept saved vehicle for ' + cust.name + ': ' + cust.vehicle);
        } else if (!details.vehicle) {
          console.log('  ⚠ No vehicle for ' + cust.name + ' (acct ' + cust.account + ') — SPA page, no saved data');
        }
      } catch (e) { /* skip individual failures */ }
    }));
    fetched += batch.length;
    if (fetched % 30 === 0 || fetched >= customers.length) {
      const ph = customers.filter(c => c.phone).length;
      const vh = customers.filter(c => c.vehicle).length;
      console.log('  Details: ' + fetched + '/' + customers.length + ' fetched (' + ph + ' phones, ' + vh + ' vehicles)');
    }
    // Throttle to avoid IP ban
    await new Promise(r => setTimeout(r, 800));
  }

  const phCount = customers.filter(c => c.phone).length;
  const emCount = customers.filter(c => c.email).length;
  const vhCount = customers.filter(c => c.vehicle).length;
  console.log('  Details complete: ' + phCount + ' phones, ' + emCount + ' emails, ' + vhCount + ' vehicles');
}

// ── Parse payments table from HTML ───────────────────────────────────────────
function parsePayments(html) {
  const payments = [];
  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) return payments;

  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  rows.forEach(row => {
    const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
    );
    if (tds.length < 17) return;
    const name = tds[0];
    const account = tds[1];
    const reference = tds[2];
    const date = tds[5];
    const time = tds[6];
    const method = tds[8];
    const amountSent = tds[16];

    if (!name || !account) return;
    payments.push({
      carpay_id: reference || null,
      name, account, reference, date, time, method,
      amount_sent: amountSent
    });
  });
  return payments;
}

// ── Fetch all recent payments (paginated) ───────────────────────────────────
async function cpGetRecentPayments(dealerId) {
  await cpSelectDealer(dealerId);
  const all = [];
  let start = 0;
  const length = 100;

  while (true) {
    const res = await cpFetch('/dms/recent-payments?start=' + start + '&length=' + length);
    const html = await res.text();
    const batch = parsePayments(html);
    all.push.apply(all, batch);
    console.log('  Recent payments fetched so far:', all.length);

    const totalMatch = html.match(/of\s+([\d,]+)\s+entries/);
    const total = totalMatch ? parseInt(totalMatch[1].replace(/,/g, '')) : 0;
    if (!batch.length || all.length >= total || total === 0) break;
    start += length;
  }
  return all;
}

// ── Parse payment history from individual customer page ──────────────────────
function parseCustomerPagePayments(html) {
  const payments = [];
  const tbodyMatches = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/g) || [];
  for (const tbody of tbodyMatches) {
    const rows = tbody.match(/<tr[\s\S]*?<\/tr>/g) || [];
    for (const row of rows) {
      const tds = (row.match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
        td.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#039;/g, "'").trim()
      );
      if (tds.length >= 4) {
        const dateStr = tds[0];
        const status = tds[1].toLowerCase();
        const method = tds[2];
        const amount = tds[3];
        const isValid = status.includes('success') || status.includes('approved') || status.includes('complete') || status.includes('paid') || status.includes('settled');
        if (dateStr && amount && amount.includes('$') && isValid) {
          payments.push({ date: dateStr, method, amount_sent: amount });
        }
      }
    }
  }
  return payments;
}

// ── Fetch full payment history from each customer's detail page ──────────────
async function cpGetCustomerPayments(dealerId, customers, location) {
  await cpSelectDealer(dealerId);
  const allPayments = [];
  const batchSize = 5;

  for (let i = 0; i < customers.length; i += batchSize) {
    const batch = customers.slice(i, i + batchSize);
    await Promise.all(batch.map(async (cust) => {
      if (!cust.carpay_id) return;
      try {
        const res = await cpFetch('/dms/customer/' + cust.carpay_id + '?dealerId=' + dealerId + '&tabId=payment-history');
        const html = await res.text();
        const pays = parseCustomerPagePayments(html);
        pays.forEach(p => {
          allPayments.push({
            location,
            carpay_id: cust.carpay_id || null,
            name: cust.name,
            account: cust.account,
            reference: '',
            date: p.date,
            time: '',
            method: p.method || '',
            amount_sent: p.amount_sent
          });
        });
      } catch (e) { /* skip */ }
    }));
    if ((i + batchSize) % 50 === 0 || i + batchSize >= customers.length) {
      console.log('  Customer payment history: ' + Math.min(i + batchSize, customers.length) + '/' + customers.length + ' (' + allPayments.length + ' payments)');
    }
  }
  return allPayments;
}

// ── Supabase Upsert ──────────────────────────────────────────────────────────
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

    // Step 1: Get customer list
    const customers = await cpGetCustomers(loc.dealerId);
    console.log('  Found ' + customers.length + ' customers');

    // Step 2: Fetch vehicle, phone, email from each customer's detail page
    console.log('  Fetching customer details (vehicle, phone, email)...');
    await cpGetCustomerDetails(loc.dealerId, customers, loc.name);

    // Step 3: Fetch recent payments
    const recentPayments = await cpGetRecentPayments(loc.dealerId);
    console.log('  Found ' + recentPayments.length + ' recent payments');

    // Step 4: Fetch full payment history from each customer page
    console.log('  Fetching payment history from customer pages...');
    const customerPayments = await cpGetCustomerPayments(loc.dealerId, customers, loc.name);
    console.log('  Found ' + customerPayments.length + ' payments from customer pages');

    // Tag with location
    customers.forEach(c => { c.location = loc.name; });
    recentPayments.forEach(p => { p.location = loc.name; });

    // Merge & deduplicate payments
    const allPayments = recentPayments.slice();
    const seenKeys = {};
    allPayments.forEach(p => { seenKeys[p.account + '|' + p.date + '|' + p.amount_sent] = true; });
    let added = 0;
    customerPayments.forEach(p => {
      const key = p.account + '|' + p.date + '|' + p.amount_sent;
      if (!seenKeys[key]) { allPayments.push(p); seenKeys[key] = true; added++; }
    });
    console.log('  Total payments: ' + allPayments.length + ' (' + recentPayments.length + ' recent + ' + added + ' from history)');

    // Preserve repo_flagged before deleting
    const existingRes = await fetch(SB_URL + '/rest/v1/carpay_customers?location=eq.' + loc.name + '&repo_flagged=eq.true&select=account,repo_flagged', {
      method: 'GET', headers: SB_HEADERS
    });
    const flaggedAccounts = {};
    if (existingRes.ok) {
      const flagged = await existingRes.json();
      flagged.forEach(f => { flaggedAccounts[f.account] = true; });
      if (Object.keys(flaggedAccounts).length) console.log('  Preserving ' + Object.keys(flaggedAccounts).length + ' repo flags');
    }

    // Delete old data and insert fresh
    await sbDeleteByLocation('carpay_customers', loc.name);
    await sbDeleteByLocation('carpay_payments', loc.name);

    // Re-apply repo_flagged
    customers.forEach(c => {
      if (flaggedAccounts[c.account]) c.repo_flagged = true;
    });

    const custCount = await sbUpsert('carpay_customers', customers);
    const payCount = await sbUpsert('carpay_payments', allPayments);
    console.log('  Stored: ' + custCount + ' customers, ' + payCount + ' payments');

    totalCustomers += custCount;
    totalPayments += payCount;
  }

  console.log('\n=== CARPAY SYNC COMPLETE ===');
  console.log('Total: ' + totalCustomers + ' customers, ' + totalPayments + ' payments');
}

main().catch(e => { console.error(e); process.exit(1); });
