/**
 * GPS Sync Bookmarklet — runs in-browser on the Passtime OASIS site
 *
 * Uses fetch() on the same origin to search/edit/add GPS records
 * without opening any popups, iframes, or navigating away.
 * The status panel stays on screen the entire time.
 *
 * Must be run from secure.passtimeusa.com while logged in.
 */
(async function() {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';
  var SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };
  var ORIGIN = 'https://secure.passtimeusa.com';
  // Search page works under Dashboard or CodeSite
  var pathMatch = location.pathname.match(/\/OCMSv2\/([^\/]+)\//);
  var SEARCH_BASE = ORIGIN + '/OCMSv2/' + (pathMatch ? pathMatch[1] : 'Dashboard') + '/';
  // Edit/Add pages are always under CodeSite
  var BASE = ORIGIN + '/OCMSv2/CodeSite/';

  // ── Status Panel ────────────────────────────────────────────────────────────
  if (document.getElementById('gps-sync-panel')) {
    document.getElementById('gps-sync-panel').remove();
  }
  var panel = document.createElement('div');
  panel.id = 'gps-sync-panel';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;width:420px;max-height:90vh;overflow-y:auto;background:#111;color:#fff;border:2px solid #30d158;border-radius:16px;padding:20px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.6);';
  panel.innerHTML = '<div style="font-size:20px;font-weight:800;margin-bottom:12px;color:#30d158;">\u{1F6F0}\uFE0F GPS Sync</div><div id="gps-sync-log" style="white-space:pre-wrap;line-height:1.6;"></div>';
  document.body.appendChild(panel);

  var logEl = document.getElementById('gps-sync-log');
  function log(msg, color) {
    var line = document.createElement('div');
    line.textContent = msg;
    if (color) line.style.color = color;
    logEl.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // ── Supabase ────────────────────────────────────────────────────────────────
  async function sbGet(table, params) {
    var r = await fetch(SB_URL + '/rest/v1/' + table + '?' + (params || ''), {
      headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' })
    });
    if (!r.ok) throw new Error('sbGet ' + table + ': ' + (await r.text()));
    return r.json();
  }

  async function sbPatch(table, id, body) {
    var r = await fetch(SB_URL + '/rest/v1/' + table + '?id=eq.' + id, {
      method: 'PATCH',
      headers: SB_HEADERS,
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('sbPatch ' + table + '/' + id + ': ' + (await r.text()));
    return r.json();
  }

  // ── Parse Deal ──────────────────────────────────────────────────────────────
  function parseDeal(deal) {
    var serial = (deal.gps_serial || '').trim();
    var nameParts = (deal.customer_name || '').trim().split(/\s+/);
    var firstName = nameParts[0] || '';
    var lastName = nameParts.slice(1).join(' ') || nameParts[0] || '';
    return {
      id: deal.id,
      serial: serial,
      firstName: firstName,
      lastName: lastName,
      account: deal.stock || String(deal.id),
      vin: (deal.vin || '').trim(),
      color: (deal.color || '').trim(),
      vehicleDesc: deal.vehicle_desc || ''
    };
  }

  // ── ASP.NET fetch helpers ───────────────────────────────────────────────────
  // Fetch a page and parse it into a DOM document
  async function fetchPage(url) {
    var r = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
    var html = await r.text();
    var parser = new DOMParser();
    return { doc: parser.parseFromString(html, 'text/html'), url: r.url };
  }

  // Extract ASP.NET hidden fields (__VIEWSTATE etc) from a parsed doc
  function getAspFields(doc) {
    var fields = {};
    var hiddens = doc.querySelectorAll('input[type="hidden"]');
    for (var i = 0; i < hiddens.length; i++) {
      if (hiddens[i].name) fields[hiddens[i].name] = hiddens[i].value || '';
    }
    return fields;
  }

  // POST a form (ASP.NET postback) and return parsed response
  async function postForm(url, fields) {
    var body = Object.keys(fields).map(function(k) {
      return encodeURIComponent(k) + '=' + encodeURIComponent(fields[k] || '');
    }).join('&');
    var r = await fetch(url, {
      method: 'POST',
      credentials: 'include',
      redirect: 'follow',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body
    });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' posting ' + url);
    var html = await r.text();
    var parser = new DOMParser();
    return { doc: parser.parseFromString(html, 'text/html'), url: r.url };
  }

  // ── Check we're on Passtime ─────────────────────────────────────────────────
  if (!location.hostname.includes('passtimeusa.com')) {
    log('\u274C Not on Passtime \u2014 go to secure.passtimeusa.com first', '#ef4444');
    return;
  }

  // ── Fetch deals ─────────────────────────────────────────────────────────────
  log('\u{1F4E1} Fetching deals from Supabase...');
  var deals;
  try {
    deals = await sbGet('deals', 'gps_uploaded=eq.false&order=created_at.asc');
  } catch(e) {
    log('\u274C ' + e.message, '#ef4444');
    return;
  }

  var dealsWithGps = deals.filter(function(d) {
    return (d.gps_serial || '').trim().length > 0;
  });

  log('Found ' + deals.length + ' unprocessed, ' + dealsWithGps.length + ' with GPS serials');

  if (!dealsWithGps.length) {
    log('\u2705 Nothing to process \u2014 all up to date!', '#30d158');
    return;
  }

  // ── Verify we can access OASIS ──────────────────────────────────────────────
  log('\u{1F680} Connecting to OASIS...');
  var dashPage;
  try {
    dashPage = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
  } catch(e) {
    log('\u274C Cannot reach OASIS: ' + e.message, '#ef4444');
    log('Current page: ' + location.href, '#888');
    log('Trying: ' + BASE + 'CustomerRpt.aspx', '#888');
    log('Make sure you are logged in.', '#f59e0b');
    return;
  }

  // Check if we got a login page instead
  var dashText = dashPage.doc.body ? dashPage.doc.body.innerText : '';
  if (dashPage.url.includes('Login') || dashText.includes('Sign In') || dashText.includes('Password')) {
    log('\u274C Session expired \u2014 please log in and try again', '#ef4444');
    return;
  }

  // Check for EliteRenewalCheck
  if (dashPage.url.includes('EliteRenewalCheck')) {
    log('Skipping renewal check...');
    var skipFields = getAspFields(dashPage.doc);
    var skipBtn = dashPage.doc.querySelector('input[value*="Skip"]');
    if (skipBtn && skipBtn.name) {
      skipFields[skipBtn.name] = skipBtn.value;
      try {
        dashPage = await postForm(dashPage.url, skipFields);
      } catch(e) {}
    }
  }

  log('\u2705 Connected!', '#30d158');

  var successCount = 0;
  var skipCount = 0;

  // ── Process each deal ───────────────────────────────────────────────────────
  for (var i = 0; i < dealsWithGps.length; i++) {
    var deal = parseDeal(dealsWithGps[i]);
    log('');
    log('\u2550\u2550\u2550 ' + (i+1) + '/' + dealsWithGps.length + ': ' + deal.firstName + ' ' + deal.lastName + ' \u2550\u2550\u2550');
    log('Serial: ' + deal.serial + ' | VIN: ' + deal.vin);

    if (!deal.serial) {
      log('\u23ED\uFE0F  No serial \u2014 skipping', '#f59e0b');
      skipCount++;
      continue;
    }

    try {
      // Step 1: Load search page
      log('\u{1F50D} Searching...');
      var searchPage = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
      var searchFields = getAspFields(searchPage.doc);

      // Set search dropdown to SerialNumber and fill search text
      searchFields['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'SerialNumber';
      searchFields['ctl00$searchCustomerCTL$searchTxt'] = deal.serial;
      searchFields['ctl00$searchCustomerCTL$searchBtn'] = 'Search';

      var resultPage = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', searchFields);
      var resultUrl = resultPage.url;
      var resultDoc = resultPage.doc;

      if (resultUrl.includes('ViewDetail.aspx')) {
        // ── Path A: Record found directly — edit it ────────────────────────
        log('\u{1F4DD} Found \u2014 editing...');

        // Navigate to edit mode
        var editPage = await fetchPage(BASE + 'ViewDetail.aspx?M=ED');
        var editDoc = editPage.doc;
        var editFields = getAspFields(editDoc);

        if (!editDoc.querySelector('[name="ctl00$MainContent$btnEditSubmit"]') &&
            !editFields['ctl00$MainContent$btnEditSubmit']) {
          log('\u274C Could not open edit form', '#ef4444');
          skipCount++;
          continue;
        }

        // Fill fields
        editFields['ctl00$MainContent$eAccountNumber'] = deal.account;
        editFields['ctl00$MainContent$efirstname'] = deal.firstName;
        editFields['ctl00$MainContent$elastname'] = deal.lastName;
        editFields['ctl00$MainContent$eVIN'] = deal.vin;
        editFields['ctl00$MainContent$eColor'] = deal.color;
        editFields['ctl00$MainContent$eInventoryStockNumber'] = deal.account;
        editFields['ctl00$MainContent$btnEditSubmit'] = 'Submit';

        var saveResult = await postForm(BASE + 'ViewDetail.aspx?M=ED', editFields);

        if (saveResult.url.includes('ViewDetail.aspx') && !saveResult.url.includes('M=ED')) {
          log('\u2705 Updated!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('\u{1F4E4} Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          log('\u274C Edit may have failed', '#ef4444');
          skipCount++;
        }

      } else {
        // Check listing page
        var hasResults = false;
        var bodyText = resultDoc.body ? resultDoc.body.innerText : '';

        if (resultUrl.includes('CustomerSearchListing')) {
          if (!bodyText.includes('No records found') && !bodyText.includes('0 records')) {
            var firstLink = resultDoc.querySelector('#MainContent_gvCustomers a');
            if (firstLink) {
              hasResults = true;
              // Follow the link to ViewDetail
              var href = firstLink.getAttribute('href') || '';
              if (href) {
                var detailPage = await fetchPage(BASE + href);
                resultUrl = detailPage.url;
                resultDoc = detailPage.doc;
              }
            }
          }
        }

        if (hasResults && resultUrl.includes('ViewDetail.aspx')) {
          log('\u{1F4DD} Found via listing \u2014 editing...');
          var editPage2 = await fetchPage(BASE + 'ViewDetail.aspx?M=ED');
          var editFields2 = getAspFields(editPage2.doc);

          editFields2['ctl00$MainContent$eAccountNumber'] = deal.account;
          editFields2['ctl00$MainContent$efirstname'] = deal.firstName;
          editFields2['ctl00$MainContent$elastname'] = deal.lastName;
          editFields2['ctl00$MainContent$eVIN'] = deal.vin;
          editFields2['ctl00$MainContent$eColor'] = deal.color;
          editFields2['ctl00$MainContent$eInventoryStockNumber'] = deal.account;
          editFields2['ctl00$MainContent$btnEditSubmit'] = 'Submit';

          var saveResult2 = await postForm(BASE + 'ViewDetail.aspx?M=ED', editFields2);

          if (saveResult2.url.includes('ViewDetail.aspx') && !saveResult2.url.includes('M=ED')) {
            log('\u2705 Updated!', '#30d158');
            await sbPatch('deals', deal.id, { gps_uploaded: true });
            log('\u{1F4E4} Marked done in Supabase', '#30d158');
            successCount++;
            continue;
          }
          log('\u274C Edit via listing failed', '#ef4444');
          skipCount++;
          continue;
        }

        // ── Path B: Not found — add new ─────────────────────────────────────
        log('\u2795 Not found \u2014 adding new...');
        var addPage = await fetchPage(BASE + 'Add.aspx');
        var addDoc = addPage.doc;

        // Check for Encore link/image
        var encoreLink = addDoc.querySelector('#MainContent_imgEncore');
        if (!encoreLink) {
          log('\u274C Encore option not found on Add page', '#ef4444');
          skipCount++;
          continue;
        }

        // Navigate to AddElite page
        var addElitePage = await fetchPage(BASE + 'AddElite.aspx');
        var addEliteDoc = addElitePage.doc;
        var addEliteFields = getAspFields(addEliteDoc);

        var dropdown = addEliteDoc.querySelector('#MainContent_DropDownList1');
        if (!dropdown) {
          log('\u274C Serial dropdown not found', '#ef4444');
          skipCount++;
          continue;
        }

        // Check if serial is in dropdown
        var found = false;
        var opts = dropdown.querySelectorAll('option');
        for (var j = 0; j < opts.length; j++) {
          if (opts[j].value === deal.serial || opts[j].textContent.trim() === deal.serial) {
            found = true; break;
          }
        }
        if (!found) {
          log('\u23ED\uFE0F  Serial ' + deal.serial + ' not in Passtime inventory', '#f59e0b');
          skipCount++;
          continue;
        }

        // Fill the add form
        addEliteFields['ctl00$MainContent$txtInstallerFName'] = 'Vladimir';
        addEliteFields['ctl00$MainContent$txtInstallerLName'] = 'Arutyunov';
        addEliteFields['ctl00$MainContent$DropDownList1'] = deal.serial;
        addEliteFields['ctl00$MainContent$AccountNumber'] = deal.account;
        addEliteFields['ctl00$MainContent$firstname'] = deal.firstName;
        addEliteFields['ctl00$MainContent$lastname'] = deal.lastName;
        addEliteFields['ctl00$MainContent$VIN'] = deal.vin;
        addEliteFields['ctl00$MainContent$Color'] = deal.color;
        addEliteFields['ctl00$MainContent$btnAddCust'] = 'Add';

        var addResult = await postForm(BASE + 'AddElite.aspx', addEliteFields);
        var addResultUrl = addResult.url.toLowerCase();
        var addResultText = addResult.doc.body ? addResult.doc.body.innerText : '';

        if (addResultUrl.includes('viewdetail.aspx')) {
          log('\u2705 Added!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('\u{1F4E4} Marked done in Supabase', '#30d158');
          successCount++;
        } else if (addResultText.includes('OASIS Error')) {
          log('\u274C OASIS Error \u2014 try again', '#ef4444');
          skipCount++;
        } else {
          log('\u274C Add may have failed', '#ef4444');
          skipCount++;
        }
      }
    } catch(err) {
      log('\u274C Error: ' + err.message, '#ef4444');
      skipCount++;
    }

    await sleep(500);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  log('');
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  log('\u{1F4CA} DONE \u2014 \u2705 ' + successCount + ' registered, \u23ED\uFE0F ' + skipCount + ' skipped', successCount > 0 ? '#30d158' : '#f59e0b');
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

})();
