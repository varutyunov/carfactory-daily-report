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

function promptUser(question) {
  const readline = require('readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise(resolve => rl.question(question, ans => { rl.close(); resolve(ans); }));
}

// ── Passtime Login ───────────────────────────────────────────────────────────

async function passtimeLogin(page) {
  console.log('🔐 Opening Passtime OASIS login...');
  await page.goto(PASSTIME_URL, { waitUntil: 'networkidle' });
  await sleep(2000);

  if (LOCAL_MODE) {
    // ── Local: Auto-fill login, handle 2FA if it appears ─────────────────
    console.log('  Filling login form...');
    await page.fill('#login_DealerNumber', PT_ACCOUNT);
    await page.fill('#login_UserName', PT_USER);
    await page.fill('#login_Password', PT_PASS);
    await sleep(500);

    // Submit via ASP.NET postback
    await page.evaluate(() => {
      if (typeof Page_Validators !== 'undefined') {
        for (var i = 0; i < Page_Validators.length; i++) Page_Validators[i].isvalid = true;
      }
      WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
        "login$LoginButton", "", true, "", "", false, true
      ));
    });
    await waitForNav(page, 30000);
    await sleep(2000);

    // Check if 2FA page appeared
    const post = page.url();
    if (!post.includes('CustomerRpt') && !post.includes('Dashboard') && !post.includes('Default') && !post.includes('EliteRenewalCheck')) {
      // Likely 2FA — look for a text input for the code
      const has2fa = await page.evaluate(() => {
        var inputs = document.querySelectorAll('input[type=text],input[type=number],input[type=tel]');
        for (var i = 0; i < inputs.length; i++) {
          var inp = inputs[i];
          if (inp.offsetParent !== null && !inp.id.includes('hidden')) return inp.id || inp.name || 'unknown';
        }
        return null;
      });

      if (has2fa) {
        console.log('');
        console.log('═══════════════════════════════════════════════════════════');
        console.log('   🔐 2FA REQUIRED — Enter 6-digit code from Google Auth');
        console.log('═══════════════════════════════════════════════════════════');
        const code = await promptUser('  Enter code: ');
        const trimmed = code.trim();

        // Find the visible text input and fill it
        await page.evaluate((val) => {
          var inputs = document.querySelectorAll('input[type=text],input[type=number],input[type=tel]');
          for (var i = 0; i < inputs.length; i++) {
            var inp = inputs[i];
            if (inp.offsetParent !== null && !inp.id.includes('hidden')) {
              inp.value = val;
              inp.dispatchEvent(new Event('input', {bubbles:true}));
              inp.dispatchEvent(new Event('change', {bubbles:true}));
              break;
            }
          }
        }, trimmed);
        await sleep(300);

        // Click the submit/verify button
        await page.evaluate(() => {
          var btns = document.querySelectorAll('input[type=submit],input[type=button],button[type=submit]');
          for (var i = 0; i < btns.length; i++) {
            var b = btns[i];
            var t = (b.value + ' ' + b.innerText).toLowerCase();
            if (t.includes('verify') || t.includes('submit') || t.includes('continue') || t.includes('confirm') || t.includes('login')) {
              b.click(); return;
            }
          }
          // Fallback — click first visible submit
          if (btns.length) btns[0].click();
        });
        await waitForNav(page, 30000);
        await sleep(2000);
      } else {
        // Unknown page — wait for manual intervention
        console.log('  ⚠️  Unexpected page after login:', post);
        console.log('  Complete login manually — script will resume when you reach the dashboard.');
        const maxWait = 300000;
        const start = Date.now();
        while (Date.now() - start < maxWait) {
          await sleep(3000);
          const u = page.url();
          if (u.includes('CustomerRpt') || u.includes('Dashboard') || u.includes('Default') || u.includes('EliteRenewalCheck')) break;
        }
      }
    }
  } else {
    // ── CI: Automated login ───────────────────────────────────────────────
    console.log('  Filling login form...');

    // Log what fields exist on the page
    const fieldCheck = await page.evaluate(() => {
      return {
        dealer: !!document.getElementById('login_DealerNumber'),
        user: !!document.getElementById('login_UserName'),
        pass: !!document.getElementById('login_Password'),
        btn: !!document.getElementById('login_LoginButton'),
        pageTitle: document.title,
        bodySnippet: document.body.innerText.substring(0, 300)
      };
    });
    console.log('  Page title:', fieldCheck.pageTitle);
    console.log('  Fields found — dealer:', fieldCheck.dealer, 'user:', fieldCheck.user, 'pass:', fieldCheck.pass, 'btn:', fieldCheck.btn);

    if (!fieldCheck.dealer || !fieldCheck.user || !fieldCheck.pass) {
      console.log('  ❌ Login form fields not found. Page content:', fieldCheck.bodySnippet);
      return false;
    }

    // Use Playwright fill() to set values with proper input events
    await page.fill('#login_DealerNumber', PT_ACCOUNT);
    await page.fill('#login_UserName', PT_USER);
    await page.fill('#login_Password', PT_PASS);
    await sleep(500);

    // Force ASP.NET validators to pass (they check .value but may not
    // recognize Playwright's programmatic input), then trigger postback
    await page.evaluate(() => {
      // Force all validators valid so postback proceeds
      if (typeof Page_Validators !== 'undefined') {
        for (var i = 0; i < Page_Validators.length; i++) {
          Page_Validators[i].isvalid = true;
        }
      }
      // Trigger the login postback directly (same as button onclick)
      WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
        "login$LoginButton", "", true, "", "", false, true
      ));
    });

    await waitForNav(page, 30000);
    await sleep(3000);

    // Log where we ended up
    console.log('  Post-login URL:', page.url());
    const postLoginText = await page.evaluate(() => document.body.innerText.substring(0, 500));
    console.log('  Post-login page text:', postLoginText.substring(0, 200));
  }

  // Handle post-login pages (2FA, security questions, renewal check, etc.)
  let attempts = 0;
  while (attempts < 5) {
    const currentUrl = page.url();
    attempts++;

    // Success — on dashboard
    if (currentUrl.includes('CustomerRpt') || currentUrl.includes('Dashboard') || currentUrl.includes('Default')) {
      console.log('✅ Logged in — on Dashboard. Starting automation...');
      return true;
    }

    // Skip EliteRenewalCheck if present
    if (currentUrl.includes('EliteRenewalCheck')) {
      console.log('  Skipping Elite renewal check...');
      const skipBtn = await page.$('input[value*="Skip"]');
      if (skipBtn) {
        await skipBtn.click();
        await waitForNav(page);
        continue;
      }
    }

    // Check for 2FA / verification page
    const pageText = await page.evaluate(() => document.body.innerText);
    if (/verification|security code|two.?factor|2fa|one.?time/i.test(pageText)) {
      console.log('  ❌ 2FA/verification page detected — cannot proceed in CI mode');
      console.log('  Page text:', pageText.substring(0, 300));
      return false;
    }

    // Check for invalid credentials
    if (/invalid|incorrect|wrong password|failed/i.test(pageText)) {
      console.log('  ❌ Invalid credentials — login rejected');
      return false;
    }

    // Still on login page
    if (currentUrl.includes('Login') || currentUrl.includes('login')) {
      console.log('  ⚠️  Still on login page after attempt. URL:', currentUrl);
      console.log('  Page text:', pageText.substring(0, 300));
      return false;
    }

    // Unknown page — log and try waiting
    console.log('  ⚠️  Unexpected page (attempt', attempts, '):', currentUrl);
    await sleep(3000);
  }

  console.log('⚠️  Login flow did not reach dashboard after', attempts, 'checks');
  return false;
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
  const launchOpts = { headless: !LOCAL_MODE };
  // In local mode, use system Chrome to avoid Playwright browser version issues
  if (LOCAL_MODE) {
    const fs = require('fs');
    const chromePaths = [
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      process.env.LOCALAPPDATA + '\\Google\\Chrome\\Application\\chrome.exe'
    ];
    for (const p of chromePaths) {
      if (fs.existsSync(p)) { launchOpts.executablePath = p; break; }
    }
    if (launchOpts.executablePath) {
      console.log('  Using system Chrome: ' + launchOpts.executablePath);
    }
  }
  const browser = await chromium.launch(launchOpts);
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
