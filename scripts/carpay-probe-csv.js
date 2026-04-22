// Probe for the CSV export URL on CarPay dealer pages.
// Logs in, fetches /dms/customers and /dms/recent-payments, and prints
// any candidate CSV/export URLs found (form actions, <a> hrefs, JS snippets,
// data-* attributes).
//
// Run with:
//   CARPAY_EMAIL=... CARPAY_PASSWORD=... node scripts/carpay-probe-csv.js
// Optional: CARPAY_DEBARY_ID / CARPAY_DELAND_ID (defaults 656 / 657).

const fetch = require('node-fetch');

const BASE = 'https://dealers.carpay.com';
const CP_EMAIL = process.env.CARPAY_EMAIL;
const CP_PASSWORD = process.env.CARPAY_PASSWORD;
const DEBARY_ID = process.env.CARPAY_DEBARY_ID || '656';

if (!CP_EMAIL || !CP_PASSWORD) {
  console.error('Set CARPAY_EMAIL and CARPAY_PASSWORD env vars.');
  process.exit(1);
}

// ── Cookie Jar ───────────────────────────────────────────────────────────────
const jar = {};
function updateJar(res) {
  const cookies = res.headers.raw()['set-cookie'] || [];
  cookies.forEach(c => {
    const kv = c.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) jar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  });
}
function cookieHeader() {
  return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; ');
}

async function cpFetch(url, opts, depth) {
  depth = depth || 0;
  if (depth > 10) throw new Error('Too many redirects');
  if (!url.startsWith('http')) url = BASE + url;
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign({ 'Cookie': cookieHeader(), 'User-Agent': 'Mozilla/5.0' }, opts && opts.headers),
    redirect: 'manual',
    timeout: 60000
  }));
  updateJar(res);
  if (res.status >= 300 && res.status < 400) {
    let loc = res.headers.get('location') || '';
    if (!loc.startsWith('http')) loc = BASE + loc;
    return cpFetch(loc, { method: 'GET' }, depth + 1);
  }
  return res;
}

async function cpLogin(email, password) {
  const page = await cpFetch('/login');
  const html = await page.text();
  const mCsrf = html.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
  if (!mCsrf) { console.error('CSRF token not found'); return false; }
  const mFields = html.match(/name="_Token\[fields\]"[^>]*value="([^"]+)"/);
  const tokenFields = mFields ? mFields[1] : '';
  const body = 'username=' + encodeURIComponent(email) +
               '&password__not_in_db=' + encodeURIComponent(password) +
               '&_csrfToken=' + encodeURIComponent(mCsrf[1]) +
               '&_Token%5Bfields%5D=' + encodeURIComponent(tokenFields) +
               '&_Token%5Bunlocked%5D=' +
               '&redirect=' +
               '&remember_me_not_in_db=0';
  const res = await cpFetch('/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body
  });
  const text = await res.text();
  if (text.includes('Your Customers') || text.includes('/dms/')) return true;
  return false;
}

async function cpSelectDealer(dealerId) {
  const res = await cpFetch('/dms/select-dealer?dealerId=' + dealerId);
  await res.text();
}

// ── Probe a page for CSV-export clues ────────────────────────────────────────
function probePage(pageName, html) {
  console.log('\n=== ' + pageName + ' (' + html.length + ' bytes) ===');

  const anchorCsv = [];
  const reAnchor = /<a[^>]+href="([^"]+)"[^>]*>([^<]*)<\/a>/gi;
  let m;
  while ((m = reAnchor.exec(html)) !== null) {
    const href = m[1];
    const label = m[2].replace(/<[^>]+>/g, '').trim();
    if (/csv|pdf|export|download/i.test(href) || /csv|pdf|export|download/i.test(label)) {
      anchorCsv.push({ href, label });
    }
  }
  if (anchorCsv.length) {
    console.log('[anchors with csv/pdf/export/download]');
    anchorCsv.slice(0, 30).forEach(a => console.log('  ' + a.label + '  →  ' + a.href));
  }

  const formMatches = html.match(/<form[^>]*>/gi) || [];
  const formsCsv = formMatches.filter(f => /csv|pdf|export|download/i.test(f));
  if (formsCsv.length) {
    console.log('[forms with csv/pdf/export/download in attributes]');
    formsCsv.slice(0, 10).forEach(f => console.log('  ' + f));
  }

  const buttonMatches = html.match(/<button[^>]*>[\s\S]*?<\/button>/gi) || [];
  const btnCsv = buttonMatches.filter(b => /csv|pdf|export|download/i.test(b));
  if (btnCsv.length) {
    console.log('[buttons with csv/pdf/export/download]');
    btnCsv.slice(0, 10).forEach(b => console.log('  ' + b.replace(/\s+/g, ' ').slice(0, 300)));
  }

  const dataAttrs = html.match(/data-[\w-]+="[^"]*(?:csv|pdf|export|download)[^"]*"/gi) || [];
  if (dataAttrs.length) {
    console.log('[data-* attrs mentioning csv/pdf/export/download]');
    dataAttrs.slice(0, 20).forEach(a => console.log('  ' + a));
  }

  const jsLines = (html.match(/.{0,80}(csv|\.pdf|export|download).{0,160}/gi) || [])
    .filter(s => s.includes('/') || s.includes('url') || s.includes('action') || s.includes('href'));
  const jsUnique = {};
  jsLines.forEach(l => { jsUnique[l.trim()] = true; });
  const jsList = Object.keys(jsUnique);
  if (jsList.length) {
    console.log('[context snippets mentioning csv/pdf/export/download with url-ish keywords]');
    jsList.slice(0, 30).forEach(l => console.log('  … ' + l.slice(0, 260).replace(/\s+/g, ' ') + ' …'));
  }

  if (!anchorCsv.length && !formsCsv.length && !btnCsv.length && !dataAttrs.length && !jsList.length) {
    console.log('(no csv/pdf/export/download hits found — dumping first 1500 chars for manual inspection)');
    console.log(html.slice(0, 1500));
  }
}

// ── Try a few common CSV URLs by guessing and checking content-type ─────────
async function tryUrl(url) {
  try {
    const res = await cpFetch(url);
    const ct = res.headers.get('content-type') || '';
    const cd = res.headers.get('content-disposition') || '';
    const head = (await res.text()).slice(0, 300);
    console.log('  ' + url + ' → ' + res.status + '  content-type=' + ct + (cd ? '  cd=' + cd : ''));
    if (/csv|attachment/i.test(ct + cd)) {
      console.log('    [HEAD 300]: ' + head.replace(/\n/g, '\\n'));
    }
  } catch (e) {
    console.log('  ' + url + ' → ERROR ' + e.message);
  }
}

async function main() {
  console.log('Logging in as ' + CP_EMAIL + ' …');
  const ok = await cpLogin(CP_EMAIL, CP_PASSWORD);
  if (!ok) { console.error('Login failed.'); process.exit(1); }
  console.log('Logged in. Selecting DeBary dealer (id=' + DEBARY_ID + ').');
  await cpSelectDealer(DEBARY_ID);

  // Page 1: customers
  const c = await cpFetch('/dms/customers');
  const custHtml = await c.text();
  probePage('/dms/customers', custHtml);

  // Page 2: recent payments
  const p = await cpFetch('/dms/recent-payments');
  const payHtml = await p.text();
  probePage('/dms/recent-payments', payHtml);

  // Blind guesses
  console.log('\n=== blind URL probes ===');
  const guesses = [
    '/dms/customers/export',
    '/dms/customers/export.csv',
    '/dms/customers/export?format=csv',
    '/dms/customers?export=csv',
    '/dms/customers.csv',
    '/dms/customers/csv',
    '/dms/customers/download',
    '/dms/customers/download/csv',
    '/dms/recent-payments/export',
    '/dms/recent-payments/export.csv',
    '/dms/recent-payments/export?format=csv',
    '/dms/recent-payments?export=csv',
    '/dms/recent-payments.csv',
    '/dms/recent-payments/csv',
    '/dms/recent-payments/download',
  ];
  for (const g of guesses) await tryUrl(g);

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
