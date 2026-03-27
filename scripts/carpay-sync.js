const fetch = require('node-fetch');

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

// ── CarPay API Auth ─────────────────────────────────────────────────────────
// TODO: Fill in once we have credentials and can inspect the actual API
async function cpLogin(email, password) {
  // The dealer portal at dealers.carpay.com uses email + password auth.
  // The API is at api.carpay.com. Auth flow needs to be reverse-engineered
  // from the portal's network requests.
  //
  // Expected flow:
  // 1. POST to auth endpoint with email + password
  // 2. Get back a session token / JWT / cookie
  // 3. Return headers object for subsequent API calls
  //
  // Placeholder:
  console.log('CarPay login not yet configured — skipping sync');
  return null;
}

// ── Fetch Customers ─────────────────────────────────────────────────────────
// TODO: Hit the CarPay API customers endpoint
async function cpGetCustomers(authHeaders, locationId) {
  // Expected to return array of customer objects:
  // { carpay_id, name, account, days_late, next_payment, auto_pay }
  //
  // The portal likely has an API like:
  // GET api.carpay.com/dealers/{dealerId}/customers?location={locationId}
  //
  // Or it may use the ui-states endpoint discovered at:
  // window.UiStateApiBaseUrl = "https://api.carpay.com/ui-states"
  return [];
}

// ── Fetch Payments ──────────────────────────────────────────────────────────
// TODO: Hit the CarPay API payments/transactions endpoint
async function cpGetPayments(authHeaders, locationId) {
  // Expected to return array of payment objects:
  // { carpay_id, name, account, amount_sent, date, time, method, reference }
  //
  // Date must be formatted as long en-US locale string:
  // e.g. "March 27, 2026" (matches app's toLocaleDateString)
  return [];
}

// ── Supabase Upsert ─────────────────────────────────────────────────────────
async function sbUpsert(table, rows) {
  if (!rows.length) return 0;
  let upserted = 0;
  // Batch 50 at a time
  for (let i = 0; i < rows.length; i += 50) {
    const batch = rows.slice(i, i + 50);
    const res = await fetch(SB_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=representation' },
      body: JSON.stringify(batch)
    });
    if (res.ok) {
      upserted += (await res.json()).length;
    } else {
      console.error('Upsert error for ' + table + ':', await res.text());
    }
  }
  return upserted;
}

async function sbDeleteByLocation(table, location) {
  const res = await fetch(SB_URL + '/rest/v1/' + table + '?location=eq.' + location, {
    method: 'DELETE',
    headers: SB_HEADERS
  });
  if (!res.ok) console.error('Delete error for ' + table + ' ' + location + ':', await res.text());
}

// ── Location Config ─────────────────────────────────────────────────────────
// TODO: Map location names to CarPay location IDs once we inspect the portal
const LOCATIONS = [
  { name: 'debary', carpayId: process.env.CARPAY_DEBARY_ID || null },
  { name: 'deland', carpayId: process.env.CARPAY_DELAND_ID || null }
];

// ── Main Sync ───────────────────────────────────────────────────────────────
async function main() {
  if (!SB_URL || !SB_KEY) {
    console.error('Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
  }

  if (!CP_EMAIL || !CP_PASSWORD) {
    console.log('CarPay credentials not configured — skipping sync.');
    console.log('Set CARPAY_EMAIL and CARPAY_PASSWORD to enable.');
    process.exit(0);
  }

  // Authenticate with CarPay
  const authHeaders = await cpLogin(CP_EMAIL, CP_PASSWORD);
  if (!authHeaders) {
    console.log('Auth not implemented yet — exiting cleanly.');
    process.exit(0);
  }

  let totalCustomers = 0;
  let totalPayments = 0;

  for (const loc of LOCATIONS) {
    console.log('Syncing ' + loc.name + '...');

    // Fetch from CarPay
    const customers = await cpGetCustomers(authHeaders, loc.carpayId);
    const payments = await cpGetPayments(authHeaders, loc.carpayId);
    console.log('  Fetched: ' + customers.length + ' customers, ' + payments.length + ' payments');

    // Tag with location
    customers.forEach(c => { c.location = loc.name; });
    payments.forEach(p => { p.location = loc.name; });

    // Replace: delete old data for this location, then insert fresh
    await sbDeleteByLocation('carpay_customers', loc.name);
    await sbDeleteByLocation('carpay_payments', loc.name);

    const custCount = await sbUpsert('carpay_customers', customers);
    const payCount = await sbUpsert('carpay_payments', payments);
    console.log('  Stored: ' + custCount + ' customers, ' + payCount + ' payments');

    totalCustomers += custCount;
    totalPayments += payCount;
  }

  console.log('=== CARPAY SYNC COMPLETE ===');
  console.log('Total: ' + totalCustomers + ' customers, ' + totalPayments + ' payments');
}

main().catch(e => { console.error(e); process.exit(1); });
