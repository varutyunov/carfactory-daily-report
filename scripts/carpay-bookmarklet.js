/**
 * CarPay Sync Bookmarklet
 * Run from dealers.carpay.com while logged in.
 * Syncs all customers + payments to Supabase.
 */
(async function() {
  'use strict';

  var SB_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
  var SB_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';
  var SB_HEADERS = {
    'apikey': SB_KEY,
    'Authorization': 'Bearer ' + SB_KEY,
    'Content-Type': 'application/json',
    'Prefer': 'return=representation'
  };

  // ── Guard ───────────────────────────────────────────────────────────────────
  if (!location.hostname.includes('carpay.com')) {
    alert('Run this bookmarklet from dealers.carpay.com');
    return;
  }

  // ── Status Panel ────────────────────────────────────────────────────────────
  if (document.getElementById('cp-sync-panel')) document.getElementById('cp-sync-panel').remove();
  var panel = document.createElement('div');
  panel.id = 'cp-sync-panel';
  panel.style.cssText = 'position:fixed;top:10px;right:10px;width:400px;max-height:90vh;overflow-y:auto;background:#111;color:#fff;border:2px solid #60a5fa;border-radius:16px;padding:20px;z-index:99999;font-family:system-ui,sans-serif;font-size:14px;box-shadow:0 8px 32px rgba(0,0,0,.6);';
  panel.innerHTML = '<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;"><div style="font-size:20px;font-weight:800;color:#60a5fa;">🔄 CarPay Sync</div><div id="cp-sync-close" style="cursor:pointer;font-size:22px;color:#666;padding:0 4px;line-height:1;" title="Close">✕</div></div>'
    + '<div id="cp-sync-loc" style="display:flex;gap:8px;margin-bottom:14px;">'
    + '<button id="cp-loc-debary" onclick="window._cpLocSet(\'debary\')" style="flex:1;padding:8px;background:#1d4ed8;border:none;border-radius:8px;color:#fff;font-weight:700;cursor:pointer;">DeBary</button>'
    + '<button id="cp-loc-deland" onclick="window._cpLocSet(\'deland\')" style="flex:1;padding:8px;background:#333;border:none;border-radius:8px;color:#888;font-weight:700;cursor:pointer;">DeLand</button>'
    + '</div>'
    + '<button id="cp-sync-run" onclick="window._cpRun()" style="width:100%;padding:10px;background:linear-gradient(135deg,#1d4ed8,#3b82f6);border:none;border-radius:8px;color:#fff;font-size:14px;font-weight:700;cursor:pointer;margin-bottom:12px;">▶ Run Sync</button>'
    + '<div id="cp-sync-log" style="white-space:pre-wrap;line-height:1.7;font-size:13px;"></div>';
  document.body.appendChild(panel);
  document.getElementById('cp-sync-close').onclick = function() { panel.remove(); delete window._cpLocSet; delete window._cpRun; };

  var logEl = document.getElementById('cp-sync-log');
  function log(msg, color) {
    var line = document.createElement('div');
    line.textContent = msg;
    if (color) line.style.color = color;
    logEl.appendChild(line);
    panel.scrollTop = panel.scrollHeight;
  }
  function sleep(ms) { return new Promise(function(r) { setTimeout(r, ms); }); }

  var _loc = 'debary';
  window._cpLocSet = function(loc) {
    _loc = loc;
    document.getElementById('cp-loc-debary').style.background = loc === 'debary' ? '#1d4ed8' : '#333';
    document.getElementById('cp-loc-debary').style.color = loc === 'debary' ? '#fff' : '#888';
    document.getElementById('cp-loc-deland').style.background = loc === 'deland' ? '#1d4ed8' : '#333';
    document.getElementById('cp-loc-deland').style.color = loc === 'deland' ? '#fff' : '#888';
  };

  // ── Supabase helpers ────────────────────────────────────────────────────────
  async function sbUpsert(table, rows, conflictCol) {
    if (!rows.length) return 0;
    var done = 0;
    for (var i = 0; i < rows.length; i += 50) {
      var batch = rows.slice(i, i + 50);
      var r = await fetch(SB_URL + '/rest/v1/' + table, {
        method: 'POST',
        headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'return=minimal' }),
        body: JSON.stringify(batch)
      });
      if (r.ok) done += batch.length;
      else { var errTxt = await r.text(); log('  ⚠ Upsert error (batch ' + i + '): ' + errTxt.slice(0, 200), '#f59e0b'); }
    }
    return done;
  }

  async function sbDeleteByLocation(table, loc) {
    await fetch(SB_URL + '/rest/v1/' + table + '?location=eq.' + loc, {
      method: 'DELETE',
      headers: SB_HEADERS
    });
  }

  // ── Parse individual customer page ─────────────────────────────────────────
  function parseCustomerPage(html, carpayId) {
    var parser = new DOMParser();
    var doc = parser.parseFromString(html, 'text/html');
    var text = doc.body ? (doc.body.textContent || doc.body.innerText || '') : '';

    // Vehicle — pattern: "Login as Customer YEAR MAKE MODEL Customer ID: NNNN"
    var vehicle = '';
    var vMatch = text.match(/Login as Customer\s+(\d{4}\s+[A-Za-z]+(?:\s+[A-Za-z]+)*)\s+Customer ID/);
    if (vMatch) vehicle = vMatch[1].trim();
    if (!vehicle) {
      // Fallback: "YEAR MAKE MODEL Customer ID:"
      var vMatch2 = text.match(/(\d{4}\s+[A-Za-z]+\s+[A-Za-z]+)\s+Customer ID/);
      if (vMatch2) vehicle = vMatch2[1].trim();
    }

    // Scheduled amount
    var schedMatch = text.match(/Regular Scheduled Amount:\s*\$([\d,]+\.?\d*)/i);
    var scheduledAmount = schedMatch ? '$' + schedMatch[1] : '';

    // Payment frequency
    var freqMatch = text.match(/Payment Frequency:\s*([A-Za-z-]+)/i);
    var paymentFrequency = freqMatch ? freqMatch[1] : '';

    // Current amount due
    var dueMatch = text.match(/Current Amount Due:\s*\$([\d,]+\.?\d*)/i);
    var currentAmountDue = dueMatch ? parseFloat(dueMatch[1].replace(/,/g, '')) : null;

    // Phone — from tel: links, skip CarPay support (877)
    var phone = '';
    var telLinks = doc.querySelectorAll('a[href^="tel:"]');
    for (var ti = 0; ti < telLinks.length; ti++) {
      var ph = (telLinks[ti].getAttribute('href') || '').replace(/^tel:/, '').replace(/\D/g, '');
      if (ph.length === 11 && ph[0] === '1') ph = ph.slice(1);
      if (ph.length === 10 && !ph.startsWith('877') && !ph.startsWith('800') && !ph.startsWith('888')) { phone = ph; break; }
    }
    if (!phone) {
      // Fallback: regex, skip toll-free
      var allPhones = text.match(/\+?1?\s*\((\d{3})\)\s*(\d{3})[.\-\s](\d{4})/g) || [];
      for (var pi2 = 0; pi2 < allPhones.length; pi2++) {
        var digits = allPhones[pi2].replace(/\D/g, '');
        if (digits.length === 11 && digits[0] === '1') digits = digits.slice(1);
        if (digits.length === 10 && !digits.startsWith('877') && !digits.startsWith('800') && !digits.startsWith('888')) { phone = digits; break; }
      }
    }

    // Email — try DOM elements first, then regex
    var email = '';
    var emailEl = doc.querySelector('a[href^="mailto:"], [data-email], input[type="email"], input[name*="email"]');
    if (emailEl) {
      var emVal = emailEl.getAttribute('href') || emailEl.getAttribute('data-email') || emailEl.value || emailEl.textContent || '';
      email = emVal.replace(/^mailto:/, '').trim().toLowerCase();
    }
    if (!email || !email.includes('@')) {
      var emailMatch = text.match(/([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
      email = emailMatch ? emailMatch[1].toLowerCase() : '';
    }

    // Payment history
    var payments = [];
    var rows = doc.querySelectorAll('#customer-payment-history-table tbody tr, #payment-history-table tbody tr, table tbody tr');
    rows.forEach(function(tr) {
      var cells = tr.querySelectorAll('td');
      if (cells.length >= 4) {
        var dateStr = cells[0] ? (cells[0].textContent || '').trim() : '';
        var status = cells[1] ? (cells[1].textContent || '').trim() : '';
        var method = cells[2] ? (cells[2].textContent || '').trim() : '';
        var amount = cells[3] ? (cells[3].textContent || '').trim() : '';
        // Accept successful/approved payments (various status text)
        var statusLow = status.toLowerCase();
        var isValid = statusLow.includes('success') || statusLow.includes('approved') || statusLow.includes('complete') || statusLow.includes('paid') || statusLow.includes('settled');
        if (dateStr && amount && amount.includes('$') && isValid) {
          payments.push({ date: dateStr, status: status, method: method, amount: amount });
        }
      }
    });

    return { vehicle, scheduledAmount, paymentFrequency, currentAmountDue, phone, email, payments };
  }

  // ── Main run ────────────────────────────────────────────────────────────────
  window._cpRun = async function() {
    document.getElementById('cp-sync-run').disabled = true;
    document.getElementById('cp-sync-loc').style.display = 'none';
    logEl.innerHTML = '';

    log('📍 Location: ' + _loc.toUpperCase());
    log('');

    // ── Step 1: Read customers from list page ───────────────────────────────
    log('👥 Reading customer list...');
    var onCustomerPage = location.pathname.includes('/dms/customers') && !location.pathname.includes('/dms/customer/');

    var customers = [];
    if (onCustomerPage) {
      // Already on the customers page — read from DOM
      try {
        var api = jQuery('#customers-table').DataTable();
        api.page.len(-1).draw(false);
        await sleep(500);
      } catch(e) {}

      var rows = document.querySelectorAll('#customers-table tbody tr');
      rows.forEach(function(tr) {
        var cells = tr.querySelectorAll('td');
        var link = tr.querySelector('a[href*="/dms/customer/"]');
        var href = link ? link.getAttribute('href') : '';
        var idMatch = href.match(/\/dms\/customer\/(\d+)/);
        var autoPay = cells[4] ? cells[4].innerText.trim().toLowerCase() === 'yes' : false;
        if (cells[0] && cells[0].innerText.trim()) {
          customers.push({
            name: cells[0].innerText.trim(),
            account: cells[1] ? cells[1].innerText.trim() : '',
            next_payment: cells[7] ? cells[7].innerText.trim() : '',
            days_late: parseInt(cells[8] ? cells[8].innerText.trim().replace(/[()]/g,'') : '0') || 0,
            auto_pay: autoPay,
            carpay_id: idMatch ? idMatch[1] : '',
            location: _loc
          });
        }
      });
    } else {
      // Navigate to customers page
      var r = await fetch('/dms/customers', { credentials: 'include' });
      var html = await r.text();
      var parser = new DOMParser();
      var doc = parser.parseFromString(html, 'text/html');
      var rows = doc.querySelectorAll('#customers-table tbody tr');
      rows.forEach(function(tr) {
        var cells = tr.querySelectorAll('td');
        var link = tr.querySelector('a[href*="/dms/customer/"]');
        var href = link ? link.getAttribute('href') : '';
        var idMatch = href.match(/\/dms\/customer\/(\d+)/);
        if (cells[0] && (cells[0].textContent || '').trim()) {
          customers.push({
            name: (cells[0].textContent || '').trim(),
            account: cells[1] ? (cells[1].textContent || '').trim() : '',
            next_payment: cells[7] ? (cells[7].textContent || '').trim() : '',
            days_late: parseInt(cells[8] ? (cells[8].textContent || '').trim().replace(/[()]/g,'') : '0') || 0,
            auto_pay: false,
            carpay_id: idMatch ? idMatch[1] : '',
            location: _loc
          });
        }
      });
    }

    log('✅ Found ' + customers.length + ' customers', '#30d158');

    // Safety check: don't wipe database if we found suspiciously few customers
    if (customers.length < 10) {
      log('');
      log('⛔ SAFETY STOP: Only found ' + customers.length + ' customers.', '#ef4444');
      log('   Expected 50+. Are you on the customers list page?', '#ef4444');
      log('   Go to dealers.carpay.com/dms/customers first.', '#f59e0b');
      document.getElementById('cp-sync-run').disabled = false;
      document.getElementById('cp-sync-loc').style.display = 'flex';
      return;
    }

    // ── Step 2: Fetch individual pages for contact/vehicle/balance ──────────
    log('');
    // Load existing customer data to skip detail fetch for customers we already have
    var existingMap = {};
    try {
      var exRes = await fetch(SB_URL + '/rest/v1/carpay_customers?location=eq.' + _loc + '&select=account,phone,email,vehicle,scheduled_amount,payment_frequency,current_amount_due', {
        headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' })
      });
      if (exRes.ok) {
        (await exRes.json()).forEach(function(c) { existingMap[c.account] = c; });
      }
    } catch(e) {}

    var needFetch = customers.filter(function(c) {
      var ex = existingMap[c.account];
      if (ex && ex.phone && ex.vehicle) {
        // Carry forward existing data
        c.phone = ex.phone; c.email = ex.email || ''; c.vehicle = ex.vehicle;
        c.scheduled_amount = ex.scheduled_amount || ''; c.payment_frequency = ex.payment_frequency || '';
        c.current_amount_due = ex.current_amount_due;
        return false;
      }
      return true;
    });
    var skipped = customers.length - needFetch.length;

    log('📋 Fetching customer details (phone, vehicle, balance)...');
    if (skipped) log('   ⚡ ' + skipped + ' already cached, fetching ' + needFetch.length + ' remaining', '#60a5fa');
    else log('   This takes ~' + Math.ceil(needFetch.length * 1.5 / 2) + ' seconds (throttled to avoid IP ban)...');

    var customerPayments = []; // collect payment history from each customer's payment-history tab
    var dealerId = location.search.match(/dealerId=(\d+)/) ? location.search.match(/dealerId=(\d+)/)[1] : '';
    if (!dealerId) {
      var dMatch = document.body.innerHTML.match(/dealerId[=:][\s"']*(\d+)/);
      if (dMatch) dealerId = dMatch[1];
    }
    // Fallback to known dealer IDs
    if (!dealerId) dealerId = _loc === 'deland' ? '657' : '656';
    log('   🔑 dealerId: ' + dealerId, '#888');
    var batchSize = 2; // Throttled: 2 at a time to avoid rate limiting
    for (var i = 0; i < needFetch.length; i += batchSize) {
      var batch = needFetch.slice(i, i + batchSize);
      await Promise.all(batch.map(async function(cust) {
        if (!cust.carpay_id) return;
        try {
          // Fetch main customer page for contact/vehicle/balance info
          var r = await fetch('/dms/customer/' + cust.carpay_id, { credentials: 'include' });
          var html = await r.text();
          var details = parseCustomerPage(html, cust.carpay_id);
          cust.vehicle = details.vehicle || '';
          cust.phone = details.phone || '';
          cust.email = details.email || '';
          cust.scheduled_amount = details.scheduledAmount || '';
          cust.payment_frequency = details.paymentFrequency || '';
          cust.current_amount_due = details.currentAmountDue;
          // Debug: log first 3 customer details
          if (i === 0) {
            log('  📊 ' + cust.name + ': ph=' + (cust.phone||'none') + ' em=' + (cust.email||'none') + ' veh=' + (cust.vehicle||'none'), '#f59e0b');
          }

          // Fetch payment history tab — separate page from customer detail
          try {
            var phUrl = '/dms/customer/' + cust.carpay_id + '?dealerId=' + dealerId + '&tabId=payment-history';
            var pr = await fetch(phUrl, { credentials: 'include' });
            if (pr.ok) {
              var phtml = await pr.text();
              var phPays = parseCustomerPage(phtml, cust.carpay_id).payments;
              // Debug: log payment results for first 5 customers
              if (customerPayments.length === 0 && i < batchSize * 5) {
                log('    💳 ' + cust.name + ': ' + phPays.length + ' payments (html=' + phtml.length + ', hasTable=' + (phtml.indexOf('customer-payment-history-table') !== -1) + ')', '#888');
              }
              if (phPays && phPays.length) {
                phPays.forEach(function(p) {
                  customerPayments.push({
                    location: _loc,
                    carpay_id: cust.carpay_id,
                    name: cust.name,
                    account: cust.account,
                    reference: '',
                    date: p.date,
                    time: '',
                    method: p.method || '',
                    amount_sent: p.amount || '$0.00'
                  });
                });
              }
            } else {
              log('    💳 ' + cust.name + ': HTTP ' + pr.status, '#ef4444');
            }
          } catch(e) {
            log('    💳 ' + cust.name + ': ERROR ' + e.message, '#ef4444');
          }
        } catch(e) {
          // skip
        }
      }));
      var pct = Math.min(100, Math.round(((i + batchSize) / needFetch.length) * 100));
      log('   ' + pct + '% (' + Math.min(i + batchSize, needFetch.length) + '/' + needFetch.length + ' fetched, ' + customerPayments.length + ' payments)');
      await sleep(1500); // 1.5s between batches to avoid IP ban
    }
    var _phCount = customers.filter(function(c){return c.phone;}).length;
    var _emCount = customers.filter(function(c){return c.email;}).length;
    var _vhCount = customers.filter(function(c){return c.vehicle;}).length;
    log('✅ Details fetched — 📞 ' + _phCount + ' phones, ✉ ' + _emCount + ' emails, 🚗 ' + _vhCount + ' vehicles', '#30d158');
    log('   (' + customerPayments.length + ' payments from detail fetches)');

    // ── Fetch payment history for ALL customers (including cached) ──────────
    log('');
    log('📋 Fetching payment history for all ' + customers.length + ' customers...');
    var payBatchSize = 2;
    for (var pi2 = 0; pi2 < customers.length; pi2 += payBatchSize) {
      var payBatch = customers.slice(pi2, pi2 + payBatchSize);
      await Promise.all(payBatch.map(async function(cust) {
        if (!cust.carpay_id) return;
        try {
          var phUrl = '/dms/customer/' + cust.carpay_id + '?dealerId=' + dealerId + '&tabId=payment-history';
          var pr = await fetch(phUrl, { credentials: 'include' });
          if (pr.ok) {
            var phtml = await pr.text();
            var phPays = parseCustomerPage(phtml, cust.carpay_id).payments;
            if (pi2 < payBatchSize * 3) {
              log('    💳 ' + cust.name + ': ' + phPays.length + ' pays (hasTable=' + (phtml.indexOf('customer-payment-history-table') !== -1) + ')', '#888');
            }
            if (phPays && phPays.length) {
              phPays.forEach(function(p) {
                var key = cust.account + '|' + p.date + '|' + p.amount;
                customerPayments.push({
                  location: _loc,
                  carpay_id: cust.carpay_id,
                  name: cust.name,
                  account: cust.account,
                  reference: '',
                  date: p.date,
                  time: '',
                  method: p.method || '',
                  amount_sent: p.amount || '$0.00'
                });
              });
            }
          }
        } catch(e) {}
      }));
      if (pi2 % 20 === 0) {
        var ppct = Math.min(100, Math.round(((pi2 + payBatchSize) / customers.length) * 100));
        log('   ' + ppct + '% (' + customerPayments.length + ' payments so far)');
      }
      await sleep(1500);
    }
    log('✅ Payment history: ' + customerPayments.length + ' payments from customer pages', '#30d158');

    // ── Step 3: Fetch recent payments ───────────────────────────────────────
    log('');
    log('💳 Fetching payment history...');
    var payments = [];
    try {
      var pr = await fetch('/dms/recent-payments', { credentials: 'include' });
      var phtml = await pr.text();
      var pparser = new DOMParser();
      var pdoc = pparser.parseFromString(phtml, 'text/html');
      var prows = pdoc.querySelectorAll('#approved-table tbody tr');
      prows.forEach(function(tr) {
        var cells = tr.querySelectorAll('td');
        if (cells.length < 11) return;
        var name = cells[0] ? (cells[0].textContent || '').trim() : '';
        var account = cells[1] ? (cells[1].textContent || '').trim() : '';
        var reference = cells[2] ? (cells[2].textContent || '').trim() : '';
        var date = cells[3] ? (cells[3].textContent || '').trim() : '';
        var time = cells[4] ? (cells[4].textContent || '').trim() : '';
        var method = cells[5] ? (cells[5].textContent || '').trim() : '';
        var payType = cells[8] ? (cells[8].textContent || '').trim() : '';
        var amountSent = cells[11] ? (cells[11].textContent || '').trim() : '';
        if (name && account && amountSent) {
          var cust = customers.find(function(c) { return c.account === account; });
          var carpayId = cust ? cust.carpay_id : '';
          payments.push({
            location: _loc,
            carpay_id: carpayId,
            name: name,
            account: account,
            reference: reference,
            date: date,
            time: time,
            method: payType || method,
            amount_sent: amountSent
          });
        }
      });
      log('✅ Found ' + payments.length + ' recent payments', '#30d158');
    } catch(e) {
      log('⚠ Could not fetch recent payments: ' + e.message, '#f59e0b');
    }

    // ── Step 4: Merge & deduplicate payments ────────────────────────────────
    // Combine recent payments (have reference/time) with customer page payments (full history)
    var allPayments = payments.slice(); // start with recent payments (higher quality — have reference + time)
    var recentKeys = {};
    allPayments.forEach(function(p) {
      // Key by account + date + amount for dedup
      var key = p.account + '|' + p.date + '|' + p.amount_sent;
      recentKeys[key] = true;
    });
    // Add customer page payments that aren't already in recent
    var added = 0;
    customerPayments.forEach(function(p) {
      var key = p.account + '|' + p.date + '|' + p.amount_sent;
      if (!recentKeys[key]) {
        allPayments.push(p);
        recentKeys[key] = true;
        added++;
      }
    });
    log('');
    log('📊 Total payments: ' + allPayments.length + ' (' + payments.length + ' recent + ' + added + ' from history)', '#60a5fa');

    // ── Step 5: Upsert to Supabase ──────────────────────────────────────────
    log('');
    log('☁️  Saving to Supabase...');

    // Preserve repo_flagged before deleting customers
    var flagRes = await fetch(SB_URL + '/rest/v1/carpay_customers?location=eq.' + _loc + '&repo_flagged=eq.true&select=account,repo_flagged', {
      method: 'GET', headers: SB_HEADERS
    });
    var flaggedAccounts = {};
    if (flagRes.ok) {
      var flagged = await flagRes.json();
      flagged.forEach(function(f) { flaggedAccounts[f.account] = true; });
      if (Object.keys(flaggedAccounts).length) log('  🚩 Preserving ' + Object.keys(flaggedAccounts).length + ' repo flags');
    }

    // Normalize all customer objects to have identical keys (PostgREST requires this for batch POST)
    var _allKeys = ['name','account','next_payment','days_late','auto_pay','carpay_id','location','vehicle','phone','email','scheduled_amount','payment_frequency','current_amount_due','repo_flagged'];
    customers.forEach(function(c) {
      _allKeys.forEach(function(k) { if (!(k in c)) c[k] = (k === 'days_late' ? 0 : k === 'auto_pay' || k === 'repo_flagged' ? false : k === 'current_amount_due' ? null : ''); });
      // Re-apply repo_flagged
      if (flaggedAccounts[c.account]) c.repo_flagged = true;
    });

    // Debug: verify data before save
    var _sample = customers.slice(0, 2).map(function(c) { return c.name + ' ph=' + (c.phone||'NULL') + ' veh=' + (c.vehicle||'NULL'); });
    log('  🔍 Pre-save sample: ' + _sample.join(' | '), '#f59e0b');
    log('  🔍 Keys: ' + Object.keys(customers[0] || {}).join(', '), '#f59e0b');
    log('  🔍 JSON[0]: ' + JSON.stringify(customers[0]).slice(0, 300), '#f59e0b');

    // Clear existing for this location
    await sbDeleteByLocation('carpay_customers', _loc);
    // Only delete payments if we have replacements — never wipe without new data
    if (allPayments.length > 0) {
      await sbDeleteByLocation('carpay_payments', _loc);
    } else {
      log('  ℹ Keeping existing payments (no new ones found)', '#60a5fa');
    }

    var custsDone = await sbUpsert('carpay_customers', customers);
    log('  ✅ ' + custsDone + ' customers saved', '#30d158');

    // ── Post-save verification & fix-up ──────────────────────────────────────
    // Check if detail fields actually persisted — if not, patch them individually
    await sleep(500);
    var verifyRes = await fetch(SB_URL + '/rest/v1/carpay_customers?location=eq.' + _loc + '&select=id,account,vehicle,phone&limit=5&order=name.asc', {
      headers: Object.assign({}, SB_HEADERS, { 'Cache-Control': 'no-cache' })
    });
    if (verifyRes.ok) {
      var verifyData = await verifyRes.json();
      var needsFix = verifyData.filter(function(v) { return !v.vehicle && !v.phone; });
      if (needsFix.length > 0) {
        log('  ⚠ Detail fields lost during batch insert — running fix-up patches...', '#f59e0b');
        var fixCount = 0;
        for (var fi = 0; fi < customers.length; fi++) {
          var fc = customers[fi];
          if (!fc.vehicle && !fc.phone) continue; // nothing to fix
          try {
            var patchR = await fetch(SB_URL + '/rest/v1/carpay_customers?account=eq.' + encodeURIComponent(fc.account) + '&location=eq.' + _loc, {
              method: 'PATCH',
              headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'return=minimal' }),
              body: JSON.stringify({ vehicle: fc.vehicle || '', phone: fc.phone || '', email: fc.email || '', scheduled_amount: fc.scheduled_amount || '', payment_frequency: fc.payment_frequency || '', current_amount_due: fc.current_amount_due })
            });
            if (patchR.ok) fixCount++;
          } catch(e) {}
          if (fi % 10 === 0 && fi > 0) { log('   Patching... ' + fi + '/' + customers.length); await sleep(500); }
        }
        log('  ✅ Fixed ' + fixCount + ' customers via individual patches', '#30d158');
      } else {
        log('  ✅ Verified: detail fields persisted correctly', '#30d158');
      }
    }

    if (allPayments.length) {
      var paysDone = await sbUpsert('carpay_payments', allPayments);
      log('  ✅ ' + paysDone + ' payments saved', '#30d158');
    }

    log('');
    log('════════════════════════════════');
    log('✅ Sync complete!', '#30d158');
    log('  ' + customers.length + ' customers');
    log('  ' + allPayments.length + ' payments (' + added + ' from history)');
    log('  Location: ' + _loc.toUpperCase());
    log('════════════════════════════════');

    document.getElementById('cp-sync-run').disabled = false;
    document.getElementById('cp-sync-run').textContent = '↺ Sync Again';
  };

})();
