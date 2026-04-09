exports.handler = async function(event) {
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS'
      },
      body: ''
    };
  }

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  try {
    const { app_id, api_key, target_names, title, body } = JSON.parse(event.body);

    if (!app_id || !api_key || !target_names || !title) {
      return { statusCode: 400, body: JSON.stringify({ error: 'Missing required fields' }) };
    }

    // Build aliases for OneSignal v2 style targeting by external_id
    const aliases = target_names.map(function(n) {
      return n.toLowerCase().replace(/\s+/g, '_');
    });

    const payload = {
      app_id: app_id,
      include_aliases: { external_id: aliases },
      target_channel: 'push',
      headings: { en: title },
      contents: { en: body || '' }
    };

    const response = await fetch('https://api.onesignal.com/notifications', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Basic ' + api_key
      },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    return {
      statusCode: response.status,
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(result)
    };
  } catch (e) {
    return {
      statusCode: 500,
      headers: { 'Access-Control-Allow-Origin': '*' },
      body: JSON.stringify({ error: e.message })
    };
  }
};
