// sheets-sync.js — Google Sheet → Supabase
// Called by Google Apps Script onEdit trigger when a cell is changed
// POST body: { secret, table, action, row_index, data: { ...fields } }

const SUPABASE_URL = 'https://hphlouzqlimainczuqyc.supabase.co';

exports.handler = async function(event) {
  // CORS
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { secret, table, action, row_index, data } = body;

    // Auth check
    if (!secret || secret !== process.env.SHEETS_SYNC_SECRET) {
      return resp(401, { error: 'Unauthorized' });
    }

    // Validate table
    if (!['inventory_costs', 'deals26'].includes(table)) {
      return resp(400, { error: 'Invalid table' });
    }

    const SB_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.SUPABASE_ANON_KEY;
    if (!SB_KEY) {
      return resp(500, { error: 'Missing Supabase key' });
    }

    const headers = {
      'apikey': SB_KEY,
      'Authorization': 'Bearer ' + SB_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    };

    // Add sync_source to prevent loops
    data.sync_source = 'sheets';
    data.updated_at = new Date().toISOString();

    if (action === 'update' && data.id) {
      // Update existing row by id
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${data.id}`, {
        method: 'PATCH', headers, body: JSON.stringify(data)
      });
      const result = await res.json();
      return resp(200, { ok: true, action: 'updated', result });
    }

    if (action === 'update_by_index' && row_index != null) {
      // Update by sort_order (for deals26) or sequential position (for inventory_costs)
      if (table === 'deals26') {
        const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?sort_order=eq.${row_index}`, {
          method: 'PATCH', headers, body: JSON.stringify(data)
        });
        const result = await res.json();
        return resp(200, { ok: true, action: 'updated_by_index', result });
      } else {
        // inventory_costs: get nth row by id order
        const listRes = await fetch(`${SUPABASE_URL}/rest/v1/${table}?select=id&order=id.asc&limit=1&offset=${row_index - 1}`, {
          headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
        });
        const rows = await listRes.json();
        if (rows.length > 0) {
          const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${rows[0].id}`, {
            method: 'PATCH', headers, body: JSON.stringify(data)
          });
          const result = await res.json();
          return resp(200, { ok: true, action: 'updated_by_index', result });
        }
        return resp(404, { error: 'Row not found at index ' + row_index });
      }
    }

    if (action === 'insert') {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
        method: 'POST', headers, body: JSON.stringify(data)
      });
      const result = await res.json();
      return resp(201, { ok: true, action: 'inserted', result });
    }

    if (action === 'delete' && data.id) {
      await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${data.id}`, {
        method: 'DELETE', headers: { 'apikey': SB_KEY, 'Authorization': 'Bearer ' + SB_KEY }
      });
      return resp(200, { ok: true, action: 'deleted' });
    }

    return resp(400, { error: 'Invalid action: ' + action });

  } catch (e) {
    return resp(500, { error: e.message });
  }
};

function corsHeaders() {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS'
  };
}

function resp(code, body) {
  return { statusCode: code, headers: corsHeaders(), body: JSON.stringify(body) };
}
