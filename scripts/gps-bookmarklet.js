/**
 * GPS Sync Bookmarklet — runs in-browser on the Passtime OASIS site
 *
 * Usage: Log into Passtime, then click the bookmarklet.
 * It fetches pending deals from Supabase, registers each GPS,
 * and marks them done — all in your current browser session.
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

  // ── Navigate via hidden iframe and wait for load ────────────────────────────
  var iframe = document.createElement('iframe');
  iframe.id = 'gps-sync-frame';
  iframe.style.cssText = 'position:fixed;bottom:10px;right:10px;width:800px;height:500px;z-index:99998;border:2px solid #333;border-radius:12px;background:#fff;';
  document.body.appendChild(iframe);

  function navTo(url) {
    return new Promise(function(resolve) {
      iframe.onload = function() {
        iframe.onload = null;
        setTimeout(resolve, 1500);
      };
      iframe.src = url;
    });
  }

  function iframeDoc() {
    try { return iframe.contentDocument || iframe.contentWindow.document; }
    catch(e) { return null; }
  }

  // ── Check we're on Passtime ─────────────────────────────────────────────────
  if (!location.hostname.includes('passtimeusa.com')) {
    log('❌ Not on Passtime — navigate to secure.passtimeusa.com first', '#ef4444');
    return;
  }

  // ── Fetch deals ─────────────────────────────────────────────────────────────
  log('📡 Fetching deals from Supabase...');
  var deals;
  try {
    deals = await sbGet('deals', 'deal_type=eq.finance&gps_uploaded=eq.false&order=created_at.asc');
  } catch(e) {
    log('❌ ' + e.message, '#ef4444');
    return;
  }

  var dealsWithGps = deals.filter(function(d) {
    return (d.gps_serial || '').trim().length > 0;
  });

  log('Found ' + deals.length + ' unprocessed, ' + dealsWithGps.length + ' with GPS serials');

  if (!dealsWithGps.length) {
    log('✅ Nothing to process — all up to date!', '#30d158');
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
      log('🔍 Searching for serial ' + deal.serial + '...');
      await navTo(BASE + 'CustomerRpt.aspx');
      await sleep(1000);

      var doc = iframeDoc();
      if (!doc) {
        log('❌ Cannot access iframe — possible auth issue', '#ef4444');
        skipCount++;
        continue;
      }

      // Set search dropdown and search
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

      // Submit search via form postback
      await new Promise(function(resolve) {
        iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
        btn.click();
      });

      doc = iframeDoc();
      var currentUrl = iframe.contentWindow.location.href;

      if (currentUrl.includes('ViewDetail.aspx')) {
        // ── Path A: Record found — edit it ──────────────────────────────────
        log('📝 Record found — editing...');

        // Open edit form
        await new Promise(function(resolve) {
          iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
          iframe.contentWindow.WebForm_DoPostBackWithOptions(
            new iframe.contentWindow.WebForm_PostBackOptions(
              "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
            )
          );
        });

        doc = iframeDoc();
        var el;
        el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
        el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
        el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
        el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
        el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
        el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;

        // Submit
        await new Promise(function(resolve) {
          iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
          doc.getElementById('MainContent_btnEditSubmit').click();
        });

        var editUrl = iframe.contentWindow.location.href;
        if (editUrl.includes('ViewDetail.aspx')) {
          log('✅ Updated!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('📤 Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          log('❌ Edit may have failed', '#ef4444');
          skipCount++;
        }

      } else {
        // ── Path B: Not found — add new ─────────────────────────────────────
        // Check if the listing page shows no results
        var bodyText = doc ? doc.body.innerText : '';
        var isListing = currentUrl.includes('CustomerSearchListing');
        var hasResults = isListing && !bodyText.includes('No records found') && !bodyText.includes('0 records');

        if (hasResults) {
          // There are results but not a direct match — try clicking first
          var firstLink = doc.querySelector('#MainContent_gvCustomers a');
          if (firstLink) {
            await new Promise(function(resolve) {
              iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
              firstLink.click();
            });
            if (iframe.contentWindow.location.href.includes('ViewDetail.aspx')) {
              // Found via listing — edit it (same as Path A above)
              log('📝 Found via listing — editing...');
              await new Promise(function(resolve) {
                iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
                iframe.contentWindow.WebForm_DoPostBackWithOptions(
                  new iframe.contentWindow.WebForm_PostBackOptions(
                    "ctl00$MainContent$ViewDetailMenu1$BtnEditCustomer3", "", false, "", "ViewDetail.aspx?M=ED", false, true
                  )
                );
              });
              doc = iframeDoc();
              el = doc.getElementById('MainContent_eAccountNumber'); if (el) el.value = deal.account;
              el = doc.getElementById('MainContent_efirstname'); if (el) el.value = deal.firstName;
              el = doc.getElementById('MainContent_elastname'); if (el) el.value = deal.lastName;
              el = doc.getElementById('MainContent_eVIN'); if (el) el.value = deal.vin;
              el = doc.getElementById('MainContent_eColor'); if (el) el.value = deal.color;
              el = doc.getElementById('MainContent_eInventoryStockNumber'); if (el) el.value = deal.account;
              await new Promise(function(resolve) {
                iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
                doc.getElementById('MainContent_btnEditSubmit').click();
              });
              if (iframe.contentWindow.location.href.includes('ViewDetail.aspx')) {
                log('✅ Updated!', '#30d158');
                await sbPatch('deals', deal.id, { gps_uploaded: true });
                log('📤 Marked done in Supabase', '#30d158');
                successCount++;
                continue;
              }
            }
          }
        }

        // Not found — add new record
        log('➕ Not found — adding new record...');
        await navTo(BASE + 'Add.aspx');
        await sleep(1000);

        doc = iframeDoc();
        var imgEncore = doc.getElementById('MainContent_imgEncore');
        if (!imgEncore) {
          log('❌ Encore image not found on Add page', '#ef4444');
          skipCount++;
          continue;
        }

        await new Promise(function(resolve) {
          iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
          imgEncore.click();
        });

        if (!iframe.contentWindow.location.href.includes('addelite.aspx')) {
          log('❌ Did not reach addelite.aspx', '#ef4444');
          skipCount++;
          continue;
        }

        doc = iframeDoc();
        var dropdown = doc.getElementById('MainContent_DropDownList1');
        if (!dropdown) {
          log('❌ Serial dropdown not found', '#ef4444');
          skipCount++;
          continue;
        }

        // Check if serial is in dropdown
        var found = false;
        for (var j = 0; j < dropdown.options.length; j++) {
          if (dropdown.options[j].value === deal.serial || dropdown.options[j].text === deal.serial) {
            found = true;
            break;
          }
        }
        if (!found) {
          log('⏭️  Serial ' + deal.serial + ' not in Passtime inventory', '#f59e0b');
          skipCount++;
          continue;
        }

        // Fill form
        doc.getElementById('MainContent_txtInstallerFName').value = 'Vladimir';
        doc.getElementById('MainContent_txtInstallerLName').value = 'Arutyunov';
        dropdown.value = deal.serial;
        doc.getElementById('MainContent_AccountNumber').value = deal.account;
        doc.getElementById('MainContent_firstname').value = deal.firstName;
        doc.getElementById('MainContent_lastname').value = deal.lastName;
        doc.getElementById('MainContent_VIN').value = deal.vin;
        doc.getElementById('MainContent_Color').value = deal.color;

        // Submit
        await new Promise(function(resolve) {
          iframe.onload = function() { iframe.onload = null; setTimeout(resolve, 2000); };
          doc.getElementById('MainContent_btnAddCust').click();
        });

        var addUrl = iframe.contentWindow.location.href.toLowerCase();
        if (addUrl.includes('viewdetail.aspx')) {
          log('✅ Added!', '#30d158');
          await sbPatch('deals', deal.id, { gps_uploaded: true });
          log('📤 Marked done in Supabase', '#30d158');
          successCount++;
        } else {
          // Check for OASIS error
          doc = iframeDoc();
          if (doc && doc.body.innerText.includes('OASIS Error')) {
            log('❌ OASIS Error — session issue, try re-running', '#ef4444');
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
  log('\n════════════════════════════════');
  log('📊 DONE — ✅ ' + successCount + ' registered, ⏭️ ' + skipCount + ' skipped', successCount > 0 ? '#30d158' : '#f59e0b');
  log('════════════════════════════════');

  // Add close button
  var closeBtn = document.createElement('button');
  closeBtn.textContent = 'Close & Clean Up';
  closeBtn.style.cssText = 'margin-top:12px;padding:10px 24px;background:#30d158;border:none;border-radius:10px;color:#000;font-weight:700;font-size:14px;cursor:pointer;width:100%;';
  closeBtn.onclick = function() {
    panel.remove();
    iframe.remove();
  };
  logEl.appendChild(closeBtn);
})();
