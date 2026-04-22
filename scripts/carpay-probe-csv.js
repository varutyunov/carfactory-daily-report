// Probe the CarPay customers + recent-payments list pages to confirm:
// - All rows are inlined in the HTML (no separate DataTables ajax call)
// - Column headers (so we know what data is available without per-customer hits)
// - Row count vs stated total
// - DataTables init config (for CSV column visibility clues)
//
// Run:
//   CARPAY_EMAIL=... CARPAY_PASSWORD=... node scripts/carpay-probe-csv.js
// Optional: CARPAY_DEBARY_ID (default 656).

const fetch = require('node-fetch');

const BASE = 'https://dealers.carpay.com';
const CP_EMAIL = process.env.CARPAY_EMAIL;
const CP_PASSWORD = process.env.CARPAY_PASSWORD;
const DEBARY_ID = process.env.CARPAY_DEBARY_ID || '656';

if (!CP_EMAIL || !CP_PASSWORD) {
  console.error('Set CARPAY_EMAIL and CARPAY_PASSWORD env vars.');
  process.exit(1);
}

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
  if (!mCsrf) return false;
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
  return text.includes('Your Customers') || text.includes('/dms/');
}

async function cpSelectDealer(dealerId) {
  const res = await cpFetch('/dms/select-dealer?dealerId=' + dealerId);
  await res.text();
}

function analyzeTable(pageName, html) {
  console.log('\n=== ' + pageName + ' ===');
  console.log('HTML length:', html.length);

  const theadMatch = html.match(/<thead[^>]*>([\s\S]*?)<\/thead>/);
  if (theadMatch) {
    const ths = theadMatch[1].match(/<th[^>]*>([\s\S]*?)<\/th>/g) || [];
    console.log('Columns (' + ths.length + '):');
    ths.forEach((th, i) => {
      const cls = th.match(/class="([^"]*)"/);
      const text = th.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
      const notExport = cls && cls[1].includes('not-export') ? ' [not-export]' : '';
      console.log('  [' + i + '] ' + text + notExport);
    });
  }

  const tbodyMatch = html.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (tbodyMatch) {
    const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
    console.log('Rows in tbody:', rows.length);

    if (rows.length) {
      for (let r = 0; r < Math.min(2, rows.length); r++) {
        const tds = (rows[r].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
          td.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
        );
        console.log('Sample row ' + r + ' (' + tds.length + ' cells):');
        tds.forEach((t, i) => console.log('  [' + i + '] ' + t.slice(0, 100)));
      }
    }
  }

  const totalMatch = html.match(/of\s+([\d,]+)\s+entries/i);
  if (totalMatch) console.log('Stated total: ' + totalMatch[1] + ' entries');

  const ajaxMatches = html.match(/ajax\s*:\s*["'`]([^"'`]+)["'`]/g) || [];
  if (ajaxMatches.length) {
    console.log('DataTables ajax configs:');
    ajaxMatches.forEach(a => console.log('  ' + a));
  }
  const ajaxObjMatches = html.match(/ajax\s*:\s*\{[^}]+\}/g) || [];
  if (ajaxObjMatches.length) {
    console.log('DataTables ajax{} configs:');
    ajaxObjMatches.slice(0, 5).forEach(a => console.log('  ' + a.replace(/\s+/g, ' ').slice(0, 300)));
  }

  if (/serverSide\s*:\s*true/.test(html)) console.log('serverSide: true (data fetched via ajax)');
  else if (/serverSide\s*:\s*false/.test(html)) console.log('serverSide: false (all data inlined)');

  const scriptUrls = new Set();
  const reUrl = /['"`](\/dms\/[^'"`]+)['"`]/g;
  let m;
  while ((m = reUrl.exec(html)) !== null) scriptUrls.add(m[1]);
  if (scriptUrls.size) {
    console.log('URLs mentioned in scripts (' + Math.min(30, scriptUrls.size) + ' of ' + scriptUrls.size + '):');
    [...scriptUrls].slice(0, 30).forEach(u => console.log('  ' + u));
  }
}

async function main() {
  console.log('Logging in as ' + CP_EMAIL + ' …');
  const ok = await cpLogin(CP_EMAIL, CP_PASSWORD);
  if (!ok) { console.error('Login failed.'); process.exit(1); }
  console.log('Logged in. Selecting DeBary dealer (id=' + DEBARY_ID + ').');
  await cpSelectDealer(DEBARY_ID);

  const c = await cpFetch('/dms/customers?start=0&length=5000');
  const custHtml = await c.text();
  analyzeTable('/dms/customers?length=5000', custHtml);

  const p = await cpFetch('/dms/recent-payments?start=0&length=5000');
  const payHtml = await p.text();
  analyzeTable('/dms/recent-payments?length=5000', payHtml);

  console.log('\nDone.');
}

main().catch(e => { console.error(e); process.exit(1); });
