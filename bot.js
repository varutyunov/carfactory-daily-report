const fetch = require('node-fetch');
const fs = require('fs');

const TELEGRAM_TOKEN = process.env.TELEGRAM_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_KEY;
const ALLOWED_CHAT_ID = 6724715083;
const OFFSET_FILE = 'last_update_id.txt';

const TELEGRAM_API = `https://api.telegram.org/bot${TELEGRAM_TOKEN}`;

function getOffset() {
  if (fs.existsSync(OFFSET_FILE)) {
    const val = parseInt(fs.readFileSync(OFFSET_FILE, 'utf8').trim(), 10);
    return isNaN(val) ? 0 : val;
  }
  return 0;
}

function saveOffset(offset) {
  fs.writeFileSync(OFFSET_FILE, String(offset), 'utf8');
}

async function telegramGet(method, params = {}) {
  const url = new URL(`${TELEGRAM_API}/${method}`);
  for (const [k, v] of Object.entries(params)) {
    url.searchParams.set(k, v);
  }
  const res = await fetch(url.toString());
  return res.json();
}

async function sendMessage(chatId, text) {
  await fetch(`${TELEGRAM_API}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'Markdown' }),
  });
}

async function supabaseQuery(path) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
  });
  return res.json();
}

async function handleInventory(chatId) {
  const rows = await supabaseQuery('inventory?select=*');
  if (!Array.isArray(rows) || rows.length === 0) {
    return sendMessage(chatId, 'No inventory data found.');
  }
  const total = rows.length;
  const debary = rows.filter(r => (r.location || '').toLowerCase().includes('debary')).length;
  const deland = rows.filter(r => (r.location || '').toLowerCase().includes('deland')).length;
  const other = total - debary - deland;
  let msg = `*Inventory Summary*\nTotal: ${total} cars\n• DeBary: ${debary}\n• DeLand: ${deland}`;
  if (other > 0) msg += `\n• Other/Unknown: ${other}`;
  return sendMessage(chatId, msg);
}

async function handlePending(chatId) {
  const rows = await supabaseQuery('assignments?select=*&submitted=eq.true&approved=eq.false');
  if (!Array.isArray(rows) || rows.length === 0) {
    return sendMessage(chatId, 'No pending reviews found.');
  }
  const names = rows.map(r => r.car_name || r.vin || r.id || 'Unknown').join('\n• ');
  return sendMessage(chatId, `*Pending Reviews*\nCount: ${rows.length}\n• ${names}`);
}

async function handleTeam(chatId) {
  const rows = await supabaseQuery('employees?select=*');
  if (!Array.isArray(rows) || rows.length === 0) {
    return sendMessage(chatId, 'No employees found.');
  }
  const list = rows.map(r => `• ${r.name || 'Unknown'} — ${r.role || 'N/A'}`).join('\n');
  return sendMessage(chatId, `*Team Members*\n${list}`);
}

async function handleReport(chatId) {
  const [inventory, pending, assignments] = await Promise.all([
    supabaseQuery('inventory?select=*'),
    supabaseQuery('assignments?select=*&submitted=eq.true&approved=eq.false'),
    supabaseQuery('assignments?select=*&approved=eq.true'),
  ]);
  const totalCars = Array.isArray(inventory) ? inventory.length : '?';
  const pendingCount = Array.isArray(pending) ? pending.length : '?';
  const activeCount = Array.isArray(assignments) ? assignments.length : '?';
  return sendMessage(
    chatId,
    `*Daily Report*\n🚗 Total Inventory: ${totalCars} cars\n📋 Pending Reviews: ${pendingCount}\n✅ Active Assignments: ${activeCount}`
  );
}

function helpMenu(chatId) {
  return sendMessage(
    chatId,
    `*Car Factory Bot — Available Commands*\n\n` +
      `• \`inventory\` or \`how many cars\` — Inventory count by location\n` +
      `• \`pending\` or \`review\` — Cars awaiting approval\n` +
      `• \`team\` or \`employees\` — Employee list with roles\n` +
      `• \`report\` or \`today\` — Full daily summary`
  );
}

async function processMessage(msg) {
  const chatId = msg.chat && msg.chat.id;
  if (chatId !== ALLOWED_CHAT_ID) return;

  const text = (msg.text || '').toLowerCase().trim();

  if (text.includes('inventory') || text.includes('how many cars')) {
    await handleInventory(chatId);
  } else if (text.includes('pending') || text.includes('review')) {
    await handlePending(chatId);
  } else if (text.includes('team') || text.includes('employees')) {
    await handleTeam(chatId);
  } else if (text.includes('report') || text.includes('today')) {
    await handleReport(chatId);
  } else {
    await helpMenu(chatId);
  }
}

async function main() {
  let offset = getOffset();
  const data = await telegramGet('getUpdates', { offset, timeout: 5 });

  if (!data.ok || !Array.isArray(data.result) || data.result.length === 0) {
    console.log('No new updates.');
    return;
  }

  for (const update of data.result) {
    if (update.message) {
      await processMessage(update.message);
    }
    offset = update.update_id + 1;
  }

  saveOffset(offset);
  console.log(`Processed ${data.result.length} update(s). Next offset: ${offset}`);
}

main().catch(err => {
  console.error('Bot error:', err);
  process.exit(1);
});
