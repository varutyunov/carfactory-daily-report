// Temporary DeLand top-of-recent-payments probe.
const fetch = require('node-fetch');

const BASE = 'https://dealers.carpay.com';
const CP_EMAIL = process.env.CARPAY_EMAIL;
const CP_PASSWORD = process.env.CARPAY_PASSWORD;
const DELAND_ID = process.env.CARPAY_DELAND_ID || '657';

if (!CP_EMAIL || !CP_PASSWORD) { console.error('Missing creds'); process.exit(1); }

const jar = {};
function updateJar(res) {
  const cookies = res.headers.raw()['set-cookie'] || [];
  cookies.forEach(c => {
    const kv = c.split(';')[0];
    const idx = kv.indexOf('=');
    if (idx > 0) jar[kv.slice(0, idx).trim()] = kv.slice(idx + 1).trim();
  });
}
function cookieHeader() { return Object.entries(jar).map(([k, v]) => k + '=' + v).join('; '); }

async function cpFetch(url, opts, depth) {
  depth = depth || 0;
  if (depth > 10) throw new Error('redir loop');
  if (!url.startsWith('http')) url = BASE + url;
  const res = await fetch(url, Object.assign({}, opts, {
    headers: Object.assign({ 'Cookie': cookieHeader(), 'User-Agent': 'Mozilla/5.0' }, opts && opts.headers),
    redirect: 'manual', timeout: 60000
  }));
  updateJar(res);
  if (res.status >= 300 && res.status < 400) {
    let loc = res.headers.get('location') || '';
    if (!loc.startsWith('http')) loc = BASE + loc;
    return cpFetch(loc, { method: 'GET' }, depth + 1);
  }
  return res;
}

async function main() {
  const page = await cpFetch('/login');
  const html = await page.text();
  const mCsrf = html.match(/name="_csrfToken"[^>]*value="([^"]+)"/);
  const mFields = html.match(/name="_Token\[fields\]"[^>]*value="([^"]+)"/);
  const body = 'username=' + encodeURIComponent(CP_EMAIL) +
               '&password__not_in_db=' + encodeURIComponent(CP_PASSWORD) +
               '&_csrfToken=' + encodeURIComponent(mCsrf[1]) +
               '&_Token%5Bfields%5D=' + encodeURIComponent(mFields ? mFields[1] : '') +
               '&_Token%5Bunlocked%5D=&redirect=&remember_me_not_in_db=0';
  const r = await cpFetch('/login', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body });
  await r.text();
  console.log('Logged in.');

  await cpFetch('/dms/select-dealer?dealerId=' + DELAND_ID).then(r => r.text());
  console.log('Selected DeLand dealer (id=' + DELAND_ID + ').');

  const pp = await cpFetch('/dms/recent-payments?start=0&length=10000');
  const phtml = await pp.text();
  console.log('recent-payments HTML: ' + phtml.length + ' bytes');

  const tbodyMatch = phtml.match(/<tbody[^>]*>([\s\S]*?)<\/tbody>/);
  if (!tbodyMatch) { console.log('no tbody'); return; }
  const rows = tbodyMatch[1].match(/<tr[\s\S]*?<\/tr>/g) || [];
  console.log('tbody rows: ' + rows.length);

  const totalMatch = phtml.match(/of\s+([\d,]+)\s+entries/i);
  if (totalMatch) console.log('stated total: ' + totalMatch[1]);
  const infoMatch = phtml.match(/(Showing[\s\S]{0,80}?entries)/i);
  if (infoMatch) console.log('info: ' + infoMatch[1].replace(/\s+/g, ' '));

  console.log('\nFirst 10 rows (should be most recent):');
  for (let i = 0; i < Math.min(10, rows.length); i++) {
    const tds = (rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );
    console.log('  [' + i + '] ' + tds[0] + ' | acct ' + tds[1] + ' | ' + tds[5] + ' ' + tds[6] + ' | ' + tds[16]);
  }

  console.log('\nLast 5 rows (oldest):');
  for (let i = Math.max(0, rows.length - 5); i < rows.length; i++) {
    const tds = (rows[i].match(/<td[^>]*>([\s\S]*?)<\/td>/g) || []).map(td =>
      td.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim()
    );
    console.log('  [' + i + '] ' + tds[0] + ' | acct ' + tds[1] + ' | ' + tds[5] + ' ' + tds[6] + ' | ' + tds[16]);
  }

  // Look for date-range / filter inputs on the page
  console.log('\nDate/filter inputs on page:');
  const dateInputs = phtml.match(/<input[^>]*(type="date"|name="[^"]*date[^"]*"|name="[^"]*from[^"]*"|name="[^"]*to[^"]*")[^>]*>/gi) || [];
  dateInputs.slice(0, 10).forEach(i => console.log('  ' + i.replace(/\s+/g, ' ')));
}

main().catch(e => { console.error(e); process.exit(1); });
