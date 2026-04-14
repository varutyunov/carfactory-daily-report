// sheets-push.js — Push app edits to Google Sheet via Apps Script Web App
// Called from the app after saving to Supabase (isEditSave, d26Save, etc.)
// POST body: { secret, tab, action, row_index, data: { ...fields } }

exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return { statusCode: 200, headers: corsHeaders(), body: '' };
  }
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: corsHeaders(), body: 'Method not allowed' };
  }

  try {
    const body = JSON.parse(event.body);
    const { secret, tab, action, row_index, data } = body;

    if (!secret || secret !== process.env.SHEETS_SYNC_SECRET) {
      return resp(401, { error: 'Unauthorized' });
    }

    const APPS_SCRIPT_URL = process.env.APPS_SCRIPT_WEB_URL;
    if (!APPS_SCRIPT_URL) {
      return resp(500, { error: 'Missing Apps Script URL' });
    }

    // Forward to Google Apps Script web app
    const res = await fetch(APPS_SCRIPT_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        secret: process.env.SHEETS_SYNC_SECRET,
        tab,
        action,
        row_index,
        data,
        source: 'app'
      })
    });

    const text = await res.text();
    let result;
    try { result = JSON.parse(text); } catch(e) { result = { raw: text }; }
    return resp(200, { ok: true, result });

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
