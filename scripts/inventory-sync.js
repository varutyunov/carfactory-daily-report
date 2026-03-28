const fetch = require('node-fetch');
const fs = require('fs');
const SB_URL = process.env.SUPABASE_URL;
const SB_KEY = process.env.SUPABASE_KEY;
const HEADERS = {
  'apikey': SB_KEY,
  'Authorization': 'Bearer ' + SB_KEY,
  'Content-Type': 'application/json',
  'Prefer': 'return=representation'
};

async function sbGetAll(table, select) {
  // Paginate to get ALL rows (Supabase default limit is 1000)
  const all = [];
  let offset = 0;
  const limit = 1000;
  while (true) {
    const url = `${SB_URL}/rest/v1/${table}?select=${select}&limit=${limit}&offset=${offset}`;
    const res = await fetch(url, { headers: HEADERS });
    if (!res.ok) throw new Error(`GET ${table} failed: ${await res.text()}`);
    const rows = await res.json();
    all.push(...rows);
    if (rows.length < limit) break;
    offset += limit;
  }
  return all;
}

function parseCsv(csvPath, forceLocation) {
  const csv = fs.readFileSync(csvPath, 'utf8');
  if (!csv || csv.length < 100) throw new Error(`CSV empty or not found: ${csvPath}`);
  const lines = csv.trim().split('\n');
  const hdrs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  console.log(`[${csvPath}] Columns:`, hdrs.join(', '));

  const cars = [];
  const stocks = new Set();
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const r = {};
    hdrs.forEach((h, j) => r[h] = vals[j] || '');
    if ((r['status'] !== 'INSTOCK' && r['status'] !== 'REPO') || !r['make'] || !r['stockno']) continue;

    const color = r['colorexterior'] || r['color'] || r['extcolor'] || '';

    // forceLocation overrides lotno-based logic
    let location;
    if (forceLocation) {
      location = forceLocation;
    } else {
      const lot = r['lotno'];
      location = lot === '2' ? 'DeLand' : 'DeBary';
    }

    cars.push({
      name: [r['year'], r['make'], r['model']].filter(Boolean).join(' '),
      stock: r['stockno'],
      vin: r['vin'] || '',
      location,
      color
    });
    stocks.add(r['stockno']);
  }
  console.log(`[${csvPath}] INSTOCK:`, cars.length);
  return { cars, stocks };
}

async function syncLoc(loc, csvPath) {
  const { cars: csvCars, stocks: csvStocks } = parseCsv(csvPath, loc);
  console.log(`\n=== Syncing ${loc} from ${csvPath} (${csvCars.length} cars) ===`);

  // Get existing cars for this location only
  const url = `${SB_URL}/rest/v1/inventory?select=id,stock,vin,name,location,color&location=eq.${encodeURIComponent(loc)}&limit=2000`;
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) throw new Error(`GET inventory failed: ${await res.text()}`);
  const existing = await res.json();
  const existingByStock = new Map(existing.map(c => [c.stock, c]));
  console.log(`${loc} currently in DB:`, existing.length);

  // --- ADD NEW CARS ---
  const toInsert = csvCars.filter(c => !existingByStock.has(c.stock));
  let added = 0;
  if (toInsert.length > 0) {
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      const r = await fetch(SB_URL + '/rest/v1/inventory', {
        method: 'POST', headers: HEADERS, body: JSON.stringify(batch)
      });
      if (r.ok) { added += (await r.json()).length; }
      else { console.error('Insert error:', await r.text()); }
    }
  }

  // --- UPDATE EXISTING CARS (color + location) ---
  let updated = 0;
  for (const c of csvCars) {
    const ex = existingByStock.get(c.stock);
    if (!ex) continue;
    const patch = {};
    if (c.color && c.color !== ex.color) patch.color = c.color;
    if (c.location !== ex.location) patch.location = c.location;
    if (!Object.keys(patch).length) continue;
    const r = await fetch(`${SB_URL}/rest/v1/inventory?id=eq.${ex.id}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch)
    });
    if (r.ok) updated++;
    else console.error('Update error for', c.stock, ':', await r.text());
  }

  // --- REMOVE SOLD CARS (this location only) ---
  const assignments = await sbGetAll('assignments', 'inventory_id,approved');
  const activeIds = new Set(assignments.filter(a => !a.approved).map(a => a.inventory_id));
  const toRemove = existing.filter(c => c.stock && !csvStocks.has(c.stock) && !activeIds.has(c.id));
  let removed = 0;
  for (const car of toRemove) {
    const r = await fetch(`${SB_URL}/rest/v1/inventory?id=eq.${car.id}`, { method: 'DELETE', headers: HEADERS });
    if (r.ok) removed++;
    else console.error('Delete error for', car.stock, ':', await r.text());
  }

  console.log(`${loc}: Added ${added} | Updated ${updated} | Removed ${removed}`);
}

async function main() {
  await syncLoc('DeBary', 'InventoryMaster.csv');
  if (fs.existsSync('InventoryMasterDeland.csv')) {
    await syncLoc('DeLand', 'InventoryMasterDeland.csv');
  } else {
    console.log('InventoryMasterDeland.csv not found — skipping DeLand sync');
  }
  console.log('\n=== SYNC COMPLETE ===');
}
main().catch(e => { console.error(e); process.exit(1); });
