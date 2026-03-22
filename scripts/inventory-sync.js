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

async function main() {
  // Read CSV directly from repo
  const csv = fs.readFileSync('InventoryMaster.csv', 'utf8');
  if (!csv || csv.length < 100) throw new Error('CSV empty or not found');
  const lines = csv.trim().split('\n');
  const hdrs = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, '').toLowerCase());
  console.log('Columns found:', hdrs.join(', '));

  // Parse CSV rows
  const csvCars = [];
  const csvStocks = new Set();
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const r = {};
    hdrs.forEach((h, j) => r[h] = vals[j] || '');
    if (r['status'] !== 'INSTOCK' || !r['make'] || !r['stockno']) continue;

    // Fix: correct column name is 'colorexterior', not 'color'
    const color = r['colorexterior'] || r['color'] || r['extcolor'] || '';

    // Fix: lot 1 = DeBary, lot 2 = DeLand, lot 3 = DeBary (overflow lot)
    const lot = r['lotno'];
    const location = lot === '2' ? 'DeLand' : 'DeBary';

    csvCars.push({
      name: [r['year'], r['make'], r['model']].filter(Boolean).join(' '),
      stock: r['stockno'],
      vin: r['vin'] || '',
      location,
      color
    });
    csvStocks.add(r['stockno']);
  }
  console.log('INSTOCK in CSV:', csvCars.length);

  // Get ALL existing vehicles from Supabase (paginated)
  const existing = await sbGetAll('inventory', 'id,stock,vin,name');
  const existingByStock = new Map(existing.map(c => [c.stock, c]));
  const existingByVin = new Map(existing.filter(c => c.vin).map(c => [c.vin, c]));
  console.log('Currently in DB:', existing.length);

  // --- ADD NEW CARS ---
  const toInsert = csvCars.filter(c => {
    // Skip if stock number already exists
    if (existingByStock.has(c.stock)) return false;
    // Skip if VIN already exists (prevent duplicates from stock number changes)
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

  // --- REMOVE SOLD CARS ---
  // Cars in Supabase whose stock number is NOT in the CSV INSTOCK list
  // Only remove cars that have no active assignments
  const assignments = await sbGetAll('assignments', 'inventory_id,approved');
  const activeAssignments = new Set(
    assignments.filter(a => !a.approved).map(a => a.inventory_id)
  );

  const toRemove = existing.filter(c => {
    if (!c.stock) return false;
    if (csvStocks.has(c.stock)) return false; // still in stock
    if (activeAssignments.has(c.id)) return false; // has active work, keep it
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
