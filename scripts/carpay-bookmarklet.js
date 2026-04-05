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
        headers: Object.assign({}, SB_HEADERS, { 'Prefer': 'resolution=merge-duplicates,return=minimal' }),
        body: JSON.stringify(batch)
      });
      if (r.ok) done += batch.length;
      else log('  ⚠ Upsert error: ' + (await r.text()).slice(0, 80), '#f59e0b');
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
    var text = doc.body ? doc.body.innerText : '';

    // Vehicle — appears in header
    var vehicle = '';
    var vehicleMatch = text.match(/Customer ID:\s*\d+\s*([\w\s]+(?:\d{4}\s+\w+.*?))\s*(?:Back to|Regular Scheduled)/i);
    if (!vehicleMatch) {
      // Try from page title area
      var headerText = (doc.querySelector('.customer-header, .page-header, h2, h1') || {}).innerText || '';
      var vm = headerText.match(/(\d{4}\s+\w[\w\s]+)/);
      if (vm) vehicle = vm[1].trim();
    } else {
      vehicle = vehicleMatch[1].trim();
    }

    // Get vehicle from the header more reliably
    var allText = text;
    var vMatch = allText.match(/Login as Customer\s+([\w\s]+\d{4}\s+[\w\s]+)\s+Customer ID/);
    if (vMatch) vehicle = vMatch[1].trim();

    // Scheduled amount
    var schedMatch = text.match(/Regular Scheduled Amount:\s*\$([\d,]+\.?\d*)/i);
    var scheduledAmount = schedMatch ? '$' + schedMatch[1] : '';

    // Payment frequency
    var freqMatch = text.match(/Payment Frequency:\s*([A-Za-z-]+)/i);
    var paymentFrequency = freqMatch ? freqMatch[1] : '';

    // Current amount due
    var dueMatch = text.match(/Current Amount Due:\s*\$([\d,]+\.?\d*)/i);
    var currentAmountDue = dueMatch ? parseFloat(dueMatch[1].replace(/,/g, '')) : null;

    // Phone — look for +1 (XXX) XXX-XXXX pattern
    var phoneMatch = text.match(/\+1\s*\((\d{3})\)\s*(\d{3})-(\d{4})/);
    var phone = phoneMatch ? phoneMatch[1] + phoneMatch[2] + phoneMatch[3] : '';

    // Email
    var emailMatch = text.match(/([A-Z0-9._%+\-]+@[A-Z0-9.\-]+\.[A-Z]{2,})/i);
    var email = emailMatch ? emailMatch[1].toLowerCase() : '';

    // Payment history
    var payments = [];
    var rows = doc.querySelectorAll('#payment-history-table tbody tr, table tbody tr');
    rows.forEach(function(tr) {
      var cells = tr.querySelectorAll('td');
      if (cells.length >= 4) {
        var dateStr = cells[0] ? cells[0].innerText.trim() : '';
        var status = cells[1] ? cells[1].innerText.trim() : '';
        var method = cells[2] ? cells[2].innerText.trim() : '';
        var amount = cells[3] ? cells[3].innerText.trim() : '';
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
        if (cells[0] && cells[0].innerText.trim()) {
          customers.push({
            name: cells[0].innerText.trim(),
            account: cells[1] ? cells[1].innerText.trim() : '',
            next_payment: cells[7] ? cells[7].innerText.trim() : '',
            days_late: parseInt(cells[8] ? cells[8].innerText.trim().replace(/[()]/g,'') : '0') || 0,
            auto_pay: false,
            carpay_id: idMatch ? idMatch[1] : '',
            location: _loc
          });
        }
      });
    }

    log('✅ Found ' + customers.length + ' customers', '#30d158');

    // ── Step 2: Fetch individual pages for contact/vehicle/balance ──────────
    log('');
    log('📋 Fetching customer details (phone, vehicle, balance)...');
    log('   This takes ~' + Math.ceil(customers.length / 5) + ' seconds...');

    var customerPayments = []; // collect payment history from each customer's payment-history tab
    var dealerId = location.search.match(/dealerId=(\d+)/) ? location.search.match(/dealerId=(\d+)/)[1] : '';
    if (!dealerId) {
      var dMatch = document.body.innerHTML.match(/dealerId[=:][\s"']*(\d+)/);
      if (dMatch) dealerId = dMatch[1];
    }
    // Fallback to known dealer IDs
    if (!dealerId) dealerId = _loc === 'deland' ? '657' : '656';
    var batchSize = 5;
    for (var i = 0; i < customers.length; i += batchSize) {
      var batch = customers.slice(i, i + batchSize);
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

          // Fetch payment history tab — separate page from customer detail
          try {
            var phUrl = '/dms/customer/' + cust.carpay_id + '?dealerId=' + dealerId + '&tabId=payment-history';
            var pr = await fetch(phUrl, { credentials: 'include' });
            if (pr.ok) {
              var phtml = await pr.text();
              var phPays = parseCustomerPage(phtml, cust.carpay_id).payments;
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
            }
          } catch(e) {}
        } catch(e) {
          // skip
        }
      }));
      var pct = Math.min(100, Math.round(((i + batchSize) / customers.length) * 100));
      log('   ' + pct + '% (' + Math.min(i + batchSize, customers.length) + '/' + customers.length + ' customers, ' + customerPayments.length + ' payments)');
      await sleep(200);
    }
    log('✅ Details fetched (' + customerPayments.length + ' payments from customer pages)', '#30d158');

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
        var name = cells[0] ? cells[0].innerText.trim() : '';
        var account = cells[1] ? cells[1].innerText.trim() : '';
        var reference = cells[2] ? cells[2].innerText.trim() : '';
        var date = cells[3] ? cells[3].innerText.trim() : '';
        var time = cells[4] ? cells[4].innerText.trim() : '';
        var method = cells[5] ? cells[5].innerText.trim() : '';
        var payType = cells[8] ? cells[8].innerText.trim() : '';
        var amountSent = cells[11] ? cells[11].innerText.trim() : '';
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

    // Clear existing for this location
    await sbDeleteByLocation('carpay_customers', _loc);
    await sbDeleteByLocation('carpay_payments', _loc);

    var custsDone = await sbUpsert('carpay_customers', customers);
    log('  ✅ ' + custsDone + ' customers saved', '#30d158');

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
