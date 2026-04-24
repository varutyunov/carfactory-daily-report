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
  for (let i = 1; i < lines.length; i++) {
    const vals = lines[i].split(',').map(v => v.trim().replace(/^"|"$/g, ''));
    const r = {};
    hdrs.forEach((h, j) => r[h] = vals[j] || '');
    if ((r['status'] !== 'INSTOCK' && r['status'] !== 'REPO') || !r['make'] || !r['vin']) continue;

    const color = r['colorexterior'] || r['color'] || r['extcolor'] || '';

    let location;
    if (forceLocation) {
      location = forceLocation;
    } else {
      const lot = r['lotno'];
      location = lot === '2' ? 'DeLand' : 'DeBary';
    }

    const miles = parseInt(r['currentmiles']) || null;
    cars.push({
      name: [r['year'], r['make'], r['model']].filter(Boolean).join(' '),
      stock: r['stockno'] || '',
      vin: r['vin'],
      location,
      color,
      miles
    });
  }
  console.log(`[${csvPath}] INSTOCK:`, cars.length);
  return cars;
}

async function main() {
  // Parse both CSV files
  const debaryCars = parseCsv('InventoryMaster.csv', null);
  const delandCars = fs.existsSync('InventoryMasterDeland.csv')
    ? parseCsv('InventoryMasterDeland.csv', 'DeLand')
    : [];

  // Deduplicate by VIN — VIN is the unique identifier
  const seen = new Set();
  const csvCars = [...debaryCars, ...delandCars].filter(c => {
    if (seen.has(c.vin)) return false;
    seen.add(c.vin);
    return true;
  });
  const allCsvVins = new Set(csvCars.map(c => c.vin));

  console.log('Total INSTOCK (both lots):', csvCars.length);

  // Get ALL existing vehicles from Supabase (include re_acquired so we can
  // preserve cars that came back via the app's "Return to Inventory" button
  // even though the back-office CSV still considers them sold).
  const existing = await sbGetAll('inventory', 'id,stock,vin,name,location,color,miles,re_acquired');
  const existingByVin = new Map(existing.filter(c => c.vin).map(c => [c.vin, c]));
  console.log('Currently in DB:', existing.length);
  const reAcquiredVins = new Set(existing.filter(c => c.re_acquired).map(c => c.vin));
  if (reAcquiredVins.size) {
    console.log('Preserving re_acquired cars:', reAcquiredVins.size);
  }

  // --- ADD NEW CARS (VIN not in DB) ---
  const toInsert = csvCars.filter(c => !existingByVin.has(c.vin));

  let added = 0;
  if (toInsert.length > 0) {
    console.log('New cars to add:', toInsert.length);
    for (const car of toInsert) {
      const res = await fetch(SB_URL + '/rest/v1/inventory', {
        method: 'POST', headers: HEADERS, body: JSON.stringify([car])
      });
      if (res.ok) { added += (await res.json()).length; }
      else {
        const errText = await res.text();
        // Stock unique constraint conflict — insert without stock, then patch stock on
        if (errText.includes('inventory_stock_key')) {
          console.log('Stock conflict for', car.vin, '- inserting with VIN-based stock');
          const carAlt = { ...car, stock: car.vin.slice(-8) };
          const res2 = await fetch(SB_URL + '/rest/v1/inventory', {
            method: 'POST', headers: HEADERS, body: JSON.stringify([carAlt])
          });
          if (res2.ok) { added += (await res2.json()).length; }
          else { console.error('Insert (alt stock) error:', await res2.text()); }
        } else {
          console.error('Insert error for', car.vin, ':', errText);
        }
      }
    }
  }

  // --- UPDATE EXISTING CARS (match by VIN) ---
  let updated = 0;
  for (const c of csvCars) {
    const ex = existingByVin.get(c.vin);
    if (!ex) continue;
    const patch = {};
    if (c.name && c.name !== ex.name) patch.name = c.name;
    if (c.color && c.color !== ex.color) patch.color = c.color;
    if (c.location && c.location !== ex.location) patch.location = c.location;
    if (c.stock && c.stock !== ex.stock) patch.stock = c.stock;
    if (c.miles && c.miles !== ex.miles) patch.miles = c.miles;
    // If a re_acquired car shows up in the CSV again, the back-office has
    // re-listed it — clear the re_acquired flag so it behaves like a normal
    // car going forward.
    if (ex.re_acquired) {
      patch.re_acquired = false;
      patch.re_acquired_reason = null;
      patch.re_acquired_at = null;
      patch.re_acquired_from_deal_id = null;
    }
    if (!Object.keys(patch).length) continue;
    const res = await fetch(`${SB_URL}/rest/v1/inventory?id=eq.${ex.id}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch)
    });
    if (res.ok) updated++;
    else console.error('Update error for', c.vin, ':', await res.text());
  }
  console.log('Updated:', updated);

  // --- REMOVE SOLD CARS (VIN no longer in any CSV) ---
  const assignments = await sbGetAll('assignments', 'inventory_id,approved');
  const activeAssignments = new Set(
    assignments.filter(a => !a.approved).map(a => a.inventory_id)
  );

  const toRemove = existing.filter(c => {
    if (!c.vin) return false;
    if (allCsvVins.has(c.vin)) return false;
    if (activeAssignments.has(c.id)) return false;
    // Preserve cars returned to inventory via the app's "Return to Inventory"
    // button (deals that fell through, repossessions). Back-office CSV still
    // has them as sold, but they're physically on the lot.
    if (c.re_acquired) return false;
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
      else { console.error('Delete error for', car.vin, ':', await res.text()); }
    }
  }

  console.log('=== SYNC COMPLETE ===');
  console.log('Added:', added, '| Updated:', updated, '| Removed:', removed, '| Total now:', existing.length + added - removed);
}
main().catch(e => { console.error(e); process.exit(1); });
