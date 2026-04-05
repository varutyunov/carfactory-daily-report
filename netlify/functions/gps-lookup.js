/**
 * GPS Lookup — Register/update GPS device in Passtime OASIS
 *
 * POST /gps-lookup
 * Body: { serial, firstName, lastName, account, vin, color }
 * Returns: { success, action, message, health[], log[] }
 */

const PASSTIME_URL = 'https://secure.passtimeusa.com';
const PT_ACCOUNT = process.env.PASSTIME_ACCOUNT || '15270';
const PT_USER = process.env.PASSTIME_USER || 'Vladimir';
const PT_PASS = process.env.PASSTIME_PASS;
const BASE = PASSTIME_URL + '/OCMSv2/CodeSite/';

// ── Simple cookie jar ───────────────────────────────────────────────────────

class CookieJar {
  constructor() { this.cookies = {}; }

  update(res) {
    const headers = res.headers;
    let raw = [];
    if (typeof headers.getSetCookie === 'function') {
      raw = headers.getSetCookie();
    } else if (headers.raw) {
      raw = headers.raw()['set-cookie'] || [];
    }
    for (const c of raw) {
      const semi = c.indexOf(';');
      const pair = semi > 0 ? c.substring(0, semi) : c;
      const eq = pair.indexOf('=');
      if (eq > 0) {
        this.cookies[pair.substring(0, eq).trim()] = pair.substring(eq + 1).trim();
      }
    }
  }

  toString() {
    return Object.entries(this.cookies).map(([k, v]) => k + '=' + v).join('; ');
  }
}

// ── HTTP helpers ────────────────────────────────────────────────────────────

async function httpGet(url, jar) {
  const res = await fetch(url, {
    headers: { Cookie: jar.toString() },
    redirect: 'follow'
  });
  jar.update(res);
  return { html: await res.text(), url: res.url };
}

async function httpPost(url, jar, formData) {
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Cookie: jar.toString()
    },
    body: formData,
    redirect: 'follow'
  });
  jar.update(res);
  return { html: await res.text(), url: res.url };
}

// ── ASP.NET form helpers ────────────────────────────────────────────────────

function extractInputs(html) {
  // Extract ALL input fields (hidden and visible)
  const fields = {};
  const re = /<input\s[^>]*>/gi;
  let match;
  while ((match = re.exec(html)) !== null) {
    const tag = match[0];
    const nameM = tag.match(/name\s*=\s*"([^"]+)"/i);
    const valM = tag.match(/value\s*=\s*"([^"]*)"/i);
    if (nameM) {
      fields[nameM[1]] = valM ? valM[1] : '';
    }
  }
  return fields;
}

function formEncode(obj) {
  return Object.entries(obj)
    .map(([k, v]) => encodeURIComponent(k) + '=' + encodeURIComponent(v || ''))
    .join('&');
}

// ── Parse ViewDetail for device health ──────────────────────────────────────

function parseHealth(html) {
  const issues = [];
  if (/Battery\s*(Fair|Low)/i.test(html)) issues.push('Battery Low');
  if (/Battery\s*Critical/i.test(html)) issues.push('Battery Critical');
  if (/Airtime\s*Expired/i.test(html)) issues.push('Airtime expired');
  if (/Expiring\s*Soon/i.test(html)) issues.push('Airtime expiring soon');
  if (/Not\s*Active/i.test(html)) issues.push('Device not active');
  return issues;
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
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'PASSTIME_PASS not configured in Netlify env vars' }) };
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

  const jar = new CookieJar();
  const log = [];

  try {
    // ── Step 1: Login ──────────────────────────────────────────────────────
    log.push('Loading login page...');
    const loginPage = await httpGet(PASSTIME_URL, jar);

    // Check if we got a login form
    if (!loginPage.html.includes('login') && !loginPage.html.includes('Login')) {
      log.push('No login form found at ' + loginPage.url);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Could not reach Passtime login page', log }) };
    }

    const loginInputs = extractInputs(loginPage.html);

    // Find the correct field names (ASP.NET uses $ separator in name, _ in id)
    // Common patterns: login$DealerNumber, ctl00$login$DealerNumber
    let dealerField = null, userField = null, passField = null, loginBtn = null;
    for (const key of Object.keys(loginInputs)) {
      if (/DealerNumber/i.test(key)) dealerField = key;
      if (/UserName/i.test(key) && !/remember/i.test(key)) userField = key;
      if (/Password/i.test(key)) passField = key;
      if (/Login.*Login|btnLogin|Login1/i.test(key)) loginBtn = key;
    }

    log.push('Form fields found: dealer=' + (dealerField||'NOT FOUND') + ', user=' + (userField||'NOT FOUND') + ', pass=' + (passField?'YES':'NOT FOUND') + ', btn=' + (loginBtn||'NOT FOUND'));

    if (!dealerField || !userField || !passField) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Login form fields not found', log }) };
    }

    // Build login form - start with hidden fields (ViewState etc)
    const loginForm = {};
    for (const [k, v] of Object.entries(loginInputs)) {
      if (k.startsWith('__')) loginForm[k] = v;
    }
    loginForm[dealerField] = PT_ACCOUNT;
    loginForm[userField] = PT_USER;
    loginForm[passField] = PT_PASS;
    if (loginBtn) loginForm[loginBtn] = 'Login';

    log.push('Submitting login...');
    const postLogin = await httpPost(loginPage.url || PASSTIME_URL + '/OCMSv2/Login.aspx', jar, formEncode(loginForm));

    log.push('Post-login URL: ' + (postLogin.url || 'unknown'));

    if (postLogin.html.includes('Invalid') || postLogin.html.includes('incorrect')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Passtime login failed - invalid credentials', log }) };
    }

    // Still on login page?
    if (postLogin.url && postLogin.url.includes('Login')) {
      log.push('Still on login page after submit');
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Login did not succeed - still on login page', log }) };
    }

    // Skip EliteRenewalCheck if present
    if ((postLogin.url && postLogin.url.includes('EliteRenewalCheck')) || postLogin.html.includes('EliteRenewalCheck')) {
      log.push('Skipping renewal check...');
      const skipInputs = extractInputs(postLogin.html);
      const skipForm = {};
      for (const [k, v] of Object.entries(skipInputs)) {
        if (k.startsWith('__')) skipForm[k] = v;
        if (/skip/i.test(v) || /skip/i.test(k)) skipForm[k] = v || 'Skip';
      }
      await httpPost(postLogin.url || BASE + 'EliteRenewalCheck.aspx', jar, formEncode(skipForm));
    }

    log.push('Logged in successfully');

    // ── Step 2: Search by serial ───────────────────────────────────────────
    log.push('Loading search page...');
    const searchPage = await httpGet(BASE + 'CustomerRpt.aspx', jar);

    if (searchPage.url && searchPage.url.includes('Login')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Session lost - redirected to login', log }) };
    }

    const searchInputs = extractInputs(searchPage.html);
    const searchForm = {};
    for (const [k, v] of Object.entries(searchInputs)) {
      if (k.startsWith('__')) searchForm[k] = v;
    }

    // Find search field names
    let searchDDL = null, searchTxt = null, searchBtn = null;
    for (const key of Object.keys(searchInputs)) {
      if (/searchCustomerDDL/i.test(key)) searchDDL = key;
      if (/searchTxt/i.test(key)) searchTxt = key;
      if (/searchBtn/i.test(key)) searchBtn = key;
    }

    // Also check for select elements (dropdown might be a <select> not <input>)
    const selectMatch = searchPage.html.match(/name\s*=\s*"([^"]*searchCustomerDDL[^"]*)"/i);
    if (selectMatch) searchDDL = selectMatch[1];

    log.push('Search fields: ddl=' + (searchDDL||'?') + ', txt=' + (searchTxt||'?') + ', btn=' + (searchBtn||'?'));

    if (searchDDL) searchForm[searchDDL] = 'SerialNumber';
    if (searchTxt) searchForm[searchTxt] = serial;
    if (searchBtn) searchForm[searchBtn] = 'Search';

    log.push('Searching for serial ' + serial + '...');
    const result = await httpPost(searchPage.url || BASE + 'CustomerRpt.aspx', jar, formEncode(searchForm));

    log.push('Search result URL: ' + (result.url || 'unknown'));

    // ── Step 3A: Found — edit existing record ──────────────────────────────
    if (result.url && result.url.includes('ViewDetail.aspx')) {
      log.push('Device found — editing...');
      const health = parseHealth(result.html);

      const editPage = await httpGet(BASE + 'ViewDetail.aspx?M=ED', jar);

      if (!editPage.html.includes('btnEditSubmit') && !editPage.html.includes('EditSubmit')) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Could not open edit form', health, log }) };
      }

      const editInputs = extractInputs(editPage.html);
      const editForm = {};
      for (const [k, v] of Object.entries(editInputs)) {
        if (k.startsWith('__')) editForm[k] = v;
      }

      // Set customer fields
      for (const [k] of Object.entries(editInputs)) {
        if (/eAccountNumber/i.test(k)) editForm[k] = account;
        if (/efirstname/i.test(k)) editForm[k] = firstName;
        if (/elastname/i.test(k)) editForm[k] = lastName;
        if (/eVIN/i.test(k)) editForm[k] = vin;
        if (/eColor/i.test(k)) editForm[k] = color;
        if (/eInventoryStockNumber/i.test(k)) editForm[k] = account;
        if (/btnEditSubmit/i.test(k)) editForm[k] = 'Submit';
      }

      log.push('Submitting edit...');
      const saveResult = await httpPost(editPage.url || BASE + 'ViewDetail.aspx?M=ED', jar, formEncode(editForm));

      if (saveResult.url && saveResult.url.includes('ViewDetail.aspx') && !saveResult.url.includes('M=ED')) {
        return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'updated', message: 'Device updated in Passtime', health, log }) };
      }

      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Edit may have failed', health, log }) };
    }

    // Check listing page
    if ((result.url && result.url.includes('CustomerSearchListing')) || result.html.includes('gvCustomers')) {
      if (!result.html.includes('No records found') && !result.html.includes('0 records')) {
        const linkMatch = result.html.match(/href="(ViewDetail\.aspx[^"]*)"/i);
        if (linkMatch) {
          const detail = await httpGet(BASE + linkMatch[1], jar);
          const health = parseHealth(detail.html);

          log.push('Found via listing — editing...');
          const editPage2 = await httpGet(BASE + 'ViewDetail.aspx?M=ED', jar);
          const editInputs2 = extractInputs(editPage2.html);
          const editForm2 = {};
          for (const [k, v] of Object.entries(editInputs2)) {
            if (k.startsWith('__')) editForm2[k] = v;
          }
          for (const [k] of Object.entries(editInputs2)) {
            if (/eAccountNumber/i.test(k)) editForm2[k] = account;
            if (/efirstname/i.test(k)) editForm2[k] = firstName;
            if (/elastname/i.test(k)) editForm2[k] = lastName;
            if (/eVIN/i.test(k)) editForm2[k] = vin;
            if (/eColor/i.test(k)) editForm2[k] = color;
            if (/eInventoryStockNumber/i.test(k)) editForm2[k] = account;
            if (/btnEditSubmit/i.test(k)) editForm2[k] = 'Submit';
          }

          const saveResult2 = await httpPost(editPage2.url || BASE + 'ViewDetail.aspx?M=ED', jar, formEncode(editForm2));
          if (saveResult2.url && saveResult2.url.includes('ViewDetail.aspx') && !saveResult2.url.includes('M=ED')) {
            return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'updated', message: 'Device updated in Passtime', health, log }) };
          }
          return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Edit via listing failed', health, log }) };
        }
      }
      // No results
      log.push('Serial not found in Passtime');
    }

    // ── Step 3B: Not found — add new ───────────────────────────────────────
    log.push('Adding new device...');
    const addPage = await httpGet(BASE + 'Add.aspx', jar);

    if (!addPage.html.includes('imgEncore')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Encore option not found on Add page', log }) };
    }

    // Click Encore image via form post
    const addInputs = extractInputs(addPage.html);
    const addForm = {};
    for (const [k, v] of Object.entries(addInputs)) {
      if (k.startsWith('__')) addForm[k] = v;
    }
    // Image button sends .x and .y coordinates
    for (const k of Object.keys(addInputs)) {
      if (/imgEncore/i.test(k)) {
        addForm[k + '.x'] = '50';
        addForm[k + '.y'] = '50';
      }
    }

    log.push('Opening Encore form...');
    const elitePage = await httpPost(addPage.url || BASE + 'Add.aspx', jar, formEncode(addForm));

    if (!elitePage.html.includes('DropDownList1') && !elitePage.html.includes('btnAddCust')) {
      log.push('Elite page URL: ' + (elitePage.url || 'unknown'));
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Could not reach Encore add form', log }) };
    }

    // Check if serial is in the dropdown
    const serialEscaped = serial.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (!new RegExp('value="' + serialEscaped + '"', 'i').test(elitePage.html) &&
        !new RegExp('>' + serialEscaped + '<', 'i').test(elitePage.html)) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Serial ' + serial + ' not in Passtime device inventory', log }) };
    }

    // Fill and submit
    const eliteInputs = extractInputs(elitePage.html);
    const eliteForm = {};
    for (const [k, v] of Object.entries(eliteInputs)) {
      if (k.startsWith('__')) eliteForm[k] = v;
    }
    for (const k of Object.keys(eliteInputs)) {
      if (/txtInstallerFName/i.test(k)) eliteForm[k] = 'Vladimir';
      if (/txtInstallerLName/i.test(k)) eliteForm[k] = 'Arutyunov';
      if (/DropDownList1/i.test(k)) eliteForm[k] = serial;
      if (/AccountNumber/i.test(k) && !/Dealer/i.test(k)) eliteForm[k] = account;
      if (/firstname/i.test(k) && !/Installer/i.test(k)) eliteForm[k] = firstName;
      if (/lastname/i.test(k) && !/Installer/i.test(k)) eliteForm[k] = lastName;
      if (/\bVIN\b/i.test(k)) eliteForm[k] = vin;
      if (/\bColor\b/i.test(k)) eliteForm[k] = color;
      if (/btnAddCust/i.test(k)) eliteForm[k] = 'Submit';
    }

    log.push('Submitting new device...');
    const addResult = await httpPost(elitePage.url || BASE + 'addelite.aspx', jar, formEncode(eliteForm));

    if (addResult.url && addResult.url.toLowerCase().includes('viewdetail.aspx')) {
      const health = parseHealth(addResult.html);
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: true, action: 'added', message: 'Device added to Passtime', health, log }) };
    }

    if (addResult.html.includes('OASIS Error') || addResult.html.includes('msg=4')) {
      return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'OASIS Error from Passtime', log }) };
    }

    log.push('Add result URL: ' + (addResult.url || 'unknown'));
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: 'Add may have failed', log }) };

  } catch(err) {
    log.push('Exception: ' + err.message);
    return { statusCode: 200, headers: cors, body: JSON.stringify({ success: false, error: err.message, log }) };
  }
};
