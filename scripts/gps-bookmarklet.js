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
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div style="font-size:20px;font-weight:800;color:#30d158;">\u{1F6F0}\uFE0F GPS Sync</div><div id="gps-sync-close" style="cursor:pointer;font-size:22px;color:#666;padding:0 4px;line-height:1;" title="Close">\u2715</div></div><div id="gps-sync-log" style="white-space:pre-wrap;line-height:1.6;"></div>';
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

  // ── Supabase upsert helper ─────────────────────────────────────────────────
  async function sbUpsert(table, body) {
    var r = await fetch(SB_URL + '/rest/v1/' + table, {
      method: 'POST',
      headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
      body: JSON.stringify(body)
    });
    if (!r.ok) throw new Error('sbUpsert ' + table + ': ' + (await r.text()));
  }

  // ── Scrape GPS data from a ViewDetail page doc ────────────────────────────
  function scrapeGpsDetail(doc) {
    function txt(id) { var el = doc.getElementById('MainContent_' + id); return el ? (el.textContent || '').trim() : ''; }
    return {
      serial: txt('serialnumber'),
      battery: txt('LblEncoreBat'),
      powerMode: txt('LblEncorePwrMode'),
      lastReported: txt('Lbllastreport1'),
      airtimeExpires: txt('Lblairtime1'),
      product: txt('product'),
      verifyDate: txt('LblVerifyDate'),
      firstName: txt('firstname'),
      lastName: txt('lastname'),
      vin: txt('vin'),
      make: txt('make'),
      model: txt('model'),
      year: txt('year'),
      color: txt('color'),
      account: txt('account')
    };
  }

  // ── PHASE 0: Check for queued fetch/register tasks from the app ───────────
  log('\u{1F4E1} Checking for queued tasks...');
  var queuedTasks = [];
  try {
    var allSettings = await sbGet('app_settings', 'key=like.gps_fetch_*&select=key,value');
    var regSettings = await sbGet('app_settings', 'key=like.gps_register_*&select=key,value');
    allSettings.concat(regSettings).forEach(function(s) {
      try {
        var v = JSON.parse(s.value);
        if (v.status === 'queued') queuedTasks.push({ key: s.key, data: v });
      } catch(e) {}
    });
  } catch(e) {}

  if (queuedTasks.length) {
    log('Found ' + queuedTasks.length + ' queued task(s)', '#60a5fa');

    for (var qi = 0; qi < queuedTasks.length; qi++) {
      var task = queuedTasks[qi];
      var td = task.data;

      if (task.key.startsWith('gps_fetch_')) {
        // ── FETCH task: search Passtime by last name, scrape GPS data ──
        var acctId = td.account || task.key.replace('gps_fetch_', '');
        log('');
        log('\u{1F50D} FETCH: Searching for account ' + acctId + '...');

        try {
          // Search by account number first
          var sp = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
          var sf = getAspFields(sp.doc);
          sf['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'AccountNumber';
          sf['ctl00$searchCustomerCTL$searchTxt'] = acctId;
          sf['ctl00$searchCustomerCTL$searchBtn'] = 'Search';
          var rp = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', sf);

          var found = false;
          if (rp.url.includes('ViewDetail.aspx')) {
            found = true;
          } else if (rp.url.includes('CustomerSearchListing')) {
            var fl = rp.doc.querySelector('#MainContent_gvCustomers a');
            if (fl) {
              var hp = fl.getAttribute('href');
              if (hp) { rp = await fetchPage(BASE + hp); found = rp.url.includes('ViewDetail.aspx'); }
            }
          }

          // If not found by account, try by last name
          if (!found && td.last_name) {
            log('  Not found by account, trying last name: ' + td.last_name);
            sp = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
            sf = getAspFields(sp.doc);
            sf['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'LastName';
            sf['ctl00$searchCustomerCTL$searchTxt'] = td.last_name;
            sf['ctl00$searchCustomerCTL$searchBtn'] = 'Search';
            rp = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', sf);

            if (rp.url.includes('ViewDetail.aspx')) {
              found = true;
            } else if (rp.url.includes('CustomerSearchListing')) {
              // Multiple results — look for matching first name
              var rows = rp.doc.querySelectorAll('#MainContent_gvCustomers tr');
              for (var ri = 1; ri < rows.length; ri++) {
                var cells = rows[ri].querySelectorAll('td');
                if (cells.length > 1) {
                  var rowName = (cells[1].textContent || '').toLowerCase();
                  if (td.first_name && rowName.includes(td.first_name.toLowerCase())) {
                    var rl = rows[ri].querySelector('a');
                    if (rl) {
                      var rh = rl.getAttribute('href');
                      if (rh) { rp = await fetchPage(BASE + rh); found = rp.url.includes('ViewDetail.aspx'); }
                    }
                    break;
                  }
                }
              }
              // Fallback: click first result
              if (!found) {
                var firstLink = rp.doc.querySelector('#MainContent_gvCustomers a');
                if (firstLink) {
                  var fh = firstLink.getAttribute('href');
                  if (fh) { rp = await fetchPage(BASE + fh); found = rp.url.includes('ViewDetail.aspx'); }
                }
              }
            }
          }

          if (found) {
            var gd = scrapeGpsDetail(rp.doc);
            log('\u2705 Found: ' + gd.firstName + ' ' + gd.lastName + ' | Serial: ' + gd.serial, '#30d158');
            log('  Battery: ' + gd.battery + ' | Last: ' + gd.lastReported);

            // Save to repo_gps_signals
            var now = new Date().toISOString();
            await sbUpsert('repo_gps_signals', {
              account: acctId,
              customer_name: (td.last_name || gd.lastName).toUpperCase() + ', ' + (td.first_name || gd.firstName).toUpperCase(),
              battery_status: gd.battery || 'Unknown',
              battery_low: (gd.battery || '').toLowerCase() === 'low' || (gd.battery || '').toLowerCase() === 'fair',
              last_seen: gd.lastReported && !isNaN(new Date(gd.lastReported).getTime()) ? new Date(gd.lastReported).toISOString() : null,
              updated_at: now,
              updated_by: 'GPS Bookmarklet'
            });

            // Write success result
            await sbUpsert('app_settings', {
              key: task.key,
              value: JSON.stringify({
                status: 'success',
                message: 'Found in Passtime',
                serial: gd.serial,
                batteryStatus: gd.battery,
                powerMode: gd.powerMode,
                lastReported: gd.lastReported,
                airtimeExpires: gd.airtimeExpires,
                timestamp: now
              })
            });
            log('\u{1F4E4} Saved to app', '#30d158');
          } else {
            log('\u274C Not found in Passtime', '#ff453a');
            await sbUpsert('app_settings', {
              key: task.key,
              value: JSON.stringify({ status: 'error', message: 'Not found in Passtime', timestamp: new Date().toISOString() })
            });
          }
        } catch(fe) {
          log('\u274C Fetch error: ' + fe.message, '#ef4444');
          await sbUpsert('app_settings', { key: task.key, value: JSON.stringify({ status: 'error', message: fe.message, timestamp: new Date().toISOString() }) });
        }

      } else if (task.key.startsWith('gps_register_')) {
        // ── REGISTER task: add/update serial in Passtime ──
        var serial = td.serial || task.key.replace('gps_register_', '');
        log('');
        log('\u{1F4E1} REGISTER: Serial ' + serial + ' for ' + (td.first_name || '') + ' ' + (td.last_name || ''));

        // This uses the same push logic as the existing bookmarklet
        // Search first to see if serial exists
        try {
          var sp2 = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
          var sf2 = getAspFields(sp2.doc);
          sf2['ctl00$searchCustomerCTL$searchCustomerDDL'] = 'SerialNumber';
          sf2['ctl00$searchCustomerCTL$searchTxt'] = serial;
          sf2['ctl00$searchCustomerCTL$searchBtn'] = 'Search';
          var rp2 = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', sf2);

          if (rp2.url.includes('ViewDetail.aspx')) {
            // Already exists — edit it
            log('  Found existing — editing...');
            var editPage = await fetchPage(BASE + 'ViewDetail.aspx?M=ED');
            var editFields = getAspFields(editPage.doc);
            editFields['ctl00$MainContent$eAccountNumber'] = td.account || '';
            editFields['ctl00$MainContent$efirstname'] = td.first_name || '';
            editFields['ctl00$MainContent$elastname'] = td.last_name || '';
            editFields['ctl00$MainContent$eVIN'] = td.vin || '';
            editFields['ctl00$MainContent$eColor'] = td.color || '';
            editFields['ctl00$MainContent$eInventoryStockNumber'] = td.account || '';
            editFields['ctl00$MainContent$btnEditSubmit'] = 'Submit';
            var saveRes = await postForm(BASE + 'ViewDetail.aspx?M=ED', editFields);

            if (saveRes.url.includes('ViewDetail.aspx') && !saveRes.url.includes('M=ED')) {
              // Scrape updated data
              var gd2 = scrapeGpsDetail(saveRes.doc);
              log('\u2705 Updated!', '#30d158');
              await sbUpsert('app_settings', {
                key: task.key,
                value: JSON.stringify({ status: 'success', message: 'Updated in Passtime', serial: serial, batteryStatus: gd2.battery, timestamp: new Date().toISOString() })
              });
            } else {
              log('\u274C Edit may have failed', '#ef4444');
              await sbUpsert('app_settings', { key: task.key, value: JSON.stringify({ status: 'error', message: 'Edit failed', timestamp: new Date().toISOString() }) });
            }
          } else {
            // Not found — add new (same iframe approach as push mode)
            log('  Not found — will be added during push phase if in inventory');
            await sbUpsert('app_settings', {
              key: task.key,
              value: JSON.stringify({ status: 'error', message: 'Serial not found in Passtime. Run full GPS sync to add it.', timestamp: new Date().toISOString() })
            });
          }
        } catch(re) {
          log('\u274C Register error: ' + re.message, '#ef4444');
          await sbUpsert('app_settings', { key: task.key, value: JSON.stringify({ status: 'error', message: re.message, timestamp: new Date().toISOString() }) });
        }
      }

      await sleep(1000);
    }
    log('');
  }

  // ── PHASE 1: Pull GPS data for ALL finance customers ───────────────────────
  log('\u{1F4E1} Pulling GPS data for all finance customers...');
  var allFinance = [];
  try {
    allFinance = await sbGet('deals', 'deal_type=eq.finance&select=id,customer_name,vin,stock,gps_serial&order=created_at.desc');
  } catch(e) {
    log('\u26a0\ufe0f Could not fetch deals: ' + e.message, '#f59e0b');
  }

  // Also fetch all CarPay customers (covers old deals without deal records)
  var allCarpay = [];
  try {
    allCarpay = await sbGet('carpay_customers', 'select=account,name,location');
  } catch(e) {
    log('\u26a0\ufe0f Could not fetch CarPay customers: ' + e.message, '#f59e0b');
  }

  // Get existing GPS signals to know which accounts already have data
  var existingGps = {};
  try {
    var gpsRows = await sbGet('repo_gps_signals', 'select=account,updated_at,battery_mode');
    gpsRows.forEach(function(g) { existingGps[g.account] = g; });
  } catch(e) {}

  // Build pull targets from deals (search by VIN) and CarPay customers (search by account)
  var pullTargets = [];
  var seenAccounts = {};
  var oneDayAgo = new Date(Date.now() - 86400000).toISOString();

  // Skip logic: skip if battery_mode is already populated AND updated within 24h
  function shouldSkip(acct) {
    var ex = existingGps[acct];
    return ex && ex.battery_mode && ex.updated_at > oneDayAgo;
  }

  // First: deals with VINs
  allFinance.forEach(function(d) {
    if (!d.vin) return;
    var acct = d.stock || String(d.id);
    if (shouldSkip(acct)) return;
    seenAccounts[acct] = true;
    pullTargets.push({ name: d.customer_name, vin: d.vin, account: acct, searchBy: 'VinNumber' });
  });

  // Second: CarPay customers not already covered by a deal
  var dbg = { dealDup: 0, skipped: 0, noName: 0, added: 0 };
  allCarpay.forEach(function(c) {
    if (seenAccounts[c.account]) { dbg.dealDup++; return; }
    if (shouldSkip(c.account)) { dbg.skipped++; return; }
    // Parse name: "LAST, FIRST" → last name for search
    var nameParts = (c.name || '').split(',');
    var lastName = (nameParts[0] || '').trim();
    var firstName = (nameParts[1] || '').trim().split(' ')[0] || '';
    if (!lastName) { dbg.noName++; return; }
    dbg.added++;
    pullTargets.push({ name: c.name, account: c.account, lastName: lastName, firstName: firstName, searchBy: 'LastName' });
  });

  log('Finance deals: ' + allFinance.length + ' (' + pullTargets.filter(function(t){return t.searchBy==='VinNumber';}).length + ' with VIN)', '#60a5fa');
  log('CarPay customers: ' + allCarpay.length + ' → ' + dbg.added + ' to search', '#60a5fa');
  log('  Skipped: ' + dbg.dealDup + ' already in deals, ' + dbg.skipped + ' fresh GPS, ' + dbg.noName + ' no name', '#888');
  log(pullTargets.length + ' total targets need GPS refresh');

  if (pullTargets.length > 0) {
    var pullSuccess = 0;
    var pullSkip = 0;

    for (var pi = 0; pi < pullTargets.length; pi++) {
      var pt = pullTargets[pi];
      log('');
      log('\u{1F50D} ' + (pi+1) + '/' + pullTargets.length + ': ' + pt.name);

      try {
        // Search by VIN or last name depending on source
        var searchVal = pt.searchBy === 'VinNumber' ? pt.vin : (pt.searchBy === 'LastName' ? pt.lastName : pt.account);
        var ps = await fetchPage(SEARCH_BASE + 'CustomerRpt.aspx');
        var pf = getAspFields(ps.doc);
        pf['ctl00$searchCustomerCTL$searchCustomerDDL'] = pt.searchBy;
        pf['ctl00$searchCustomerCTL$searchTxt'] = searchVal;
        pf['ctl00$searchCustomerCTL$searchBtn'] = 'Search';
        var pr = await postForm(SEARCH_BASE + 'CustomerRpt.aspx', pf);

        var pfound = false;
        if (pr.url.includes('ViewDetail.aspx')) {
          pfound = true;
        } else if (pr.url.includes('CustomerSearchListing')) {
          // Multiple results — match by first name only, never guess
          var rows = pr.doc.querySelectorAll('#MainContent_gvCustomers tr');
          if (pt.firstName && rows.length > 1) {
            for (var ri = 1; ri < rows.length; ri++) {
              var cells = rows[ri].querySelectorAll('td');
              if (cells.length > 1) {
                var rowName = (cells[1].textContent || '').toLowerCase();
                if (rowName.includes(pt.firstName.toLowerCase())) {
                  var rl = rows[ri].querySelector('a');
                  if (rl) {
                    var rh = rl.getAttribute('href');
                    if (rh) { pr = await fetchPage(BASE + rh); pfound = pr.url.includes('ViewDetail.aspx'); }
                  }
                  break;
                }
              }
            }
          }
          if (!pfound) { log('  Multiple results, no first name match — skipped', '#888'); }
        }

        if (pfound) {
          var pgd = scrapeGpsDetail(pr.doc);

          // Verify this is actually our customer (not a different dealer's customer with same last name)
          var detailFirst = (pgd.firstName || '').toLowerCase();
          var detailLast = (pgd.lastName || '').toLowerCase();
          var searchFirst = (pt.firstName || '').toLowerCase();
          var searchLast = (pt.lastName || '').toLowerCase();
          if (searchFirst && detailFirst && !detailFirst.includes(searchFirst) && !searchFirst.includes(detailFirst)) {
            log('  Name mismatch: searched ' + pt.firstName + ' ' + pt.lastName + ', found ' + pgd.firstName + ' ' + pgd.lastName + ' — skipped', '#f59e0b');
            pfound = false;
          }
        }

        if (pfound) {

          // Navigate to ViewMap.aspx to get location/address
          var locAddress = null;
          var locLat = null;
          var locLong = null;
          var locState = null;
          var outOfState = false;
          var uniqueLocations = null;
          var locationPins = null;
          try {
            var mapFields = getAspFields(pr.doc);
            mapFields['__EVENTTARGET'] = 'ctl00$MainContent$ViewDetailMenu1$LnkBtnLocateTRAX';
            mapFields['__EVENTARGUMENT'] = '';
            var mapUrl = pr.url.replace(/ViewDetail\.aspx/i, 'ViewMap.aspx');
            var mapPage = await postForm(mapUrl, mapFields);
            if (mapPage.url.includes('ViewMap.aspx')) {
              var mapDoc = mapPage.doc;
              var addrEl = mapDoc.getElementById('MainContent_TabContainer1_TabPanel1_LblAddress');
              var latEl = mapDoc.getElementById('MainContent_TabContainer1_TabPanel1_LblLat');
              var lngEl = mapDoc.getElementById('MainContent_TabContainer1_TabPanel1_LblLong');
              if (addrEl) locAddress = (addrEl.textContent || '').replace(/^Address:\s*/i, '').trim();
              if (latEl) locLat = (latEl.textContent || '').replace(/^Lat:\s*/i, '').trim();
              if (lngEl) locLong = (lngEl.textContent || '').replace(/^Long:\s*/i, '').trim();
              // Detect state from address
              if (locAddress) {
                var stMatch = locAddress.match(/,\s*([A-Z]{2})\s+\d{5}/);
                if (stMatch) {
                  locState = stMatch[1];
                  outOfState = locState !== 'FL';
                }
              }
              // Scrape location history (TabPanel2) for unique addresses
              try {
                var histTab = mapDoc.getElementById('MainContent_TabContainer1_TabPanel2');
                if (!histTab) {
                  // Click the Location History tab to load it
                  var tabFields = getAspFields(mapDoc);
                  tabFields['__EVENTTARGET'] = 'ctl00$MainContent$TabContainer1';
                  tabFields['__EVENTARGUMENT'] = 'activeTabChanged:1';
                  var histPage = await postForm(mapPage.url, tabFields);
                  histTab = histPage.doc.getElementById('MainContent_TabContainer1_TabPanel2');
                }
                if (histTab) {
                  var histRows = histTab.querySelectorAll('table tr');
                  var addrs = {};
                  var pinCount = 0;
                  for (var hi = 1; hi < histRows.length && pinCount < 20; hi++) {
                    var hCells = histRows[hi].querySelectorAll('td');
                    if (hCells.length >= 3) {
                      var addr = (hCells[2].textContent || '').trim();
                      if (addr) { addrs[addr] = true; pinCount++; }
                    }
                  }
                  uniqueLocations = Object.keys(addrs).length;
                  locationPins = pinCount;
                }
              } catch(histErr) { /* history scrape failed, no big deal */ }
            }
          } catch(mapErr) { /* location scrape failed, continue with what we have */ }

          var addrLog = locAddress ? ' | 📌 ' + locAddress : '';
          var modeLog = pgd.powerMode ? ' | Mode: ' + pgd.powerMode : '';
          log('\u2705 Serial: ' + pgd.serial + ' | Battery: ' + pgd.battery + modeLog + addrLog, '#30d158');

          // Parse customer name for storage
          var nameParts = (pt.name || '').trim().split(/\s+/);
          var storedName = nameParts.length > 1
            ? nameParts.slice(1).join(' ').toUpperCase() + ', ' + nameParts[0].toUpperCase()
            : (pt.name || '').toUpperCase();

          await sbUpsert('repo_gps_signals', {
            account: pt.account,
            customer_name: storedName,
            battery_status: pgd.battery || 'Unknown',
            battery_mode: pgd.powerMode || null,
            battery_low: (pgd.battery || '').toLowerCase() === 'low' || (pgd.battery || '').toLowerCase() === 'fair',
            last_seen: pgd.lastReported && !isNaN(new Date(pgd.lastReported).getTime()) ? new Date(pgd.lastReported).toISOString() : null,
            last_address: locAddress || null,
            last_state: locState || null,
            out_of_state: outOfState,
            unique_locations: uniqueLocations,
            location_pins: locationPins,
            updated_at: new Date().toISOString(),
            updated_by: 'GPS Bookmarklet'
          });
          pullSuccess++;
        } else {
          log('  Not in Passtime', '#888');
          pullSkip++;
        }
      } catch(pe) {
        log('  Error: ' + pe.message, '#ef4444');
        pullSkip++;
      }

      await sleep(300);
    }

    log('');
    log('Pull complete: \u2705 ' + pullSuccess + ' updated, \u23ED\uFE0F ' + pullSkip + ' not found', pullSuccess > 0 ? '#30d158' : '#888');
  }

  // ── PHASE 2: Push new deals to Passtime (existing behavior) ───────────────
  log('');
  log('\u{1F4E1} Checking for new deals to push...');
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
    log('\u2705 No new deals to push!', '#30d158');
    log('');
    log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
    log('\u{1F4CA} GPS SYNC COMPLETE', '#30d158');
    log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
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
  var dashText = dashPage.doc.body ? (dashPage.doc.body.textContent || '') : '';
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
        var bodyText = resultDoc.body ? (resultDoc.body.textContent || '') : '';

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

        // ── Path B: Not found — add new via iframe ────────────────────────
        log('\u2795 Not found \u2014 adding new...');

        // Helper: load a URL in a hidden iframe and wait for it
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

        function iframeWait(ifr, checkFn, timeout) {
          return new Promise(function(resolve, reject) {
            var start = Date.now();
            var interval = setInterval(function() {
              try {
                var result = checkFn(ifr);
                if (result) { clearInterval(interval); resolve(result); }
              } catch(e) {}
              if (Date.now() - start > (timeout || 10000)) {
                clearInterval(interval);
                reject(new Error('iframe wait timeout'));
              }
            }, 500);
          });
        }

        try {
          // Step 1: Load Add.aspx in iframe
          var ifr = await iframeNav(BASE + 'Add.aspx');
          var ifrDoc = ifr.contentDocument || ifr.contentWindow.document;

          // Step 2: Click Encore image
          var encoreImg = ifrDoc.querySelector('#MainContent_imgEncore');
          if (!encoreImg) {
            log('\u274C Encore not found on Add page', '#ef4444');
            skipCount++;
            continue;
          }
          encoreImg.click();

          // Step 3: Wait for AddElite page to load
          await new Promise(function(r) { ifr.onload = r; setTimeout(r, 5000); });
          await sleep(1000);
          ifrDoc = ifr.contentDocument || ifr.contentWindow.document;

          var dropdown = ifrDoc.querySelector('#MainContent_DropDownList1');
          if (!dropdown) {
            log('\u274C Serial dropdown not found on AddElite', '#ef4444');
            log('  iframe URL: ' + ifr.contentWindow.location.href, '#888');
            skipCount++;
            continue;
          }

          // Step 4: Check if serial is in dropdown
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

          // Step 5: Fill and submit the form
          ifrDoc.getElementById('MainContent_txtInstallerFName').value = 'Vladimir';
          ifrDoc.getElementById('MainContent_txtInstallerLName').value = 'Arutyunov';
          dropdown.value = deal.serial;
          ifrDoc.getElementById('MainContent_AccountNumber').value = deal.account;
          ifrDoc.getElementById('MainContent_firstname').value = deal.firstName;
          ifrDoc.getElementById('MainContent_lastname').value = deal.lastName;
          ifrDoc.getElementById('MainContent_VIN').value = deal.vin;
          ifrDoc.getElementById('MainContent_Color').value = deal.color;
          ifrDoc.getElementById('MainContent_btnAddCust').click();

          // Step 6: Wait for result
          await new Promise(function(r) { ifr.onload = r; setTimeout(r, 5000); });
          await sleep(1000);
          var resultUrl = ifr.contentWindow.location.href.toLowerCase();

          if (resultUrl.includes('viewdetail.aspx')) {
            log('\u2705 Added!', '#30d158');
            await sbPatch('deals', deal.id, { gps_uploaded: true });
            log('\u{1F4E4} Marked done in Supabase', '#30d158');
            successCount++;
          } else {
            var resultText = (ifr.contentDocument || ifr.contentWindow.document).body.innerText || '';
            if (resultText.includes('OASIS Error')) {
              log('\u274C OASIS Error', '#ef4444');
            } else {
              log('\u274C Add may have failed', '#ef4444');
              log('  URL: ' + ifr.contentWindow.location.href, '#888');
            }
            skipCount++;
          }
        } catch(addErr) {
          log('\u274C Add error: ' + addErr.message, '#ef4444');
          skipCount++;
        }
        // Clean up iframe
        var oldIfr = document.getElementById('gps-sync-iframe');
        if (oldIfr) oldIfr.remove();
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
