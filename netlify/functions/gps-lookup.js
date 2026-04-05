/**
 * GPS Lookup — Register/update GPS device in Passtime OASIS
 *
 * Logs into Passtime, searches by serial, edits or adds the record
 * with customer info from Car Factory.
 *
 * POST /gps-lookup
 * Body: { serial, firstName, lastName, account, vin, color }
 * Returns: { success, action, message, health[] }
 */

const PASSTIME_URL = 'https://secure.passtimeusa.com';
const PT_ACCOUNT = process.env.PASSTIME_ACCOUNT || '15270';
const PT_USER = process.env.PASSTIME_USER || 'Vladimir';
const PT_PASS = process.env.PASSTIME_PASS;
const BASE = PASSTIME_URL + '/OCMSv2/CodeSite/';

// ── Cookie jar helpers ──────────────────────────────────────────────────────

function parseCookies(res) {
  const cookies = {};
  const raw = res.headers.raw ? res.headers.raw()['set-cookie'] || [] : [];
  // Node 18+ getSetCookie
  const setCookies = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : raw;
  for (const c of setCookies) {
    const eq = c.indexOf('=');
    if (eq < 0) continue;
    const semi = c.indexOf(';', eq);
    const name = c.substring(0, eq).trim();
    const val = c.substring(eq + 1, semi > 0 ? semi : undefined).trim();
    if (name && !name.startsWith('__')) cookies[name] = val;
  }
  return cookies;
}

function cookieStr(jar) {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

// ── Fetch with cookie jar + manual redirect ─────────────────────────────────

async function cfetch(url, jar, opts) {
  opts = opts || {};
  const headers = Object.assign({}, opts.headers || {}, { Cookie: cookieStr(jar) });
  const res = await fetch(url, Object.assign({}, opts, { headers, redirect: 'manual' }));
  Object.assign(jar, parseCookies(res));

  if ([301, 302, 303, 307, 308].includes(res.status)) {
    const loc = res.headers.get('location');
    if (loc) {
      const next = loc.startsWith('http') ? loc : new URL(loc, url).href;
      return cfetch(next, jar, { headers: { Cookie: cookieStr(jar) } });
    }
  }
  return { res, url: res.url || url, html: await res.text() };
}

// ── ASP.NET helpers ─────────────────────────────────────────────────────────

function aspFields(html) {
  const fields = {};
  const re = /name="([^"]+)"[^>]*value="([^"]*)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    if (m[1].startsWith('__') || m[1].includes('VIEWSTATE') || m[1].includes('EVENTVALIDATION') || m[1].includes('GENERATOR')) {
      fields[m[1]] = m[2];
    }
  }
  // Also try value before name
  const re2 = /value="([^"]*)"[^>]*name="([^"]+)"/g;
  while ((m = re2.exec(html)) !== null) {
    if (m[2].startsWith('__') || m[2].includes('VIEWSTATE') || m[2].includes('EVENTVALIDATION')) {
      if (!fields[m[2]]) fields[m[2]] = m[1];
    }
  }
  return fields;
}

function encForm(fields) {
  return Object.entries(fields)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v || ''))
    .join('&');
}

// ── Parse ViewDetail for health/location data ───────────────────────────────

function parseHealth(html) {
  const health = [];
  if (/Battery\s*(Fair|Low)/i.test(html)) health.push('Battery Low');
  if (/Battery\s*Critical/i.test(html)) health.push('Battery Critical');
  if (/Airtime\s*Expired/i.test(html)) health.push('Airtime expired');
  if (/Expiring\s*Soon/i.test(html)) health.push('Airtime expiring soon');
  if (/Not\s*Active/i.test(html)) health.push('Device not active');
  return health;
}

// ── Main handler ────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  const cors = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json'
  };

  if (event.httpMethod === 'OPTIONS') return { statusCode: 200, headers: cors, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers: cors, body: '{"error":"POST only"}' };

  if (!PT_PASS) {
    return { statusCode: 500, headers: cors, body: '{"error":"PASSTIME_PASS not configured in Netlify env"}' };
  }

  let body;
  try { body = JSON.parse(event.body); } catch(e) {
    return { statusCode: 400, headers: cors, body: '{"error":"Invalid JSON"}' };
  }

  const serial = (body.serial || '').trim();
  if (!serial) return { statusCode: 400, headers: cors, body: '{"error":"Missing serial"}' };

  const firstName = (body.firstName || '').trim();
  const lastName = (body.lastName || '').trim();
  const account = (body.account || '').trim();
  const vin = (body.vin || '').trim();
  const color = (body.color || '').trim();

  const jar = {};
  const log = [];

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────
    log.push('Loading login page...');
    const loginPage = await cfetch(PASSTIME_URL, jar);

    const loginFields = aspFields(loginPage.html);
    loginFields['login$DealerNumber'] = PT_ACCOUNT;
    loginFields['login$UserName'] = PT_USER;
    loginFields['login$Password'] = PT_PASS;
    loginFields['login$Login'] = 'Login';

    log.push('Submitting login...');
    const postLogin = await cfetch(PASSTIME_URL + '/OCMSv2/Login.aspx', jar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encForm(loginFields)
    });

    if (postLogin.html.includes('Invalid') || postLogin.html.includes('incorrect') || postLogin.html.includes('Sign In')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Passtime login failed', log }) };
    }

    // Skip EliteRenewalCheck
    if (postLogin.url.includes('EliteRenewalCheck') || postLogin.html.includes('EliteRenewalCheck')) {
      log.push('Skipping renewal check...');
      const skipF = aspFields(postLogin.html);
      const skipMatch = postLogin.html.match(/name="([^"]*)"[^>]*value="Skip"/i);
      if (skipMatch) {
        skipF[skipMatch[1]] = 'Skip';
        await cfetch(PASSTIME_URL + '/OCMSv2/CodeSite/EliteRenewalCheck.aspx', jar, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: encForm(skipF)
        });
      }
    }

    log.push('Logged in');

    // ── Step 2: Search by serial ───────────────────────────────────────────
    log.push('Loading search page...');
    const searchPage = await cfetch(BASE + 'CustomerRpt.aspx', jar);
    const searchF = aspFields(searchPage.html);

    searchF['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'SerialNumber';
    searchF['ctl00$searchCustomerCTL$searchTxt'] = serial;
    searchF['ctl00$searchCustomerCTL$searchBtn'] = 'Search';

    log.push('Searching for serial ' + serial + '...');
    const result = await cfetch(BASE + 'CustomerRpt.aspx', jar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encForm(searchF)
    });

    // ── Step 3A: Found — edit existing record ──────────────────────────────
    if (result.url.includes('ViewDetail.aspx')) {
      log.push('Device found — opening edit...');
      const health = parseHealth(result.html);

      const editPage = await cfetch(BASE + 'ViewDetail.aspx?M=ED', jar);
      const editF = aspFields(editPage.html);

      if (!editPage.html.includes('btnEditSubmit')) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Could not open edit form', health, log }) };
      }

      editF['ctl00$MainContent$eAccountNumber'] = account;
      editF['ctl00$MainContent$efirstname'] = firstName;
      editF['ctl00$MainContent$elastname'] = lastName;
      editF['ctl00$MainContent$eVIN'] = vin;
      editF['ctl00$MainContent$eColor'] = color;
      editF['ctl00$MainContent$eInventoryStockNumber'] = account;
      editF['ctl00$MainContent$btnEditSubmit'] = 'Submit';

      log.push('Submitting update...');
      const saveResult = await cfetch(BASE + 'ViewDetail.aspx?M=ED', jar, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: encForm(editF)
      });

      if (saveResult.url.includes('ViewDetail.aspx') && !saveResult.url.includes('M=ED')) {
        log.push('Updated successfully');
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'updated', message: 'Device updated in Passtime', health, log }) };
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Edit submit may have failed', health, log }) };
    }

    // Check listing page
    if (result.url.includes('CustomerSearchListing') || result.html.includes('gvCustomers')) {
      if (!result.html.includes('No records found') && !result.html.includes('0 records')) {
        // Follow first result
        const linkMatch = result.html.match(/href="(ViewDetail\.aspx[^"]*)"/i);
        if (linkMatch) {
          const detail = await cfetch(BASE + linkMatch[1], jar);
          const health = parseHealth(detail.html);

          log.push('Device found via listing — editing...');
          const editPage2 = await cfetch(BASE + 'ViewDetail.aspx?M=ED', jar);
          const editF2 = aspFields(editPage2.html);

          editF2['ctl00$MainContent$eAccountNumber'] = account;
          editF2['ctl00$MainContent$efirstname'] = firstName;
          editF2['ctl00$MainContent$elastname'] = lastName;
          editF2['ctl00$MainContent$eVIN'] = vin;
          editF2['ctl00$MainContent$eColor'] = color;
          editF2['ctl00$MainContent$eInventoryStockNumber'] = account;
          editF2['ctl00$MainContent$btnEditSubmit'] = 'Submit';

          const saveResult2 = await cfetch(BASE + 'ViewDetail.aspx?M=ED', jar, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: encForm(editF2)
          });

          if (saveResult2.url.includes('ViewDetail.aspx') && !saveResult2.url.includes('M=ED')) {
            log.push('Updated successfully');
            return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'updated', message: 'Device updated in Passtime', health, log }) };
          }
          return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Edit via listing failed', health, log }) };
        }
      }
    }

    // ── Step 3B: Not found — add new ───────────────────────────────────────
    log.push('Device not found — adding new...');
    const addPage = await cfetch(BASE + 'Add.aspx', jar);

    // Find Encore link/image
    if (!addPage.html.includes('imgEncore') && !addPage.html.includes('Encore')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Encore option not found on Add page', log }) };
    }

    // Navigate to addelite via ASP.NET postback
    const addF = aspFields(addPage.html);
    addF['ctl00$MainContent$imgEncore.x'] = '50';
    addF['ctl00$MainContent$imgEncore.y'] = '50';

    log.push('Opening Encore add form...');
    const elitePage = await cfetch(BASE + 'Add.aspx', jar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encForm(addF)
    });

    if (!elitePage.url.includes('addelite') && !elitePage.html.includes('DropDownList1')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Could not reach Encore add form', log }) };
    }

    // Check if serial is in the dropdown
    const ddRegex = new RegExp('value="' + serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '"', 'i');
    if (!ddRegex.test(elitePage.html)) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Serial ' + serial + ' not found in Passtime inventory — device may not be registered', log }) };
    }

    // Fill and submit
    const eliteF = aspFields(elitePage.html);
    eliteF['ctl00$MainContent$txtInstallerFName'] = 'Vladimir';
    eliteF['ctl00$MainContent$txtInstallerLName'] = 'Arutyunov';
    eliteF['ctl00$MainContent$DropDownList1'] = serial;
    eliteF['ctl00$MainContent$AccountNumber'] = account;
    eliteF['ctl00$MainContent$firstname'] = firstName;
    eliteF['ctl00$MainContent$lastname'] = lastName;
    eliteF['ctl00$MainContent$VIN'] = vin;
    eliteF['ctl00$MainContent$Color'] = color;
    eliteF['ctl00$MainContent$btnAddCust'] = 'Submit';

    log.push('Submitting new device...');
    const addResult = await cfetch(BASE + 'addelite.aspx', jar, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: encForm(eliteF)
    });

    if (addResult.url.toLowerCase().includes('viewdetail.aspx')) {
      log.push('Added successfully');
      const health = parseHealth(addResult.html);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'added', message: 'Device added to Passtime', health, log }) };
    }

    if (addResult.html.includes('OASIS Error') || addResult.html.includes('msg=4')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'OASIS Error — try again', log }) };
    }

    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Add may have failed', log }) };

  } catch(err) {
    log.push('Error: ' + err.message);
    return { statusCode: 500, headers: cors, body: JSON.stringify({ success: false, error: err.message, log }) };
  }
};
