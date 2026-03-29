/**
 * GPS Sync Bookmarklet — runs in-browser on the Passtime OASIS site
 *
 * Uses a popup window for navigation (same session, no iframe restrictions).
 * The main page stays untouched — just shows a status panel.
 */
(async function() {
  'use strict';

  // ── Config ──────────────────────────────────────────────────────────────────
  var SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk5MCLRdkyv0INmuFwAVo';
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
  panel.innerHTML = '<div style="font-size:20px;font-weight:800;margin-bottom:12px;color:#30d158;">🛰️ GPS Sync</div><div id="gps-sync-log" style="white-space:pre-wrap;line-height:1.6;"></div>';
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

  // ── Popup window for navigation ─────────────────────────────────────────────
  var popup = window.open('about:blank', 'gps_sync_window', 'width=900,height=600,left=100,top=100');
  if (!popup) {
    log('❌ Popup blocked! Allow popups for this site and try again.', '#ef4444');
    return;
  }

  function navTo(url) {
    return new Promise(function(resolve) {
      popup.location.href = url;
      // Poll until loaded
      var checks = 0;
      var interval = setInterval(function() {
        checks++;
        try {
          if (popup.document.readyState === 'complete' && popup.location.href.includes('passtimeusa.com')) {
            clearInterval(interval);
            setTimeout(resolve, 1500);
          }
        } catch(e) { /* cross-origin, keep waiting */ }
        if (checks > 40) { clearInterval(interval); resolve(); } // 20s timeout
      }, 500);
    });
  }

  function popDoc() {
    try { return popup.document; }
    catch(e) { return null; }
  }

  function waitForPopupNav() {
    return new Promise(function(resolve) {
      var checks = 0;
      var interval = setInterval(function() {
        checks++;
        try {
          if (popup.document.readyState === 'complete') {
            clearInterval(interval);
            setTimeout(resolve, 1500);
          }
        } catch(e) { /* keep waiting */ }
        if (checks > 40) { clearInterval(interval); resolve(); }
      }, 500);
    });
  }

  // Click something in popup and wait for page load
  function clickAndWait(element) {
    return new Promise(function(resolve) {
      var oldUrl = '';
      try { oldUrl = popup.location.href; } catch(e) {}
      element.click();
      // Wait for navigation
      var checks = 0;
      var interval = setInterval(function() {
        checks++;
        try {
          if (popup.document.readyState === 'complete') {
            var newUrl = popup.location.href;
            if (newUrl !== oldUrl || checks > 5) {
              clearInterval(interval);
              setTimeout(resolve, 1500);
              return;
            }
          }
        } catch(e) { /* keep waiting */ }
        if (checks > 40) { clearInterval(interval); resolve(); }
      }, 500);
    });
  }

  // ── Check we're on Passtime ─────────────────────────────────────────────────
  if (!location.hostname.includes('passtimeusa.com')) {
    log('❌ Not on Passtime — go to secure.passtimeusa.com first', '#ef4444');
    popup.close();
    return;
  }

  // ── Fetch deals ─────────────────────────────────────────────────────────────
  log('📡 Fetching deals from Supabase...');
  var deals;
  try {
    deals = await sbGet('deals', 'deal_type=eq.finance&gps_uploaded=eq.false&order=created_at.asc');
  } catch(e) {
    log('❌ ' + e.message, '#ef4444');
    popup.close();
    return;
  }

  var dealsWithGps = deals.filter(function(d) {
    return (d.gps_serial || '').trim().length > 0;
  });

  log('Found ' + deals.length + ' unprocessed, ' + dealsWithGps.length + ' with GPS serials');

  if (!dealsWithGps.length) {
    log('✅ Nothing to process — all up to date!', '#30d158');
    popup.close();
    return;
  }

  var successCount = 0;
  var skipCount = 0;

  // ── Process each deal ───────────────────────────────────────────────────────
  for (var i = 0; i < dealsWithGps.length; i++) {
    var deal = parseDeal(dealsWithGps[i]);
    log('\n═══ ' + (i+1) + '/' + dealsWithGps.length + ': ' + deal.firstName + ' ' + deal.lastName + ' ═══');
    log('Serial: ' + deal.serial + ' | VIN: ' + deal.vin);

    if (!deal.serial) {
      log('⏭️  No serial — skipping', '#f59e0b');
      skipCount++;
      continue;
    }

    try {
      // Step 1: Search by serial from Dashboard
      log('🔍 Searching...');
      await navTo(BASE + 'CustomerRpt.aspx');
      await sleep(500);

      var doc = popDoc();
      if (!doc) {
        log('❌ Cannot access popup — possible session issue', '#ef4444');
        skipCount++;
        continue;
      }

      var dd = doc.getElementById('searchCustomerCTL_searchCustomerDDL');
      var txt = doc.getElementById('searchCustomerCTL_searchTxt');
      var btn = doc.getElementById('searchCustomerCTL_searchBtn');
      if (!dd || !txt || !btn) {
        log('❌ Search controls not found — are you logged in?', '#ef4444');
        skipCount++;
        continue;
      }

      dd.value = 'SerialNumber';
      txt.value = deal.serial;
      await clickAndWait(btn);

      doc = popDoc();
      var currentUrl = '';
      try { currentUrl = popup.location.href; } catch(e) {}

      if (currentUrl.includes('ViewDetail.aspx')) {
        // ── Path A: Record found — edit it ──────────────────────────────────
        log('📝 Found — editing...');

        // Open edit form via postback
        try {
          popup.WebForm_DoPostBackWithOptions(
            new popup.WebForm_PostBackOptions(
              "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
            )
          );
        } catch(e) {
          log('❌ Could not open edit form: ' + e.message, '#ef4444');
          skipCount++;
          continue;
        }
        await waitForPopupNav();
        await sleep(1000);

        doc = popDoc();
        var el;
        el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
        el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
        el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
        el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
        el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
        el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;

        var submitBtn = doc.getElementById('MainContent_btnEditSubmit');
        if (submitBtn) {
          await clickAndWait(submitBtn);
        }

        try { currentUrl = popup.location.href; } catch(e) { currentUrl = ''; }
        if (currentUrl.includes('ViewDetail.aspx')) {
          log('✅ Updated!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('📤 Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          log('❌ Edit may have failed', '#ef4444');
          skipCount++;
        }

      } else {
        // Check listing page for results
        var bodyText = doc ? doc.body.innerText : '';
        var isListing = currentUrl.includes('CustomerSearchListing');

        if (isListing && !bodyText.includes('No records found') && !bodyText.includes('0 records')) {
          var firstLink = doc.querySelector('#MainContent_gvCustomers a');
          if (firstLink) {
            await clickAndWait(firstLink);
            try { currentUrl = popup.location.href; } catch(e) { currentUrl = ''; }
            if (currentUrl.includes('ViewDetail.aspx')) {
              log('📝 Found via listing — editing...');
              try {
                popup.WebForm_DoPostBackWithOptions(
                  new popup.WebForm_PostBackOptions(
                    "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
                  )
                );
              } catch(e) {}
              await waitForPopupNav();
              await sleep(1000);
              doc = popDoc();
              el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
              el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
              el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
              el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
              el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
              el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;
              submitBtn = doc.getElementById('MainContent_btnEditSubmit');
              if (submitBtn) await clickAndWait(submitBtn);
              try { currentUrl = popup.location.href; } catch(e) { currentUrl = ''; }
              if (currentUrl.includes('ViewDetail.aspx')) {
                log('✅ Updated!', '#30d158');
                await sbPatch('deals', deal.id, { gps_uploaded: true });
                log('📤 Marked done in Supabase', '#30d158');
                successCount++;
                continue;
              }
            }
          }
        }

        // ── Path B: Not found — add new ─────────────────────────────────────
        log('➕ Not found — adding new...');
        await navTo(BASE + 'Add.aspx');
        await sleep(500);

        doc = popDoc();
        var imgEncore = doc ? doc.getElementById('MainContent_imgEncore') : null;
        if (!imgEncore) {
          log('❌ Encore image not found', '#ef4444');
          skipCount++;
          continue;
        }

        await clickAndWait(imgEncore);

        try { currentUrl = popup.location.href; } catch(e) { currentUrl = ''; }
        if (!currentUrl.includes('addelite.aspx')) {
          log('❌ Did not reach add form', '#ef4444');
          skipCount++;
          continue;
        }

        doc = popDoc();
        var dropdown = doc.getElementById('MainContent_DropDownList1');
        if (!dropdown) {
          log('❌ Serial dropdown not found', '#ef4444');
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
          log('⏭️  Serial ' + deal.serial + ' not in inventory', '#f59e0b');
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
        if (addBtn) await clickAndWait(addBtn);

        try { currentUrl = popup.location.href.toLowerCase(); } catch(e) { currentUrl = ''; }
        if (currentUrl.includes('viewdetail.aspx')) {
          log('✅ Added!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('📤 Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          doc = popDoc();
          if (doc && doc.body.innerText.includes('OASIS Error')) {
            log('❌ OASIS Error — try again', '#ef4444');
          } else {
            log('❌ Add may have failed', '#ef4444');
          }
          skipCount++;
        }
      }
    } catch(err) {
      log('❌ Error: ' + err.message, '#ef4444');
      skipCount++;
    }

    await sleep(1500);
  }

  // ── Summary ─────────────────────────────────────────────────────────────────
  popup.close();
  log('\n════════════════════════════════');
  log('📊 DONE — ✅ ' + successCount + ' registered, ⏭️ ' + skipCount + ' skipped', successCount > 0 ? '#30d158' : '#f59e0b');
  log('════════════════════════════════');

  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close';
  closeBtn.style.cssText = 'margin-top:12px;padding:10px 24px;background:#30d158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:14px;cursor:pointer;width:100%;';
  closeBtn.onclick = function() { panel.remove(); };
  logEl.appendChild(closeBtn);
})();
