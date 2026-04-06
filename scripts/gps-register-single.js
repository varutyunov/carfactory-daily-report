/**
 * GPS Register Single — Register one GPS device in Passtime OASIS
 *
 * Triggered by GitHub Actions with env vars:
 *   GPS_SERIAL, GPS_FIRST_NAME, GPS_LAST_NAME, GPS_ACCOUNT, GPS_VIN, GPS_COLOR
 *
 * Writes result to Supabase app_settings as gps_register_{serial}
 */

const { chromium } = require('playwright');

const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const PT_ACCOUNT = process.env.PASSTIME_ACCOUNT || '15270';
const PT_USER = process.env.PASSTIME_USER || 'Vladimir';
const PT_PASS = process.env.PASSTIME_PASS;
const PASSTIME_URL = 'https://secure.passtimeusa.com';

const SERIAL = (process.env.GPS_SERIAL || '').trim();
const FIRST_NAME = (process.env.GPS_FIRST_NAME || '').trim();
const LAST_NAME = (process.env.GPS_LAST_NAME || '').trim();
const ACCOUNT = (process.env.GPS_ACCOUNT || '').trim();
const VIN = (process.env.GPS_VIN || '').trim();
const COLOR = (process.env.GPS_COLOR || '').trim();

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
  const key = 'gps_register_' + SERIAL;
  const value = JSON.stringify(result);

  // Check if key exists
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

async function main() {
  console.log(`🚀 GPS Register Single: ${SERIAL}`);
  console.log(`   Customer: ${FIRST_NAME} ${LAST_NAME} | Account: ${ACCOUNT}`);
  console.log(`   VIN: ${VIN} | Color: ${COLOR}`);

  if (!SERIAL) { console.error('❌ No GPS_SERIAL'); process.exit(1); }
  if (!PT_PASS) { console.error('❌ No PASSTIME_PASS'); process.exit(1); }
  if (!SB_URL || !SB_KEY) { console.error('❌ No SUPABASE_URL/KEY'); process.exit(1); }

  // Write "processing" status
  await writeResult({ status: 'processing', serial: SERIAL, timestamp: new Date().toISOString() });

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  });
  const page = await context.newPage();
  page.setDefaultTimeout(20000);

  try {
    // ── Login ──
    console.log('🔐 Logging into Passtime...');
    await page.goto(PASSTIME_URL, { waitUntil: 'networkidle' });
    await sleep(2000);

    await page.evaluate(({ account, user, pass }) => {
      document.getElementById('login_DealerNumber').value = account;
      document.getElementById('login_UserName').value = user;
      document.getElementById('login_Password').value = pass;
      var btn = document.querySelector('input[value*="Login"]');
      if (btn) { btn.disabled = false; btn.click(); }
    }, { account: PT_ACCOUNT, user: PT_USER, pass: PT_PASS });

    await waitForNav(page);

    // Skip renewal check
    const skipBtn = await page.$('input[value*="Skip"]');
    if (skipBtn) {
      console.log('  Skipping renewal check...');
      await page.evaluate(() => {
        var btn = document.querySelector('input[value*="Skip"]');
        if (btn) { btn.disabled = false; btn.click(); }
      });
      await waitForNav(page);
    }

    const loginUrl = page.url();
    if (loginUrl.includes('Login')) {
      throw new Error('Login failed — still on login page');
    }
    console.log('✅ Logged in');

    // ── Search by serial ──
    console.log(`🔍 Searching for serial: ${SERIAL}`);
    await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/CustomerRpt.aspx', { waitUntil: 'networkidle' });
    await sleep(2000);

    await page.evaluate((serial) => {
      document.getElementById('searchCustomerCTL_searchCustomerDDL').value = 'SerialNumber';
      document.getElementById('searchCustomerCTL_searchTxt').value = serial;
      document.getElementById('searchCustomerCTL_searchBtn').click();
    }, SERIAL);

    await waitForNav(page);
    await sleep(2000);

    const currentUrl = page.url();

    if (currentUrl.includes('ViewDetail.aspx')) {
      // ── Found — edit ──
      console.log('📝 Device found — updating...');

      // Check health
      const health = await page.evaluate(() => {
        const text = document.body.innerText;
        const issues = [];
        if (/Battery\s*(Fair|Low)/i.test(text)) issues.push('Battery Low');
        if (/Battery\s*Critical/i.test(text)) issues.push('Battery Critical');
        if (/Airtime\s*Expired/i.test(text)) issues.push('Airtime expired');
        if (/Not\s*Active/i.test(text)) issues.push('Device not active');
        return issues;
      });

      await page.evaluate(() => {
        WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
          "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
        ));
      });
      await waitForNav(page);
      await sleep(1500);

      await page.evaluate((d) => {
        var el;
        el = document.getElementById('MainContent_eAccountNumber'); if (el) el.value = d.account;
        el = document.getElementById('MainContent_efirstname'); if (el) el.value = d.firstName;
        el = document.getElementById('MainContent_elastname'); if (el) el.value = d.lastName;
        el = document.getElementById('MainContent_eVIN'); if (el) el.value = d.vin;
        el = document.getElementById('MainContent_eColor'); if (el) el.value = d.color;
        el = document.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = d.account;
      }, { account: ACCOUNT, firstName: FIRST_NAME, lastName: LAST_NAME, vin: VIN, color: COLOR });

      await sleep(500);
      await page.evaluate(() => { document.getElementById('MainContent_btnEditSubmit').click(); });
      await waitForNav(page);

      if (page.url().includes('ViewDetail.aspx')) {
        console.log('✅ Device updated in Passtime');
        await writeResult({ status: 'success', action: 'updated', serial: SERIAL, health, message: 'Device updated in Passtime', timestamp: new Date().toISOString() });
      } else {
        throw new Error('Edit may have failed');
      }

    } else if (currentUrl.includes('CustomerSearchListing')) {
      // Check listing
      const noRecords = await page.evaluate(() => {
        return document.body.innerText.includes('No records found') || document.body.innerText.includes('0 records');
      });

      if (!noRecords) {
        const firstLink = await page.$('#MainContent_gvCustomers a');
        if (firstLink) {
          await firstLink.click();
          await waitForNav(page);
          if (page.url().includes('ViewDetail.aspx')) {
            // Same edit flow
            console.log('📝 Found via listing — updating...');
            await page.evaluate(() => {
              WebForm_DoPostBackWithOptions(new WebForm_PostBackOptions(
                "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
              ));
            });
            await waitForNav(page);
            await sleep(1500);

            await page.evaluate((d) => {
              var el;
              el = document.getElementById('MainContent_eAccountNumber'); if (el) el.value = d.account;
              el = document.getElementById('MainContent_efirstname'); if (el) el.value = d.firstName;
              el = document.getElementById('MainContent_elastname'); if (el) el.value = d.lastName;
              el = document.getElementById('MainContent_eVIN'); if (el) el.value = d.vin;
              el = document.getElementById('MainContent_eColor'); if (el) el.value = d.color;
              el = document.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = d.account;
            }, { account: ACCOUNT, firstName: FIRST_NAME, lastName: LAST_NAME, vin: VIN, color: COLOR });

            await sleep(500);
            await page.evaluate(() => { document.getElementById('MainContent_btnEditSubmit').click(); });
            await waitForNav(page);

            if (page.url().includes('ViewDetail.aspx')) {
              console.log('✅ Device updated in Passtime');
              await writeResult({ status: 'success', action: 'updated', serial: SERIAL, health: [], message: 'Device updated in Passtime', timestamp: new Date().toISOString() });
              await browser.close();
              return;
            }
          }
        }
      }

      // Not found — add new
      console.log('➕ Device not found — adding new...');
      await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/Add.aspx', { waitUntil: 'networkidle' });
      await sleep(2000);

      const imgEncore = await page.$('#MainContent_imgEncore');
      if (!imgEncore) throw new Error('Encore option not found on Add page');

      await page.evaluate(() => { document.getElementById('MainContent_imgEncore').click(); });
      await waitForNav(page);
      await sleep(2000);

      if (!page.url().includes('addelite')) throw new Error('Could not reach Encore add form');

      // Check serial in dropdown
      const serialInDD = await page.evaluate((serial) => {
        var dd = document.getElementById('MainContent_DropDownList1');
        if (!dd) return false;
        for (var i = 0; i < dd.options.length; i++) {
          if (dd.options[i].value === serial || dd.options[i].text === serial) return true;
        }
        return false;
      }, SERIAL);

      if (!serialInDD) {
        console.log(`⏭️ Serial ${SERIAL} not in Passtime inventory`);
        await writeResult({ status: 'error', serial: SERIAL, message: 'Serial ' + SERIAL + ' not in Passtime device inventory', timestamp: new Date().toISOString() });
        await browser.close();
        return;
      }

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
      }, { serial: SERIAL, account: ACCOUNT, firstName: FIRST_NAME, lastName: LAST_NAME, vin: VIN, color: COLOR });

      await waitForNav(page);
      await sleep(2000);

      if (page.url().toLowerCase().includes('viewdetail.aspx')) {
        console.log('✅ Device added to Passtime');
        await writeResult({ status: 'success', action: 'added', serial: SERIAL, health: [], message: 'Device added to Passtime', timestamp: new Date().toISOString() });
      } else {
        throw new Error('Add may have failed');
      }

    } else {
      // Not found at all — try add
      console.log('➕ Serial not found — adding new...');
      await page.goto(PASSTIME_URL + '/OCMSv2/CodeSite/Add.aspx', { waitUntil: 'networkidle' });
      await sleep(2000);

      const imgEncore2 = await page.$('#MainContent_imgEncore');
      if (!imgEncore2) throw new Error('Encore not found');

      await page.evaluate(() => { document.getElementById('MainContent_imgEncore').click(); });
      await waitForNav(page);
      await sleep(2000);

      const serialInDD2 = await page.evaluate((serial) => {
        var dd = document.getElementById('MainContent_DropDownList1');
        if (!dd) return false;
        for (var i = 0; i < dd.options.length; i++) {
          if (dd.options[i].value === serial || dd.options[i].text === serial) return true;
        }
        return false;
      }, SERIAL);

      if (!serialInDD2) {
        await writeResult({ status: 'error', serial: SERIAL, message: 'Serial not in Passtime inventory', timestamp: new Date().toISOString() });
        await browser.close();
        return;
      }

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
      }, { serial: SERIAL, account: ACCOUNT, firstName: FIRST_NAME, lastName: LAST_NAME, vin: VIN, color: COLOR });

      await waitForNav(page);

      if (page.url().toLowerCase().includes('viewdetail.aspx')) {
        console.log('✅ Device added to Passtime');
        await writeResult({ status: 'success', action: 'added', serial: SERIAL, health: [], message: 'Device added to Passtime', timestamp: new Date().toISOString() });
      } else {
        throw new Error('Add may have failed');
      }
    }

  } catch (err) {
    console.error('❌ Error:', err.message);
    await writeResult({ status: 'error', serial: SERIAL, message: err.message, timestamp: new Date().toISOString() });
  } finally {
    await browser.close();
  }
}

main();
