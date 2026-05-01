/**
 * GPS Sync Bookmarklet — runs in-browser on the Passtime OASIS site
 *
 * Stripped-down version: ONLY pushes new finance deals from Supabase
 * into Passtime. For each `deals` row where `deal_type='finance'`,
 * `gps_uploaded=false`, and `gps_serial` is non-empty:
 *
 *   1. Search Passtime by serial number.
 *   2. If found  → open Edit page, fill account/customer/VIN/color, submit.
 *   3. If not found → open Add.aspx in hidden iframe, click Encore,
 *      pick the serial from the dropdown, fill the AddElite form, submit.
 *   4. On success → patch deals.gps_uploaded = true.
 *
 * The previous customer-info scraping (battery / location / address /
 * power mode / location history → repo_gps_signals) was unreliable and
 * has been removed. So has the queued-task path (gps_fetch_* / gps_register_*
 * in app_settings) which depended on Phase 1.
 *
 * Must be run from secure.passtimeusa.com while logged in.
 */
(async function() {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';
  // After the Day 9 RLS lockdown, anon role can't read `deals` directly. The
  // bookmarklet now talks to the `gps-sync` edge function which uses the
  // service-role key server-side; this shared secret gates access. Same
  // pattern as Apps Script's SHEETS_SECRET — leakage risk is bounded to the
  // function's surface (list pending + mark uploaded), not full Supabase.
  var GPS_SYNC_SECRET = 'q00cSu1SnDJo_wrNiguDp12r6mLhrG6Z';
  var GPS_SYNC_URL = SB_URL + '/functions/v1/gps-sync';
  var SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json'
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
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div style="font-size:20px;font-weight:800;color:#30d158;">\u{1F6F0}️ GPS Sync</div><div id="gps-sync-close" style="cursor:pointer;font-size:22px;color:#666;padding:0 4px;line-height:1;" title="Close">✕</div></div><div id="gps-sync-log" style="white-space:pre-wrap;line-height:1.6;"></div>';
  document.body.appendChild(panel);
  document.getElementById('gps-sync-close').onclick = function() { panel.remove(); };

  var logEl = document.getElementById('gps-sync-log');
  function log(msg, color) {
    var line = document.createElement('div');
    line.textContent = msg;
    if (color) line.style.color = color;
    logEl.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }

  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  // ── Edge-function helpers (gps-sync) ────────────────────────────────────────
  // The two operations the bookmarklet needs (list pending finance deals
  // with non-empty serial; mark a deal gps_uploaded=true) both go through
  // the gps-sync edge function. RLS lockdown means we can't query `deals`
  // directly with the anon key.
  async function gpsSyncCall(body) {
    var r = await fetch(GPS_SYNC_URL, {
      method: 'POST',
      headers: SB_HEADERS,
      body: JSON.stringify(Object.assign({ secret: GPS_SYNC_SECRET }, body))
    });
    if (!r.ok) throw new Error('gps-sync ' + r.status + ': ' + (await r.text()));
    return r.json();
  }
  async function gpsSyncListPending() {
    var resp = await gpsSyncCall({ action: 'list' });
    return resp.deals || [];
  }
  async function gpsSyncMarkUploaded(dealId) {
    return await gpsSyncCall({ action: 'mark_uploaded', deal_id: dealId });
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
  async function fetchPage(url) {
    var r = await fetch(url, { credentials: 'include', redirect: 'follow' });
    if (!r.ok) throw new Error('HTTP ' + r.status + ' fetching ' + url);
    var html = await r.text();
    var parser = new DOMParser();
    return { doc: parser.parseFromString(html, 'text/html'), url: r.url };
  }

  function getAspFields(doc) {
    var fields = {};
    var hiddens = doc.querySelectorAll('input[type="hidden"]');
    for (var i = 0; i < hiddens.length; i++) {
      if (hiddens[i].name) fields[hiddens[i].name] = hiddens[i].value || '';
    }
    return fields;
  }

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

  // ── Sanity check ────────────────────────────────────────────────────────────
  if (!location.hostname.includes('passtimeusa.com')) {
    log('❌ Not on Passtime — go to secure.passtimeusa.com first', '#ef4444');
    return;
  }

  // ── Pull deals to push ──────────────────────────────────────────────────────
  log('\u{1F4E1} Checking for new deals to push...');
  var dealsWithGps;
  try {
    // Server-side filter: deal_type=finance, gps_uploaded=false,
    // voided_at IS NULL, gps_serial non-empty — already applied by the
    // edge function so the response is the exact list we want to push.
    dealsWithGps = await gpsSyncListPending();
  } catch (e) {
    log('❌ ' + e.message, '#ef4444');
    return;
  }

  log('Found ' + dealsWithGps.length + ' new finance deal(s) with GPS serials');

  if (!dealsWithGps.length) {
    log('✅ No new deals to push!', '#30d158');
    log('');
    log('════════════════════════════════');
    log('\u{1F4CA} GPS SYNC COMPLETE', '#30d158');
    log('════════════════════════════════');
    return;
  }

  // ── Verify we can access OASIS ──────────────────────────────────────────────
  log('\u{1F680} Connecting to OASIS...');
  var dashPage;
  try {
    dashPage = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
  } catch (e) {
    log('❌ Cannot reach OASIS: ' + e.message, '#ef4444');
    log('Make sure you are logged in.', '#f59e0b');
    return;
  }

  // Session expired check
  var dashText = dashPage.doc.body ? (dashPage.doc.body.textContent || '') : '';
  if (dashPage.url.includes('Login') || dashText.includes('Sign In') || dashText.includes('Password')) {
    log('❌ Session expired — please log in and try again', '#ef4444');
    return;
  }

  // Skip the Elite renewal interstitial if it appears
  if (dashPage.url.includes('EliteRenewalCheck')) {
    log('Skipping renewal check...');
    var skipFields = getAspFields(dashPage.doc);
    var skipBtn = dashPage.doc.querySelector('input[value*="Skip"]');
    if (skipBtn && skipBtn.name) {
      skipFields[skipBtn.name] = skipBtn.value;
      try { dashPage = await postForm(dashPage.url, skipFields); } catch (e) {}
    }
  }

  log('✅ Connected!', '#30d158');

  var successCount = 0;
  var skipCount = 0;

  // ── Process each deal ───────────────────────────────────────────────────────
  for (var i = 0; i < dealsWithGps.length; i++) {
    var deal = parseDeal(dealsWithGps[i]);
    log('');
    log('═══ ' + (i + 1) + '/' + dealsWithGps.length + ': ' + deal.firstName + ' ' + deal.lastName + ' ═══');
    log('Serial: ' + deal.serial + ' | VIN: ' + deal.vin);

    if (!deal.serial) {
      log('⏭️  No serial — skipping', '#f59e0b');
      skipCount++;
      continue;
    }

    try {
      // Step 1: Search Passtime by serial
      log('\u{1F50D} Searching...');
      var searchPage = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
      var searchFields = getAspFields(searchPage.doc);
      searchFields['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'SerialNumber';
      searchFields['ctl00$searchCustomerCTL$searchTxt'] = deal.serial;
      searchFields['ctl00$searchCustomerCTL$searchBtn'] = 'Search';

      var resultPage = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', searchFields);
      var resultUrl = resultPage.url;
      var resultDoc = resultPage.doc;

      if (resultUrl.includes('ViewDetail.aspx')) {
        // ── Path A: Direct hit on detail page — edit it ──────────────────────
        log('\u{1F4DD} Found — editing...');

        var editPage = await fetchPage(BASE + 'ViewDetail.aspx?M=ED');
        var editDoc = editPage.doc;
        var editFields = getAspFields(editDoc);

        if (!editDoc.querySelector('[name="ctl00$MainContent$btnEditSubmit"]') &&
            !editFields['ctl00$MainContent$btnEditSubmit']) {
          log('❌ Could not open edit form', '#ef4444');
          skipCount++;
          continue;
        }

        editFields['ctl00$MainContent$eAccountNumber'] = deal.account;
        editFields['ctl00$MainContent$efirstname'] = deal.firstName;
        editFields['ctl00$MainContent$elastname'] = deal.lastName;
        editFields['ctl00$MainContent$eVIN'] = deal.vin;
        editFields['ctl00$MainContent$eColor'] = deal.color;
        editFields['ctl00$MainContent$eInventoryStockNumber'] = deal.account;
        editFields['ctl00$MainContent$btnEditSubmit'] = 'Submit';

        var saveResult = await postForm(BASE + 'ViewDetail.aspx?M=ED', editFields);

        if (saveResult.url.includes('ViewDetail.aspx') && !saveResult.url.includes('M=ED')) {
          log('✅ Updated!', '#30d158');
          await gpsSyncMarkUploaded(deal.id);
          log('\u{1F4E4} Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          log('❌ Edit may have failed', '#ef4444');
          skipCount++;
        }

      } else {
        // ── Path B: Listing page — try the first result, fall through to add
        var hasResults = false;
        var bodyText = resultDoc.body ? (resultDoc.body.textContent || '') : '';

        if (resultUrl.includes('CustomerSearchListing')) {
          if (!bodyText.includes('No records found') && !bodyText.includes('0 records')) {
            var firstLink = resultDoc.querySelector('#MainContent_gvCustomers a');
            if (firstLink) {
              hasResults = true;
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
          log('\u{1F4DD} Found via listing — editing...');
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
            log('✅ Updated!', '#30d158');
            await gpsSyncMarkUploaded(deal.id);
            log('\u{1F4E4} Marked done in Supabase', '#30d158');
            successCount++;
            continue;
          }
          log('❌ Edit via listing failed', '#ef4444');
          skipCount++;
          continue;
        }

        // ── Path C: Not found anywhere — add new via hidden iframe ───────────
        log('➕ Not found — adding new...');

        function iframeNav(url) {
          return new Promise(function(resolve, reject) {
            var ifr = document.getElementById('gps-sync-iframe');
            if (!ifr) {
              ifr = document.createElement('iframe');
              ifr.id = 'gps-sync-iframe';
              ifr.style.cssText = 'position:fixed;top:-9999px;left:-9999px;width:1px;height:1px;opacity:0;';
              document.body.appendChild(ifr);
            }
            var timer = setTimeout(function() { reject(new Error('iframe timeout')); }, 15000);
            ifr.onload = function() { clearTimeout(timer); resolve(ifr); };
            ifr.onerror = function() { clearTimeout(timer); reject(new Error('iframe error')); };
            ifr.src = url;
          });
        }

        try {
          var ifr = await iframeNav(BASE + 'Add.aspx');
          var ifrDoc = ifr.contentDocument || ifr.contentWindow.document;

          var encoreImg = ifrDoc.querySelector('#MainContent_imgEncore');
          if (!encoreImg) {
            log('❌ Encore not found on Add page', '#ef4444');
            skipCount++;
            continue;
          }
          encoreImg.click();

          // Wait for AddElite page to load
          await new Promise(function(r) { ifr.onload = r; setTimeout(r, 5000); });
          await sleep(1000);
          ifrDoc = ifr.contentDocument || ifr.contentWindow.document;

          var dropdown = ifrDoc.querySelector('#MainContent_DropDownList1');
          if (!dropdown) {
            log('❌ Serial dropdown not found on AddElite', '#ef4444');
            log('  iframe URL: ' + ifr.contentWindow.location.href, '#888');
            skipCount++;
            continue;
          }

          var found = false;
          var opts = dropdown.querySelectorAll('option');
          for (var j = 0; j < opts.length; j++) {
            if (opts[j].value === deal.serial || opts[j].textContent.trim() === deal.serial) {
              found = true; break;
            }
          }
          if (!found) {
            log('⏭️  Serial ' + deal.serial + ' not in Passtime inventory', '#f59e0b');
            skipCount++;
            continue;
          }

          ifrDoc.getElementById('MainContent_txtInstallerFName').value = 'Vladimir';
          ifrDoc.getElementById('MainContent_txtInstallerLName').value = 'Arutyunov';
          dropdown.value = deal.serial;
          ifrDoc.getElementById('MainContent_AccountNumber').value = deal.account;
          ifrDoc.getElementById('MainContent_firstname').value = deal.firstName;
          ifrDoc.getElementById('MainContent_lastname').value = deal.lastName;
          ifrDoc.getElementById('MainContent_VIN').value = deal.vin;
          ifrDoc.getElementById('MainContent_Color').value = deal.color;
          ifrDoc.getElementById('MainContent_btnAddCust').click();

          await new Promise(function(r) { ifr.onload = r; setTimeout(r, 5000); });
          await sleep(1000);
          var resultUrl2 = ifr.contentWindow.location.href.toLowerCase();

          if (resultUrl2.includes('viewdetail.aspx')) {
            log('✅ Added!', '#30d158');
            await gpsSyncMarkUploaded(deal.id);
            log('\u{1F4E4} Marked done in Supabase', '#30d158');
            successCount++;
          } else {
            var resultText = (ifr.contentDocument || ifr.contentWindow.document).body.innerText || '';
            if (resultText.includes('OASIS Error')) {
              log('❌ OASIS Error', '#ef4444');
            } else {
              log('❌ Add may have failed', '#ef4444');
              log('  URL: ' + ifr.contentWindow.location.href, '#888');
            }
            skipCount++;
          }
        } catch (addErr) {
          log('❌ Add error: ' + addErr.message, '#ef4444');
          skipCount++;
        }
        var oldIfr = document.getElementById('gps-sync-iframe');
        if (oldIfr) oldIfr.remove();
      }
    } catch (err) {
      log('❌ Error: ' + err.message, '#ef4444');
      skipCount++;
    }

    await sleep(1500); // throttle to avoid IP ban
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  log('');
  log('════════════════════════════════');
  log('\u{1F4CA} DONE — ✅ ' + successCount + ' registered, ⏭️ ' + skipCount + ' skipped', successCount > 0 ? '#30d158' : '#f59e0b');
  log('════════════════════════════════');

})();
