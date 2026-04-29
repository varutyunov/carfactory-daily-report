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
    // Prefer totalcost (base + buyer's/auction fee) so IC col G reflects what was actually paid.
    const cost = parseFloat(r['totalcost'] || r['netcost'] || r['cost'] || r['askingprice'] || r['purchaseprice'] || '') || 0;
    cars.push({
      name: [r['year'], r['make'], r['model']].filter(Boolean).join(' '),
      stock: r['stockno'] || '',
      vin: r['vin'],
      location,
      color,
      miles,
      cost  // carried forward for review snapshot; NOT written to inventory table
    });
  }
  console.log(`[${csvPath}] INSTOCK:`, cars.length);
  return cars;
}

// Mirrors client-side _icCarNameFromInv
function buildCarName(car) {
  const nameParts = (car.name || '').split(' ');
  const fullYear = nameParts[0] || '';
  const shortYr = fullYear.length === 4 ? fullYear.slice(2) : fullYear;
  const make = nameParts[1] || '';
  const model = nameParts.length > 2 ? nameParts.slice(2).join(' ') : '';
  const color = (car.color || '').toLowerCase();
  const milesK = car.miles ? Math.round(car.miles / 1000) + 'k' : '';
  const modelHasDigits = /\d/.test(model) && !/\s/.test(model);
  return [shortYr, modelHasDigits ? make : '', model, color, milesK].filter(Boolean).join(' ');
}

// Mirrors client-side _normalizeIcKey
function normalizeIcKey(s) {
  return (s || '').toString().trim().toLowerCase()
    .replace(/\s+\d+$/, '')
    .replace(/\bgrey\b/g, 'gray')
    .replace(/\bnardo\b/g, 'gray')
    .replace(/\bcharcoal\b/g, 'gray')
    .replace(/\bsmokey?\b/g, 'gray')
    .replace(/\banthracite\b/g, 'gray')
    .replace(/\baluminium\b/g, 'aluminum')
    .replace(/\bchampagne\b/g, 'beige')
    .replace(/\bcream\b/g, 'beige')
    .replace(/\bpearl\b/g, 'white')
    .replace(/\boff.white\b/g, 'white')
    .replace(/\bburgundy\b/g, 'red')
    .replace(/\bmaroon\b/g, 'red')
    .replace(/\bnavy\b/g, 'blue')
    .replace(/\s+/g, ' ');
}

// Queue inv_create_pending reviews for newly inserted cars.
// Mirrors client-side _autoCreateInventoryCosts + _queueInventoryAddReview.
async function queueInventoryReviews(insertedCars, csvCostByVin) {
  if (!insertedCars.length) return;

  // Fetch existing inventory_costs to skip already-tracked cars
  let allIc = [];
  try { allIc = await sbGetAll('inventory_costs', 'id,car_id,car_name,location'); } catch(e) {
    console.warn('queueInventoryReviews: could not fetch inventory_costs:', e.message);
  }
  const existingCarIds = new Set(allIc.filter(r => r.car_id).map(r => r.car_id));
  const existingNameKeys = new Set(
    allIc.map(r => {
      const n = normalizeIcKey(r.car_name);
      return (n && n !== 'total') ? n + '||' + (r.location || 'DeBary') : null;
    }).filter(Boolean)
  );

  // Fetch existing pending/rejected inv_create_pending reviews to dedupe
  let existingReviews = [];
  try {
    const url = `${SB_URL}/rest/v1/payment_reviews?reason=eq.inv_create_pending&status=in.(pending,rejected)&select=id,snapshot,location&limit=1000`;
    const res = await fetch(url, { headers: HEADERS });
    if (res.ok) existingReviews = await res.json();
  } catch(e) {
    console.warn('queueInventoryReviews: could not fetch existing reviews:', e.message);
  }
  const reviewedCarIds = new Set();
  const reviewedNameKeys = new Set();
  existingReviews.forEach(r => {
    const ic = (r.snapshot && r.snapshot.ic) || {};
    if (ic.car_id) reviewedCarIds.add(ic.car_id);
    const n = normalizeIcKey(ic.car_name);
    if (n) reviewedNameKeys.add(n + '||' + (r.location || 'DeBary'));
  });

  let queued = 0;
  for (const car of insertedCars) {
    if (!car.id) continue;
    if (existingCarIds.has(car.id)) continue;
    if (reviewedCarIds.has(car.id)) continue;

    const carName = buildCarName(car);
    if (!carName) continue;

    const loc = car.location || 'DeBary';
    const nameKey = normalizeIcKey(carName) + '||' + loc;
    if (existingNameKeys.has(nameKey)) continue;
    if (reviewedNameKeys.has(nameKey)) continue;

    const cost = (car.vin && csvCostByVin[car.vin]) || car.cost || 0;

    const reviewRow = {
      reason: 'inv_create_pending',
      status: 'pending',
      location: loc,
      note_line: carName,
      customer_name: 'CSV sync',
      snapshot: { ic: {
        car_name: carName,
        car_id: car.id,
        purchase_cost: cost,
        joint_expenses: 0,
        vlad_expenses: 0,
        expense_notes: '',
        vlad_expense_notes: '',
        location: loc,
        source: 'csv'
      }}
    };

    try {
      const res = await fetch(SB_URL + '/rest/v1/payment_reviews', {
        method: 'POST', headers: HEADERS, body: JSON.stringify(reviewRow)
      });
      if (res.ok) { queued++; }
      else { console.error('Failed to queue review for', carName, ':', await res.text()); }
    } catch(e) {
      console.error('Queue review error for', carName, ':', e.message);
    }
  }

  console.log('Queued inv_create_pending reviews:', queued);
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

  // Cost lookup by VIN (for review snapshots)
  const csvCostByVin = {};
  csvCars.forEach(c => { if (c.vin && c.cost) csvCostByVin[c.vin] = c.cost; });

  console.log('Total INSTOCK (both lots):', csvCars.length);

  // Get ALL existing vehicles from Supabase (include re_acquired so we can
  // preserve cars that came back via the app's "Return to Inventory" button
  // even though the back-office CSV still considers them sold).
  const existing = await sbGetAll('inventory', 'id,stock,vin,name,location,color,miles,re_acquired,sold_at');
  const existingByVin = new Map(existing.filter(c => c.vin).map(c => [c.vin, c]));
  console.log('Currently in DB:', existing.length);
  const reAcquiredVins = new Set(existing.filter(c => c.re_acquired).map(c => c.vin));
  if (reAcquiredVins.size) {
    console.log('Preserving re_acquired cars:', reAcquiredVins.size);
  }

  // --- ADD NEW CARS (VIN not in DB) ---
  const toInsert = csvCars.filter(c => !existingByVin.has(c.vin));

  let added = 0;
  const insertedWithIds = []; // collect full rows (with Supabase IDs) for review queuing
  if (toInsert.length > 0) {
    console.log('New cars to add:', toInsert.length);
    for (const car of toInsert) {
      // Don't write cost to inventory table (no such column) — strip it first
      const { cost: _cost, ...carRow } = car;
      const res = await fetch(SB_URL + '/rest/v1/inventory', {
        method: 'POST', headers: HEADERS, body: JSON.stringify([carRow])
      });
      if (res.ok) {
        const rows = await res.json();
        added += rows.length;
        // Attach cost back so queueInventoryReviews can use it
        rows.forEach(r => insertedWithIds.push({ ...r, cost: _cost || 0 }));
      } else {
        const errText = await res.text();
        // Stock unique constraint conflict — insert without stock, then patch stock on
        if (errText.includes('inventory_stock_key')) {
          console.log('Stock conflict for', car.vin, '- inserting with VIN-based stock');
          const carAlt = { ...carRow, stock: car.vin.slice(-8) };
          const res2 = await fetch(SB_URL + '/rest/v1/inventory', {
            method: 'POST', headers: HEADERS, body: JSON.stringify([carAlt])
          });
          if (res2.ok) {
            const rows2 = await res2.json();
            added += rows2.length;
            rows2.forEach(r => insertedWithIds.push({ ...r, cost: _cost || 0 }));
          } else { console.error('Insert (alt stock) error:', await res2.text()); }
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
    // Location is intentionally NOT auto-updated. Back-office CSVs sometimes
    // misclassify lotno (e.g. a DeBary car flagged lotno=2 → DeLand), and
    // overwriting on every sync clobbers manual lot fixes made in the app.
    // Location is set only on initial insert; cars that genuinely move
    // between lots need a manual update in the app.
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
    // If a sold car reappears in the CSV (re-listed, deal fell through, etc.),
    // clear the sold_at marker so it returns to active inventory.
    if (ex.sold_at) {
      patch.sold_at = null;
    }
    if (!Object.keys(patch).length) continue;
    const res = await fetch(`${SB_URL}/rest/v1/inventory?id=eq.${ex.id}`, {
      method: 'PATCH', headers: HEADERS, body: JSON.stringify(patch)
    });
    if (res.ok) updated++;
    else console.error('Update error for', c.vin, ':', await res.text());
  }
  console.log('Updated:', updated);

  // --- SOFT-MARK SOLD CARS (VIN no longer in any CSV) ---
  // Soft-delete pattern: instead of removing the row, stamp `sold_at` with the
  // current timestamp. Staff can still look up VIN, take a deposit, or record
  // a final payment for ~30 days. Hard-delete happens after that.
  const assignments = await sbGetAll('assignments', 'inventory_id,approved');
  const activeAssignments = new Set(
    assignments.filter(a => !a.approved).map(a => a.inventory_id)
  );

  const toMarkSold = existing.filter(c => {
    if (!c.vin) return false;
    if (allCsvVins.has(c.vin)) return false;
    if (activeAssignments.has(c.id)) return false;
    // Preserve cars returned to inventory via the app's "Return to Inventory"
    // button (deals that fell through, repossessions). Back-office CSV still
    // has them as sold, but they're physically on the lot.
    if (c.re_acquired) return false;
    // Already marked sold — don't re-stamp the timestamp; the 30-day clock
    // should keep ticking from when the car FIRST disappeared from the CSV.
    if (c.sold_at) return false;
    return true;
  });

  let markedSold = 0;
  if (toMarkSold.length > 0) {
    console.log('Cars to soft-mark as sold:', toMarkSold.length);
    const nowIso = new Date().toISOString();
    for (const car of toMarkSold) {
      const res = await fetch(
        `${SB_URL}/rest/v1/inventory?id=eq.${car.id}`,
        { method: 'PATCH', headers: HEADERS, body: JSON.stringify({ sold_at: nowIso }) }
      );
      if (res.ok) { markedSold++; }
      else { console.error('Mark-sold error for', car.vin, ':', await res.text()); }
    }
  }

  // --- HARD-DELETE cars sold > 30 days ago ---
  // Removes rows long after staff have stopped looking them up.
  const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - THIRTY_DAYS_MS).toISOString();
  let removed = 0;
  try {
    const oldSold = await sbGetAll('inventory',
      'id,vin,sold_at&sold_at=lt.' + encodeURIComponent(cutoff) + '&sold_at=not.is.null');
    if (oldSold.length > 0) {
      console.log('Cars sold >30d ago to hard-delete:', oldSold.length);
      for (const car of oldSold) {
        // Same safety filters as before
        if (activeAssignments.has(car.id)) continue;
        const res = await fetch(
          `${SB_URL}/rest/v1/inventory?id=eq.${car.id}`,
          { method: 'DELETE', headers: HEADERS }
        );
        if (res.ok) { removed++; }
        else { console.error('Hard-delete error for', car.vin, ':', await res.text()); }
      }
    }
  } catch(e) {
    console.warn('Hard-delete pass failed (non-fatal):', e.message);
  }

  console.log('=== SYNC COMPLETE ===');
  console.log('Added:', added, '| Updated:', updated, '| Marked sold:', markedSold, '| Hard-deleted (>30d):', removed, '| Total now:', existing.length + added - removed);

  // --- QUEUE inv_create_pending REVIEWS for newly inserted cars ---
  if (insertedWithIds.length > 0) {
    console.log('Queuing inventory reviews for', insertedWithIds.length, 'new car(s)...');
    try { await queueInventoryReviews(insertedWithIds, csvCostByVin); }
    catch(e) { console.warn('queueInventoryReviews failed (non-fatal):', e.message); }
  }

  // --- BACKFILL $0 COSTS from latest CSV ---
  // Race condition: dealer system pushes new inventory + cost as separate
  // events. If our cron grabs the CSV between them, the totalcost field
  // is empty and the queued review (or already-approved ic row) ends up
  // with $0. This sweep, run on EVERY cron, fills in any $0 values that
  // now have a real cost in the CSV. Idempotent: only updates when the
  // CSV cost > 0 and the current value is 0 or missing.
  try { await backfillZeroCosts(csvCostByVin, csvCars); }
  catch(e) { console.warn('backfillZeroCosts failed (non-fatal):', e.message); }
}

async function backfillZeroCosts(csvCostByVin, csvCars) {
  // Build VIN/stock lookup
  const csvByStock = {};
  csvCars.forEach(c => { if (c.stock && c.cost) csvByStock[c.stock] = c.cost; });

  // 1. Update zero-cost inv_create_pending reviews that are still pending
  let revsFixed = 0;
  try {
    const url = `${SB_URL}/rest/v1/payment_reviews?reason=eq.inv_create_pending&status=eq.pending&select=id,snapshot,location&limit=1000`;
    const res = await fetch(url, { headers: HEADERS });
    const reviews = res.ok ? await res.json() : [];
    // Cross-reference each review's car_id back to inventory.vin to look up cost
    const carIds = reviews.map(r => (r.snapshot && r.snapshot.ic && r.snapshot.ic.car_id)).filter(Boolean);
    let invByCarId = {};
    if (carIds.length) {
      const inIds = `(${[...new Set(carIds)].join(',')})`;
      const invRes = await fetch(`${SB_URL}/rest/v1/inventory?id=in.${inIds}&select=id,vin,stock`, { headers: HEADERS });
      if (invRes.ok) {
        const rows = await invRes.json();
        rows.forEach(r => { invByCarId[r.id] = r; });
      }
    }
    for (const rev of reviews) {
      const ic = (rev.snapshot && rev.snapshot.ic) || {};
      const currentCost = parseFloat(ic.purchase_cost) || 0;
      if (currentCost > 0) continue;
      const inv = invByCarId[ic.car_id];
      const csvCost = (inv && inv.vin && csvCostByVin[inv.vin])
                   || (inv && inv.stock && csvByStock[inv.stock])
                   || 0;
      if (csvCost > 0) {
        const newSnap = { ...rev.snapshot, ic: { ...ic, purchase_cost: csvCost } };
        const patchRes = await fetch(`${SB_URL}/rest/v1/payment_reviews?id=eq.${rev.id}`, {
          method: 'PATCH', headers: HEADERS, body: JSON.stringify({ snapshot: newSnap })
        });
        if (patchRes.ok) {
          console.log(`  backfilled review id=${rev.id} (${ic.car_name}): $0 → $${csvCost}`);
          revsFixed++;
        }
      }
    }
  } catch(e) { console.warn('backfill: review pass failed:', e.message); }

  // 2. Update zero-cost inventory_costs rows directly (for already-approved
  //    ones that locked in $0 before this fix existed).
  let icFixed = 0;
  try {
    const icUrl = `${SB_URL}/rest/v1/inventory_costs?or=(purchase_cost.eq.0,purchase_cost.is.null)&car_id=not.is.null&select=id,car_id,car_name,purchase_cost,location&limit=1000`;
    const icRes = await fetch(icUrl, { headers: HEADERS });
    const ics = icRes.ok ? await icRes.json() : [];
    const carIds = ics.map(r => r.car_id).filter(Boolean);
    let invByCarId = {};
    if (carIds.length) {
      const inIds = `(${[...new Set(carIds)].join(',')})`;
      const invRes = await fetch(`${SB_URL}/rest/v1/inventory?id=in.${inIds}&select=id,vin,stock`, { headers: HEADERS });
      if (invRes.ok) {
        const rows = await invRes.json();
        rows.forEach(r => { invByCarId[r.id] = r; });
      }
    }
    for (const r of ics) {
      const inv = invByCarId[r.car_id];
      const csvCost = (inv && inv.vin && csvCostByVin[inv.vin])
                   || (inv && inv.stock && csvByStock[inv.stock])
                   || 0;
      if (csvCost > 0) {
        const patchRes = await fetch(`${SB_URL}/rest/v1/inventory_costs?id=eq.${r.id}`, {
          method: 'PATCH', headers: HEADERS, body: JSON.stringify({ purchase_cost: csvCost })
        });
        if (patchRes.ok) {
          console.log(`  backfilled ic id=${r.id} (${r.car_name}): $0 → $${csvCost}`);
          icFixed++;
        }
      }
    }
  } catch(e) { console.warn('backfill: ic pass failed:', e.message); }

  if (revsFixed || icFixed) {
    console.log(`Cost backfill: ${revsFixed} pending review(s), ${icFixed} ic row(s).`);
  }
}

main().catch(e => { console.error(e); process.exit(1); });
