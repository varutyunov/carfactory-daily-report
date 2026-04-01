/**
 * GPS Sync Bookmarklet — runs in-browser on the Passtime OASIS site
 *
 * Opens a worker popup window (same session) to navigate through pages
 * while the main window shows a live status panel.
 *
 * If popup is blocked: user must allow popups for passtimeusa.com
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
  var BASE = 'https://secure.passtimeusa.com/OCMSv2/CodeSite/';

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

  // ── Check we're on Passtime ─────────────────────────────────────────────────
  if (!location.hostname.includes('passtimeusa.com')) {
    log('\u274C Not on Passtime \u2014 go to secure.passtimeusa.com first', '#ef4444');
    return;
  }

  // ── Fetch deals ─────────────────────────────────────────────────────────────
  log('\u{1F4E1} Fetching deals from Supabase...');
  var deals;
  try {
    deals = await sbGet('deals', 'deal_type=eq.finance&gps_uploaded=eq.false&order=created_at.asc');
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

  // ── Open worker popup ───────────────────────────────────────────────────────
  log('\u{1F680} Opening worker window...');
  var popup = window.open(BASE + 'CustomerRpt.aspx', 'gps_sync_worker', 'width=800,height=600,left=50,top=50');
  if (!popup || popup.closed) {
    log('', '#ef4444');
    log('\u274C Popup was blocked!', '#ef4444');
    log('', '#ef4444');
    log('To fix:', '#f59e0b');
    log('1. Click the popup-blocked icon in the address bar', '#f59e0b');
    log('2. Select "Always allow popups from this site"', '#f59e0b');
    log('3. Click the bookmarklet again', '#f59e0b');
    return;
  }

  // Wait for popup to load
  function waitForPopup(urlContains, maxWait) {
    maxWait = maxWait || 30000;
    return new Promise(function(resolve) {
      var start = Date.now();
      var lastErr = '';
      var interval = setInterval(function() {
        try {
          if (popup.closed) {
            clearInterval(interval);
            log('  ⚠ Popup was closed', '#f59e0b');
            resolve(false);
            return;
          }
          var ready = popup.document.readyState === 'complete';
          var urlOk = !urlContains || popup.location.href.includes(urlContains);
          if (ready && urlOk) {
            clearInterval(interval);
            setTimeout(function() { resolve(true); }, 1000);
            return;
          }
        } catch(e) {
          if (e.message !== lastErr) {
            lastErr = e.message;
            log('  ⏳ Waiting... (' + e.message.substring(0,60) + ')', '#555');
          }
        }
        if (Date.now() - start > maxWait) {
          clearInterval(interval);
          log('  ⏱ Timed out after ' + (maxWait/1000) + 's', '#ef4444');
          try { log('  URL: ' + popup.location.href, '#888'); } catch(e2) { log('  URL: cross-origin blocked', '#888'); }
          resolve(false);
        }
      }, 500);
    });
  }

  function popDoc() {
    try { return popup.document; }
    catch(e) { return null; }
  }

  function popUrl() {
    try { return popup.location.href; }
    catch(e) { return ''; }
  }

  // Wait for initial dashboard load
  var loaded = await waitForPopup('passtimeusa.com', 30000);
  if (!loaded) {
    // Try once more with no URL check — maybe it loaded but URL doesn't match
    log('  Retrying with relaxed check...', '#f59e0b');
    loaded = await waitForPopup(null, 10000);
  }
  if (!loaded) {
    log('', '#ef4444');
    log('\u274C Worker window failed to load', '#ef4444');
    log('', '#f59e0b');
    log('Make sure you are running this bookmarklet', '#f59e0b');
    log('from the Passtime OASIS site (passtimeusa.com)', '#f59e0b');
    log('and that you are logged in.', '#f59e0b');
    try { popup.close(); } catch(e) {}
    return;
  }
  await sleep(1000);

  // Check if we hit the EliteRenewalCheck page
  if (popUrl().includes('EliteRenewalCheck')) {
    log('Skipping renewal check...');
    var doc = popDoc();
    if (doc) {
      var skipBtn = doc.querySelector('input[value*="Skip"]');
      if (skipBtn) skipBtn.click();
      await waitForPopup('CustomerRpt');
      await sleep(1000);
    }
  }

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

    if (popup.closed) {
      log('\u274C Worker window was closed \u2014 stopping', '#ef4444');
      break;
    }

    try {
      // Step 1: Navigate to dashboard and search
      log('\u{1F50D} Searching...');
      popup.location.href = BASE + 'CustomerRpt.aspx';
      await waitForPopup('passtimeusa.com');
      await sleep(1000);

      var doc = popDoc();
      if (!doc) {
        log('\u274C Cannot access worker window', '#ef4444');
        skipCount++;
        continue;
      }

      var dd = doc.getElementById('searchCustomerCTL_searchCustomerDDL');
      var txt = doc.getElementById('searchCustomerCTL_searchTxt');
      var btn = doc.getElementById('searchCustomerCTL_searchBtn');
      if (!dd || !txt || !btn) {
        log('\u274C Search controls not found \u2014 are you logged in?', '#ef4444');
        skipCount++;
        continue;
      }

      dd.value = 'SerialNumber';
      txt.value = deal.serial;
      btn.click();

      // Wait for search result page
      await sleep(2000);
      await waitForPopup('passtimeusa.com');
      await sleep(1000);

      doc = popDoc();
      var currentUrl = popUrl();

      if (currentUrl.includes('ViewDetail.aspx')) {
        // ── Path A: Record found — edit it ──────────────────────────────────
        log('\u{1F4DD} Found \u2014 editing...');

        // Click Edit Consumer Details link
        var editLink = doc.querySelector('#MainContent_ViewDetailMenu1_BtnEditCustomer3');
        if (!editLink) {
          // Try alternate selectors
          var allLinks = doc.querySelectorAll('a');
          for (var li = 0; li < allLinks.length; li++) {
            if (allLinks[li].textContent.trim() === 'Edit Consumer Details') {
              editLink = allLinks[li];
              break;
            }
          }
        }

        if (editLink) {
          editLink.click();
        } else {
          // Fallback: use postback
          try {
            popup.WebForm_DoPostBackWithOptions(
              new popup.WebForm_PostBackOptions(
                "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
              )
            );
          } catch(e) {
            popup.location.href = currentUrl.split('?')[0] + '?M=ED';
          }
        }

        await waitForPopup('M=ED', 10000);
        if (!popUrl().includes('M=ED')) {
          // Try direct nav
          popup.location.href = BASE + 'ViewDetail.aspx?M=ED';
          await waitForPopup('M=ED', 10000);
        }
        await sleep(1000);

        doc = popDoc();
        if (!doc || !doc.getElementById('MainContent_btnEditSubmit')) {
          log('\u274C Could not open edit form', '#ef4444');
          skipCount++;
          continue;
        }

        // Fill the form
        var el;
        el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
        el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
        el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
        el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
        el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
        el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;

        // Submit
        var submitBtn = doc.getElementById('MainContent_btnEditSubmit');
        submitBtn.click();

        await sleep(2000);
        await waitForPopup('passtimeusa.com');
        await sleep(1000);

        currentUrl = popUrl();
        if (currentUrl.includes('ViewDetail.aspx') && !currentUrl.includes('M=ED')) {
          log('\u2705 Updated!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('\u{1F4E4} Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          log('\u274C Edit may have failed', '#ef4444');
          skipCount++;
        }

      } else {
        // Check listing page or dashboard results
        var bodyText = doc ? doc.body.innerText : '';
        var hasResults = false;

        if (currentUrl.includes('CustomerSearchListing')) {
          if (!bodyText.includes('No records found') && !bodyText.includes('0 records')) {
            var firstLink = doc.querySelector('#MainContent_gvCustomers a');
            if (firstLink) {
              hasResults = true;
              firstLink.click();
              await waitForPopup('ViewDetail');
              await sleep(1000);
              currentUrl = popUrl();
            }
          }
        }

        if (hasResults && currentUrl.includes('ViewDetail.aspx')) {
          // Got to ViewDetail from listing — now edit
          log('\u{1F4DD} Found via listing \u2014 editing...');
          doc = popDoc();
          var editLink2 = null;
          var allLinks2 = doc.querySelectorAll('a');
          for (var li2 = 0; li2 < allLinks2.length; li2++) {
            if (allLinks2[li2].textContent.trim() === 'Edit Consumer Details') {
              editLink2 = allLinks2[li2];
              break;
            }
          }
          if (editLink2) {
            editLink2.click();
          } else {
            try {
              popup.WebForm_DoPostBackWithOptions(
                new popup.WebForm_PostBackOptions(
                  "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
                )
              );
            } catch(e) {}
          }

          await waitForPopup('M=ED', 10000);
          await sleep(1000);
          doc = popDoc();

          if (doc && doc.getElementById('MainContent_btnEditSubmit')) {
            el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
            el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
            el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
            el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
            el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
            el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;

            doc.getElementById('MainContent_btnEditSubmit').click();
            await sleep(2000);
            await waitForPopup('passtimeusa.com');
            await sleep(1000);

            currentUrl = popUrl();
            if (currentUrl.includes('ViewDetail.aspx') && !currentUrl.includes('M=ED')) {
              log('\u2705 Updated!', '#30d158');
              await sbPatch('deals', deal.id, { gps_uploaded: true });
              log('\u{1F4E4} Marked done in Supabase', '#30d158');
              successCount++;
              continue;
            }
          }
          log('\u274C Edit via listing failed', '#ef4444');
          skipCount++;
          continue;
        }

        // ── Path B: Not found — add new ─────────────────────────────────────
        log('\u2795 Not found \u2014 adding new...');
        popup.location.href = BASE + 'Add.aspx';
        await waitForPopup('Add.aspx');
        await sleep(1000);

        doc = popDoc();
        var imgEncore = doc ? doc.getElementById('MainContent_imgEncore') : null;
        if (!imgEncore) {
          log('\u274C Encore image not found on Add page', '#ef4444');
          skipCount++;
          continue;
        }

        imgEncore.click();
        await waitForPopup('addelite', 15000);
        await sleep(1000);

        currentUrl = popUrl().toLowerCase();
        if (!currentUrl.includes('addelite.aspx')) {
          log('\u274C Did not reach add form', '#ef4444');
          skipCount++;
          continue;
        }

        doc = popDoc();
        var dropdown = doc.getElementById('MainContent_DropDownList1');
        if (!dropdown) {
          log('\u274C Serial dropdown not found', '#ef4444');
          skipCount++;
          continue;
        }

        var found = false;
        for (var j = 0; j < dropdown.options.length; j++) {
          if (dropdown.options[j].value === deal.serial || dropdown.options[j].text === deal.serial) {
            found = true; break;
          }
        }
        if (!found) {
          log('\u23ED\uFE0F  Serial ' + deal.serial + ' not in inventory', '#f59e0b');
          skipCount++;
          continue;
        }

        doc.getElementById('MainContent_txtInstallerFName').value = 'Vladimir';
        doc.getElementById('MainContent_txtInstallerLName').value = 'Arutyunov';
        dropdown.value = deal.serial;
        doc.getElementById('MainContent_AccountNumber').value = deal.account;
        doc.getElementById('MainContent_firstname').value = deal.firstName;
        doc.getElementById('MainContent_lastname').value = deal.lastName;
        doc.getElementById('MainContent_VIN').value = deal.vin;
        doc.getElementById('MainContent_Color').value = deal.color;

        var addBtn = doc.getElementById('MainContent_btnAddCust');
        if (addBtn) addBtn.click();

        await sleep(2000);
        await waitForPopup('passtimeusa.com');
        await sleep(1000);

        currentUrl = popUrl().toLowerCase();
        if (currentUrl.includes('viewdetail.aspx')) {
          log('\u2705 Added!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('\u{1F4E4} Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          doc = popDoc();
          if (doc && doc.body.innerText.includes('OASIS Error')) {
            log('\u274C OASIS Error \u2014 try again', '#ef4444');
          } else {
            log('\u274C Add may have failed', '#ef4444');
          }
          skipCount++;
        }
      }
    } catch(err) {
      log('\u274C Error: ' + err.message, '#ef4444');
      skipCount++;
    }

    await sleep(1500);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  if (!popup.closed) popup.close();
  log('');
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  log('\u{1F4CA} DONE \u2014 \u2705 ' + successCount + ' registered, \u23ED\uFE0F ' + skipCount + ' skipped', successCount > 0 ? '#30d158' : '#f59e0b');
  log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');

  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'margin-top:12px;padding:10px 24px;background:#30d158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:14px;cursor:pointer;width:100%;';
  closeBtn.onclick = function() { panel.remove(); };
  logEl.appendChild(closeBtn);
})();
