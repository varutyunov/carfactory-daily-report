/**
 * GPS Fetch Single — Pull device info FROM Passtime OASIS
 *
 * Triggered by GitHub Actions with env vars:
 *   GPS_ACCOUNT    — CarPay account number (required, used as result key)
 *   GPS_LAST_NAME  — Customer last name to search by
 *   GPS_FIRST_NAME — Customer first name (for matching if multiple results)
 *
 * Logs into Passtime, searches by last name, finds the matching customer,
 * scrapes the ViewDetail page for battery, location, serial, etc.
 * Writes result to Supabase app_settings as gps_fetch_{account}
 * AND creates/updates repo_gps_signals entry.
 */

const { chromium } = require('playwright');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const PT_ACCOUNT = process.env.PASSTIME_ACCOUNT || '15270';
const PT_USER = process.env.PASSTIME_USER || 'Vladimir';
const PT_PASS = process.env.PASSTIME_PASS;
const PASSTIME_URL = 'https://secure.passtimeusa.com';

const ACCOUNT = (process.env.GPS_ACCOUNT || '').trim();
const LAST_NAME = (process.env.GPS_LAST_NAME || '').trim();
const FIRST_NAME = (process.env.GPS_FIRST_NAME || '').trim();

const SB_HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function waitForNav(page, timeout = 15000) {
  await page.waitForLoadState('networkidle', { timeout }).catch(() => {});
  await sleep(1000);
}

// Write result to Supabase app_settings
async function writeResult(result) {
  const key = 'gps_fetch_' + ACCOUNT;
  const value = JSON.stringify(result);

  const getRes = await fetch(`${SB_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, {
    headers: { ...SB_HEADERS, 'Cache-Control': 'no-cache' }
  });
  const existing = await getRes.json();

  if (existing && existing.length > 0) {
    await fetch(`${SB_URL}/rest/v1/app_settings?id=eq.${existing[0].id}`, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify({ value })
    });
  } else {
    await fetch(`${SB_URL}/rest/v1/app_settings`, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify({ key, value })
    });
  }
  console.log('📤 Result written to Supabase:', key);
}

// Update repo_gps_signals with fetched data
async function updateGpsSignal(data) {
  const payload = {
    account: ACCOUNT,
    customer_name: data.customerName || '',
    out_of_state: data.outOfState || false,
    last_state: data.state || 'FL',
    last_address: data.lastAddress || null,
    days_since_move: data.daysSinceMove || 0,
    battery_low: data.batteryLow || false,
    battery_status: data.batteryStatus || 'Unknown',
    updated_at: new Date().toISOString(),
    updated_by: 'Passtime Fetch'
  };

  try {
    await fetch(`${SB_URL}/rest/v1/repo_gps_signals`, {
      method: 'POST',
      headers: { ...SB_HEADERS, 'Prefer': 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify(payload)
    });
    console.log('📤 Updated repo_gps_signals for account:', ACCOUNT);
  } catch (e) {
    console.error('Failed to update repo_gps_signals:', e.message);
  }
}

// Save serial to vehicle cache in app_settings
async function saveSerialToCache(serial) {
  const key = 'repo_vehicle_' + ACCOUNT;
  try {
    const getRes = await fetch(`${SB_URL}/rest/v1/app_settings?key=eq.${encodeURIComponent(key)}`, {
      headers: { ...SB_HEADERS, 'Cache-Control': 'no-cache' }
    });
    const rows = await getRes.json();
    let existing = {};
    if (rows && rows.length && rows[0].value) {
      try { existing = JSON.parse(rows[0].value); } catch (e) {}
    }
    existing.gps_serial = serial;
    const value = JSON.stringify(existing);
    if (rows && rows.length) {
      await fetch(`${SB_URL}/rest/v1/app_settings?id=eq.${rows[0].id}`, {
        method: 'PATCH', headers: SB_HEADERS, body: JSON.stringify({ value })
      });
    } else {
      await fetch(`${SB_URL}/rest/v1/app_settings`, {
        method: 'POST', headers: SB_HEADERS, body: JSON.stringify({ key, value })
      });
    }
    console.log('📤 Saved serial to vehicle cache:', serial);
  } catch (e) {
    console.error('Failed to save serial to cache:', e.message);
  }
}

async function main() {
  console.log(`🔍 GPS Fetch: searching for "${LAST_NAME}" (account: ${ACCOUNT})`);

  if (!ACCOUNT) { console.error('❌ No GPS_ACCOUNT'); process.exit(1); }
  if (!LAST_NAME) { console.error('❌ No GPS_LAST_NAME'); process.exit(1); }
  if (!PT_PASS) { console.error('❌ No PASSTIME_PASS'); process.exit(1); }
  if (!SB_URL || !SB_KEY) { console.error('❌ No SUPABASE_URL/KEY'); process.exit(1); }

  await writeResult({ status: 'processing', account: ACCOUNT, timestamp: new Date().toISOString() });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    // ── Login ──
    console.log('🔐 Logging into Passtime...');
    console.log('  Account:', PT_ACCOUNT, '| User:', PT_USER, '| Pass length:', (PT_PASS||'').length);
    await page.goto(PASSTIME_URL, { waitUntil: 'networkidle' });
    await sleep(3000);

    // Check if login form elements exist
    const formCheck = await page.evaluate(() => {
      return {
        dealer: !!document.getElementById('login_DealerNumber'),
        user: !!document.getElementById('login_UserName'),
        pass: !!document.getElementById('login_Password'),
        btn: !!document.querySelector('input[value*="Login"]'),
        url: window.location.href,
        title: document.title
      };
    });
    console.log('  Form check:', JSON.stringify(formCheck));

    // Fill and submit using individual field interactions for reliability
    await page.fill('#login_DealerNumber', PT_ACCOUNT);
    await page.fill('#login_UserName', PT_USER);
    await page.fill('#login_Password', PT_PASS);
    await sleep(500);

    // Click login button
    const loginBtn = await page.$('input[value*="Login"]');
    if (loginBtn) {
      await loginBtn.click();
    } else {
      // Fallback: try submit via evaluate
      await page.evaluate(() => {
        var btn = document.querySelector('input[value*="Login"]');
        if (btn) { btn.disabled = false; btn.click(); }
      });
    }

    await waitForNav(page);
    await sleep(3000);

    // Skip renewal check
    const skipBtn = await page.$('input[value*="Skip"]');
    if (skipBtn) {
      console.log('  Skipping renewal check...');
      await skipBtn.click();
      await waitForNav(page);
    }

    const postLoginUrl = page.url();
    console.log('  Post-login URL:', postLoginUrl);

    if (postLoginUrl.includes('Login')) {
      // Grab any error message on the page
      const pageError = await page.evaluate(() => {
        var err = document.querySelector('.error, .validation-summary-errors, [id*="Error"], [id*="error"], .alert');
        return err ? err.innerText : document.body.innerText.substring(0, 500);
      });
      console.log('  Page content:', pageError);
      throw new Error('Login failed — still on login page');
    }
    console.log('✅ Logged in');

    // ── Search by last name ──
    console.log(`🔍 Searching by last name: ${LAST_NAME}`);
    await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/CustomerRpt.aspx', { waitUntil: 'networkidle' });
    await sleep(2000);

    await page.evaluate((lastName) => {
      document.getElementById('searchCustomerCTL_searchCustomerDDL').value = 'LastName';
      document.getElementById('searchCustomerCTL_searchTxt').value = lastName;
      document.getElementById('searchCustomerCTL_searchBtn').click();
    }, LAST_NAME);

    await waitForNav(page);
    await sleep(2000);

    const currentUrl = page.url();
    let detailReached = false;

    if (currentUrl.includes('ViewDetail.aspx')) {
      // Only one result — went straight to detail
      detailReached = true;
    } else if (currentUrl.includes('CustomerSearchListing')) {
      const noRecords = await page.evaluate(() => {
        return document.body.innerText.includes('No records found') || document.body.innerText.includes('0 records');
      });

      if (!noRecords) {
        // Multiple results — try to match by first name or account
        const matched = await page.evaluate(({ firstName, account }) => {
          var rows = document.querySelectorAll('#MainContent_gvCustomers tr');
          var bestLink = null;
          for (var i = 1; i < rows.length; i++) {
            var cells = rows[i].querySelectorAll('td');
            var rowText = rows[i].innerText.toLowerCase();
            var link = rows[i].querySelector('a');
            if (!link) continue;

            // Check if account number matches
            if (account && rowText.includes(account.toLowerCase())) {
              link.click();
              return true;
            }
            // Check if first name matches
            if (firstName && rowText.includes(firstName.toLowerCase())) {
              if (!bestLink) bestLink = link;
            }
          }
          // Click best match or first result
          if (bestLink) { bestLink.click(); return true; }
          var firstLink = document.querySelector('#MainContent_gvCustomers a');
          if (firstLink) { firstLink.click(); return true; }
          return false;
        }, { firstName: FIRST_NAME, account: ACCOUNT });

        if (matched) {
          await waitForNav(page);
          if (page.url().includes('ViewDetail.aspx')) detailReached = true;
        }
      }
    }

    if (!detailReached) {
      console.log('❌ Customer not found in Passtime');
      await writeResult({
        status: 'error',
        account: ACCOUNT,
        message: 'Customer "' + LAST_NAME + '" not found in Passtime',
        timestamp: new Date().toISOString()
      });
      await browser.close();
      return;
    }

    // ── Scrape ViewDetail page ──
    console.log('📋 Scraping device details...');

    const deviceInfo = await page.evaluate(() => {
      const text = document.body.innerText;
      const info = {};

      const getById = (id) => {
        var el = document.getElementById(id);
        return el ? (el.value || el.innerText || '').trim() : '';
      };

      // Customer name
      info.firstName = getById('MainContent_vFirstName') || getById('MainContent_efirstname') || '';
      info.lastName = getById('MainContent_vLastName') || getById('MainContent_elastname') || '';
      if (!info.firstName && !info.lastName) {
        var nameEl = document.querySelector('[id*="FirstName"], [id*="firstname"]');
        if (nameEl) info.firstName = (nameEl.value || nameEl.innerText || '').trim();
        nameEl = document.querySelector('[id*="LastName"], [id*="lastname"]');
        if (nameEl) info.lastName = (nameEl.value || nameEl.innerText || '').trim();
      }

      info.account = getById('MainContent_vAccountNumber') || getById('MainContent_eAccountNumber') || '';
      info.vin = getById('MainContent_vVIN') || getById('MainContent_eVIN') || '';
      info.color = getById('MainContent_vColor') || getById('MainContent_eColor') || '';
      info.serial = getById('MainContent_vSerialNumber') || '';

      // Battery status
      info.batteryStatus = 'Unknown';
      info.batteryLow = false;
      if (/Battery\s*Good/i.test(text)) { info.batteryStatus = 'Good'; }
      else if (/Battery\s*Fair/i.test(text)) { info.batteryStatus = 'Fair'; info.batteryLow = true; }
      else if (/Battery\s*Low/i.test(text)) { info.batteryStatus = 'Low'; info.batteryLow = true; }
      else if (/Battery\s*Critical/i.test(text)) { info.batteryStatus = 'Critical'; info.batteryLow = true; }

      // Health issues
      info.health = [];
      if (/Battery\s*(Fair|Low)/i.test(text)) info.health.push('Battery Low');
      if (/Battery\s*Critical/i.test(text)) info.health.push('Battery Critical');
      if (/Airtime\s*Expired/i.test(text)) info.health.push('Airtime expired');
      if (/Expiring\s*Soon/i.test(text)) info.health.push('Airtime expiring soon');
      if (/Not\s*Active/i.test(text)) info.health.push('Device not active');

      // Last location
      var locEl = document.querySelector('[id*="Location"], [id*="Address"], [id*="LastReport"]');
      info.lastAddress = locEl ? (locEl.value || locEl.innerText || '').trim() : '';

      // State detection
      info.state = 'FL';
      info.outOfState = false;
      if (info.lastAddress) {
        var stateMatch = info.lastAddress.match(/,\s*([A-Z]{2})\s*\d{5}/);
        if (stateMatch) {
          info.state = stateMatch[1];
          info.outOfState = (stateMatch[1] !== 'FL');
        }
      }

      // Days since last report
      info.daysSinceMove = 0;
      var dateMatch = text.match(/Last\s*(?:Report|Location|Signal|Update)\s*[:\-]?\s*(\d{1,2}\/\d{1,2}\/\d{2,4})/i);
      if (dateMatch) {
        try {
          var reportDate = new Date(dateMatch[1]);
          var now = new Date();
          info.daysSinceMove = Math.floor((now - reportDate) / (1000 * 60 * 60 * 24));
        } catch (e) {}
      }

      return info;
    });

    console.log('📋 Device info:', JSON.stringify(deviceInfo, null, 2));

    const customerName = [deviceInfo.lastName, deviceInfo.firstName].filter(Boolean).join(', ');

    // Update repo_gps_signals
    await updateGpsSignal({
      customerName: customerName,
      outOfState: deviceInfo.outOfState,
      state: deviceInfo.state,
      lastAddress: deviceInfo.lastAddress,
      daysSinceMove: deviceInfo.daysSinceMove,
      batteryLow: deviceInfo.batteryLow,
      batteryStatus: deviceInfo.batteryStatus
    });

    // Save serial to vehicle cache if found
    if (deviceInfo.serial) {
      await saveSerialToCache(deviceInfo.serial);
    }

    // Write success result
    await writeResult({
      status: 'success',
      account: ACCOUNT,
      serial: deviceInfo.serial || '',
      customerName: customerName,
      firstName: deviceInfo.firstName,
      lastName: deviceInfo.lastName,
      vin: deviceInfo.vin,
      color: deviceInfo.color,
      batteryStatus: deviceInfo.batteryStatus,
      batteryLow: deviceInfo.batteryLow,
      health: deviceInfo.health,
      lastAddress: deviceInfo.lastAddress,
      state: deviceInfo.state,
      outOfState: deviceInfo.outOfState,
      daysSinceMove: deviceInfo.daysSinceMove,
      message: 'GPS data fetched from Passtime',
      timestamp: new Date().toISOString()
    });

    console.log('✅ Device info fetched successfully');

  } catch (err) {
    console.error('❌ Error:', err.message);
    await writeResult({ status: 'error', account: ACCOUNT, message: err.message, timestamp: new Date().toISOString() });
  } finally {
    await browser.close();
  }
}

main();
