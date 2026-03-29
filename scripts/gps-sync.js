/**
 * GPS Sync — Register GPS devices in Passtime OASIS
 *
 * Pulls finance deals from Supabase where gps_uploaded = false,
 * registers each GPS serial in Passtime OASIS, then marks gps_uploaded = true.
 *
 * Usage:
 *   LOCAL (headed, with 2FA wait): node scripts/gps-sync.js --local
 *   CI (headless, no 2FA):         node scripts/gps-sync.js
 */

const { chromium } = require('playwright');

const LOCAL_MODE = process.argv.includes('--local');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const PT_ACCOUNT = process.env.PASSTIME_ACCOUNT || '15270';
const PT_USER = process.env.PASSTIME_USER || 'Vladimir';
const PT_PASS = process.env.PASSTIME_PASS;

const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

const PASSTIME_URL = 'https://secure.passtimeusa.com';
const skipLog = [];
const successLog = [];

// ── Supabase Helpers ─────────────────────────────────────────────────────────

async function sbGet(table, params) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?${params || ''}`, {
    headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' })
  });
  if (!r.ok) throw new Error(`sbGet ${table}: ${await r.text()}`);
  return r.json();
}

async function sbPatch(table, id, body) {
  const r = await fetch(`${SB_URL}/rest/v1/${table}?id=eq.${id}`, {
    method: 'PATCH',
    headers: SB_HEADERS,
    body: JSON.stringify(body)
  });
  if (!r.ok) throw new Error(`sbPatch ${table}/${id}: ${await r.text()}`);
  return r.json();
}

// ── Parse Deal Data ──────────────────────────────────────────────────────────

function parseDeal(deal) {
  // GPS serial is now stored as a clean value in its own column
  const rawSerial = (deal.gps_serial || '').trim();

  // Customer name — split into first/last
  const nameParts = (deal.customer_name || '').trim().split(/\s+/);
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || nameParts[0] || '';

  // Account number — use stock number as account
  const account = deal.stock || String(deal.id);

  // VIN
  const vin = (deal.vin || '').trim();

  // Color — extract from vehicle_desc if not separate
  // vehicle_desc is like "2019 Honda Civic" — color may not be there
  // We'll try to get it from the deal data
  const color = (deal.color || '').trim();

  return {
    id: deal.id,
    serial: rawSerial,
    firstName,
    lastName,
    account,
    vin,
    color,
    vehicleDesc: deal.vehicle_desc || ''
  };
}

// ── Wait Helper ──────────────────────────────────────────────────────────────

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitForNav(page, timeout = 15000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await sleep(1000);
}

// ── Passtime Login ───────────────────────────────────────────────────────────

async function passtimeLogin(page) {
  console.log('🔐 Opening Passtime OASIS login...');
  await page.goto(PASSTIME_URL, { waitUntil: 'networkidle' });
  await sleep(2000);

  if (LOCAL_MODE) {
    // ── Local: User logs in manually, we just wait ────────────────────────
    // Pre-fill account number and username as a convenience
    await page.evaluate(({ account, user }) => {
      var acct = document.getElementById('login_DealerNumber');
      var usr = document.getElementById('login_UserName');
      if (acct) acct.value = account;
      if (usr) usr.value = user;
      var pwd = document.getElementById('login_Password');
      if (pwd) pwd.focus();
    }, { account: PT_ACCOUNT, user: PT_USER });

    console.log('');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('   LOG IN NOW — Enter your password and complete 2FA.');
    console.log('   The script will take over once you reach the dashboard.');
    console.log('═══════════════════════════════════════════════════════════');
    console.log('');

    // Poll every 3 seconds for up to 5 minutes waiting for dashboard
    const maxWait = 300000;
    const start = Date.now();
    let landed = false;
    while (Date.now() - start < maxWait) {
      await sleep(3000);
      const currentUrl = page.url();
      if (currentUrl.includes('CustomerRpt') || currentUrl.includes('Dashboard') || currentUrl.includes('Default') || currentUrl.includes('EliteRenewalCheck')) {
        landed = true;
        break;
      }
    }

    if (!landed) {
      console.log('❌ Timed out waiting for login (5 minutes). Exiting.');
      return false;
    }
  } else {
    // ── CI: Automated login ───────────────────────────────────────────────
    await page.evaluate(({ account, user, pass }) => {
      document.getElementById('login_DealerNumber').value = account;
      document.getElementById('login_UserName').value = user;
      document.getElementById('login_Password').value = pass;
      var btn = document.querySelector('input[value*="Login"]');
      if (btn) { btn.disabled = false; btn.click(); }
    }, { account: PT_ACCOUNT, user: PT_USER, pass: PT_PASS });

    await waitForNav(page);
  }

  // Skip EliteRenewalCheck if present
  const skipBtn = await page.$('input[value*="Skip"]');
  if (skipBtn) {
    console.log('  Skipping Elite renewal check...');
    await page.evaluate(() => {
      var btn = document.querySelector('input[value*="Skip"]');
      if (btn) { btn.disabled = false; btn.click(); }
    });
    await waitForNav(page);
  }

  const finalUrl = page.url();
  if (finalUrl.includes('CustomerRpt') || finalUrl.includes('Dashboard') || finalUrl.includes('Default')) {
    console.log('✅ Logged in — on Dashboard. Starting automation...');
    return true;
  }

  console.log('⚠️  Login may have issues — current URL:', finalUrl);
  return true;
}

// ── Search from Dashboard ────────────────────────────────────────────────────

async function searchBySerial(page, serial) {
  console.log(`  🔍 Searching for serial: ${serial}`);

  // Navigate to dashboard first to establish session
  await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/CustomerRpt.aspx', { waitUntil: 'networkidle' });
  await sleep(2000);

  // Check if we're on the right page
  const searchExists = await page.$('#searchCustomerCTL_searchTxt');
  if (!searchExists) {
    console.log('  ⚠️  Not on Dashboard — trying to navigate...');
    await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/CustomerRpt.aspx', { waitUntil: 'networkidle' });
    await sleep(2000);
  }

  // Set search to Serial Number and search
  await page.evaluate((serial) => {
    document.getElementById('searchCustomerCTL_searchCustomerDDL').value = 'SerialNumber';
    document.getElementById('searchCustomerCTL_searchTxt').value = serial;
    document.getElementById('searchCustomerCTL_searchBtn').click();
  }, serial);

  await waitForNav(page);
  await sleep(2000);

  const currentUrl = page.url();

  if (currentUrl.includes('ViewDetail.aspx')) {
    return 'found';
  } else if (currentUrl.includes('CustomerSearchListing.aspx')) {
    // Check if there are results or "no records"
    const noRecords = await page.evaluate(() => {
      const body = document.body.innerText;
      return body.includes('No records found') || body.includes('0 records');
    });
    if (noRecords) return 'not_found';
    // There might be results — click the first one
    const firstLink = await page.$('#MainContent_gvCustomers a');
    if (firstLink) {
      await firstLink.click();
      await waitForNav(page);
      if (page.url().includes('ViewDetail.aspx')) return 'found';
    }
    return 'not_found';
  }

  return 'not_found';
}

// ── Path A: Record Found — Edit existing ─────────────────────────────────────

async function editExistingRecord(page, deal) {
  console.log(`  📝 Editing existing record for ${deal.serial}...`);

  // Check for health issues
  const health = await page.evaluate(() => {
    const text = document.body.innerText;
    const issues = [];
    if (/Battery\s*(Fair|Low)/i.test(text)) issues.push('Battery issue');
    if (/Airtime\s*Expired/i.test(text)) issues.push('Airtime expired');
    if (/Expiring\s*Soon/i.test(text)) issues.push('Airtime expiring soon');
    if (/Not\s*Active/i.test(text)) issues.push('Device not active');
    return issues;
  });

  if (health.length) {
    console.log(`  ⚠️  Health issues: ${health.join(', ')}`);
  }

  // Open edit form via postback
  await page.evaluate(() => {
    WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
      "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
    ));
  });
  await waitForNav(page);
  await sleep(1500);

  // Fill the edit form
  await page.evaluate((d) => {
    var el;
    el = document.getElementById('MainContent_eAccountNumber'); if (el) el.value = d.account;
    el = document.getElementById('MainContent_efirstname'); if (el) el.value = d.firstName;
    el = document.getElementById('MainContent_elastname'); if (el) el.value = d.lastName;
    el = document.getElementById('MainContent_eVIN'); if (el) el.value = d.vin;
    el = document.getElementById('MainContent_eColor'); if (el) el.value = d.color;
    el = document.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = d.account;
  }, deal);

  await sleep(500);

  // Submit
  await page.evaluate(() => {
    document.getElementById('MainContent_btnEditSubmit').click();
  });
  await waitForNav(page);

  const finalUrl = page.url();
  if (finalUrl.includes('ViewDetail.aspx')) {
    console.log(`  ✅ Successfully updated record for ${deal.serial}`);
    return true;
  }

  console.log(`  ❌ Edit may have failed — URL: ${finalUrl}`);
  return false;
}

// ── Path B: No Record — Add new ──────────────────────────────────────────────

async function addNewRecord(page, deal) {
  console.log(`  ➕ Adding new record for ${deal.serial}...`);

  // Navigate to Add.aspx
  await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/Add.aspx', { waitUntil: 'networkidle' });
  await sleep(2000);

  // Click Encore image — do NOT navigate directly to addelite.aspx
  const imgEncore = await page.$('#MainContent_imgEncore');
  if (!imgEncore) {
    console.log('  ❌ Encore image not found on Add page');
    return false;
  }

  await page.evaluate(() => {
    document.getElementById('MainContent_imgEncore').click();
  });
  await waitForNav(page);
  await sleep(2000);

  // Verify we're on addelite.aspx
  if (!page.url().includes('addelite.aspx')) {
    console.log('  ❌ Did not reach addelite.aspx — URL:', page.url());
    return false;
  }

  // Check if serial is in the dropdown
  const serialInDropdown = await page.evaluate((serial) => {
    var dd = document.getElementById('MainContent_DropDownList1');
    if (!dd) return false;
    for (var i = 0; i < dd.options.length; i++) {
      if (dd.options[i].value === serial || dd.options[i].text === serial) return true;
    }
    return false;
  }, deal.serial);

  if (!serialInDropdown) {
    console.log(`  ⏭️  Serial ${deal.serial} not in Passtime inventory — skipping`);
    return 'skip_not_in_inventory';
  }

  // Fill the add form
  await page.evaluate((d) => {
    document.getElementById('MainContent_txtInstallerFName').value = 'Vladimir';
    document.getElementById('MainContent_txtInstallerLName').value = 'Arutyunov';
    document.getElementById('MainContent_DropDownList1').value = d.serial;
    document.getElementById('MainContent_AccountNumber').value = d.account;
    document.getElementById('MainContent_firstname').value = d.firstName;
    document.getElementById('MainContent_lastname').value = d.lastName;
    document.getElementById('MainContent_VIN').value = d.vin;
    document.getElementById('MainContent_Color').value = d.color;
    document.getElementById('MainContent_btnAddCust').click();
  }, deal);

  await waitForNav(page);
  await sleep(2000);

  const finalUrl = page.url();
  if (finalUrl.toLowerCase().includes('viewdetail.aspx')) {
    console.log(`  ✅ Successfully added record for ${deal.serial}`);
    return true;
  }

  // Check for OASIS error
  const hasError = await page.evaluate(() => {
    return document.body.innerText.includes('OASIS Error') || document.body.innerText.includes('msg=4');
  });

  if (hasError) {
    console.log(`  ❌ OASIS Error during add — will retry after session reset`);
    return 'oasis_error';
  }

  console.log(`  ❌ Add may have failed — URL: ${finalUrl}`);
  return false;
}

// ── Process Single Deal ──────────────────────────────────────────────────────

async function processDeal(page, deal) {
  console.log(`\n═══ Processing: ${deal.firstName} ${deal.lastName} | Serial: ${deal.serial} | VIN: ${deal.vin} ═══`);

  if (!deal.serial) {
    console.log('  ⏭️  No GPS serial — skipping');
    skipLog.push({ id: deal.id, name: `${deal.firstName} ${deal.lastName}`, reason: 'No GPS serial number' });
    return false;
  }

  // Step 3: Search from Dashboard to establish session
  const searchResult = await searchBySerial(page, deal.serial);

  if (searchResult === 'found') {
    // Path A: Edit existing record
    const success = await editExistingRecord(page, deal);
    return success === true;
  } else {
    // Path B: Add new record
    const result = await addNewRecord(page, deal);

    if (result === 'skip_not_in_inventory') {
      skipLog.push({ id: deal.id, name: `${deal.firstName} ${deal.lastName}`, serial: deal.serial, reason: 'Serial not in Passtime inventory' });
      return false;
    }

    if (result === 'oasis_error') {
      // Re-establish session and retry once
      console.log('  🔄 Re-establishing session...');
      await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/CustomerRpt.aspx', { waitUntil: 'networkidle' });
      await sleep(2000);
      const retrySearch = await searchBySerial(page, deal.serial);
      if (retrySearch === 'found') {
        return (await editExistingRecord(page, deal)) === true;
      } else {
        const retryAdd = await addNewRecord(page, deal);
        return retryAdd === true;
      }
    }

    return result === true;
  }
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🚀 GPS Sync starting...\n');

  if (!SB_URL || !SB_KEY) {
    console.error('❌ Missing SUPABASE_URL or SUPABASE_KEY');
    process.exit(1);
  }
  if (!PT_PASS) {
    console.error('❌ Missing PASSTIME_PASS');
    process.exit(1);
  }

  // Step 1: Get unprocessed finance deals with GPS serials
  console.log('📡 Fetching deals from Supabase...');
  const deals = await sbGet('deals', 'deal_type=eq.finance&gps_uploaded=eq.false&order=created_at.asc');

  // Filter to only deals that have a GPS serial
  const dealsWithGps = deals.filter(d => {
    return (d.gps_serial || '').trim().length > 0;
  });

  console.log(`Found ${deals.length} unprocessed finance deals, ${dealsWithGps.length} with GPS serials\n`);

  if (!dealsWithGps.length) {
    console.log('✅ Nothing to process — all GPS registrations are up to date');
    return;
  }

  // Launch browser — headed in local mode so you can do 2FA
  console.log(LOCAL_MODE ? '🖥️  Local mode — opening browser window...' : '🤖 CI mode — headless browser');
  const browser = await chromium.launch({ headless: !LOCAL_MODE });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    viewport: LOCAL_MODE ? { width: 1280, height: 900 } : undefined
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    // Step 2: Login to Passtime
    const loggedIn = await passtimeLogin(page);
    if (!loggedIn) {
      console.error('❌ Failed to login to Passtime');
      await browser.close();
      process.exit(1);
    }

    // Process each deal
    for (const rawDeal of dealsWithGps) {
      const deal = parseDeal(rawDeal);

      try {
        const success = await processDeal(page, deal);

        if (success) {
          // Step 5: Mark done in Supabase
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          successLog.push({ id: deal.id, name: `${deal.firstName} ${deal.lastName}`, serial: deal.serial });
          console.log(`  📤 Marked gps_uploaded = true in Supabase`);
        }
      } catch (err) {
        console.error(`  ❌ Error processing deal ${deal.id}: ${err.message}`);
        skipLog.push({ id: deal.id, name: `${deal.firstName} ${deal.lastName}`, serial: deal.serial, reason: err.message });
      }

      // Small delay between records
      await sleep(2000);
    }
  } finally {
    await browser.close();
  }

  // Summary
  console.log('\n\n════════════════════════════════════════');
  console.log('📊 GPS SYNC SUMMARY');
  console.log('════════════════════════════════════════');
  console.log(`✅ Successful: ${successLog.length}`);
  successLog.forEach(s => console.log(`   • ${s.name} — Serial: ${s.serial}`));
  console.log(`⏭️  Skipped: ${skipLog.length}`);
  skipLog.forEach(s => console.log(`   • ${s.name} — ${s.reason}${s.serial ? ' (Serial: ' + s.serial + ')' : ''}`));
  console.log('════════════════════════════════════════\n');

  if (LOCAL_MODE) {
    console.log('Press any key to close...');
    await new Promise(resolve => process.stdin.once('data', resolve));
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  if (LOCAL_MODE) {
    console.log('\nPress any key to close...');
    process.stdin.once('data', () => process.exit(1));
  } else {
    process.exit(1);
  }
});
