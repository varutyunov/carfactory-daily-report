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

async function main() {
  // Parse both CSV files — InventoryMaster is DeBary only now; DeLand file is source of truth for DeLand
  const debary = parseCsv('InventoryMaster.csv', 'DeBary');
  const deland = fs.existsSync('InventoryMasterDeland.csv')
    ? parseCsv('InventoryMasterDeland.csv', 'DeLand')
    : { cars: [], stocks: new Set() };

  const allCsvStocks = new Set([...debary.stocks, ...deland.stocks]);

  // Deduplicate by VIN — DeLand file takes priority over DeBary for overlapping VINs
  const seen = new Set();
  const csvCars = [];
  // Process DeLand first so its entries win on duplicate VINs
  [...deland.cars, ...debary.cars].forEach(c => {
    if (c.vin && seen.has(c.vin)) return;
    if (c.vin) seen.add(c.vin);
    csvCars.push(c);
  });

  console.log('Total INSTOCK (both lots):', csvCars.length);

  // Get ALL existing vehicles from Supabase (paginated)
  const existing = await sbGetAll('inventory', 'id,stock,vin,name');
  const existingByStock = new Map(existing.map(c => [c.stock, c]));
  const existingByVin = new Map(existing.filter(c => c.vin).map(c => [c.vin, c]));
  console.log('Currently in DB:', existing.length);

  // --- ADD NEW CARS ---
  const toInsert = csvCars.filter(c => {
    if (existingByStock.has(c.stock)) return false;
    if (c.vin && existingByVin.has(c.vin)) return false;
    return true;
  });

  let added = 0;
  if (toInsert.length > 0) {
    console.log('New cars to add:', toInsert.length);
    for (let i = 0; i < toInsert.length; i += 50) {
      const batch = toInsert.slice(i, i + 50);
      const res = await fetch(SB_URL + '/rest/v1/inventory', {
        method: 'POST', headers: HEADERS, body: JSON.stringify(batch)
      });
      if (res.ok) { added += (await res.json()).length; }
      else { console.error('Insert batch error:', await res.text()); }
    }
  }

  // --- UPDATE EXISTING CARS (location + color) ---
  const toUpdate = csvCars.filter(c => existingByStock.has(c.stock));
  let updated = 0;
  for (const c of toUpdate) {
    const ex = existingByStock.get(c.stock);
    const patch = {};
    if (c.color) patch.color = c.color;
    if (c.location) patch.location = c.location;
    if (!Object.keys(patch).length) continue;
    const res = await fetch(`${SB_URL}/rest/v1/inventory?id=eq.${ex.id}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch)
    });
    if (res.ok) updated++;
    else console.error('Update error for', c.stock, ':', await res.text());
  }
  console.log('Updated:', updated);

  // --- REMOVE SOLD CARS ---
  const assignments = await sbGetAll('assignments', 'inventory_id,approved');
  const activeAssignments = new Set(
    assignments.filter(a => !a.approved).map(a => a.inventory_id)
  );

  const toRemove = existing.filter(c => {
    if (!c.stock) return false;
    if (allCsvStocks.has(c.stock)) return false;
    if (activeAssignments.has(c.id)) return false;
    return true;
  });

  let removed = 0;
  if (toRemove.length > 0) {
    console.log('Sold/removed cars to delete:', toRemove.length);
    for (const car of toRemove) {
      const res = await fetch(
        `${SB_URL}/rest/v1/inventory?id=eq.${car.id}`,
        { method: 'DELETE', headers: HEADERS }
      );
      if (res.ok) { removed++; }
      else { console.error('Delete error for', car.stock, ':', await res.text()); }
    }
  }

  console.log('=== SYNC COMPLETE ===');
  console.log('Added:', added, '| Removed:', removed, '| Total now:', existing.length + added - removed);
}
main().catch(e => { console.error(e); process.exit(1); });
