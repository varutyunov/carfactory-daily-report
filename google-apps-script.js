// ============================================================
// Google Apps Script — Two-Way Sync for "Car Factory Debary"
// ============================================================
// SETUP:
// 1. Open your Google Sheet → Extensions → Apps Script
// 2. Paste this entire file → Save
// 3. Set SYNC_SECRET below to any password you choose
// 4. Deploy → New deployment → Web app → Execute as: Me → Who has access: Anyone → Deploy
// 5. Copy the web app URL (you'll paste it into the app)
// 6. Go to Triggers (clock icon) → Add trigger:
//    Function: onSheetEdit | Event: From spreadsheet | On edit
// ============================================================

var SYNC_SECRET = 'cf-sync-2026';

// Spreadsheet ID (standalone script — references the original sheet by ID)
var SPREADSHEET_ID = '1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE';

// Supabase config
var SUPABASE_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';

// Tab config — maps sheet tab names to Supabase tables + column layouts
var TAB_CONFIG = {
  'Inventory': {
    table: 'inventory_costs',
    startRow: 20,    // First data row in the sheet (1-indexed)
    columns: {
      'G': 'purchase_cost',
      'H': 'car_name',
      'I': 'joint_expenses',
      'J': 'vlad_expenses'
      // K = Total (formula, don't sync)
    }
  },
  'Deals26': {
    table: 'deals26',
    startRow: 2,     // First data row (row 1 = header)
    columns: {
      'A': 'cost',
      'B': 'car_desc',
      'C': 'expenses',
      'D': 'taxes',
      'E': 'money',
      'F': 'owed',
      'G': 'payments',
      'H': 'dealer_fee',
      'I': 'manny',
      'J': 'deal_num',
      'K': 'gps_sold'
    }
  }
};

// ============================================================
// DIRECTION 1: Google Sheet → Supabase (on cell edit)
// ============================================================
function onSheetEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var tabName = sheet.getName();
  var config = TAB_CONFIG[tabName];
  if (!config) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  var colLetter = columnToLetter(col);

  if (row < config.startRow) return;

  var field = config.columns[colLetter];
  if (!field) return;

  // Check if this edit came from the app (via doPost) — skip to prevent loops
  var lock = PropertiesService.getScriptProperties().getProperty('_syncLock');
  if (lock === 'app') {
    PropertiesService.getScriptProperties().deleteProperty('_syncLock');
    return;
  }

  var rowIndex = row - config.startRow + 1;

  // Build data object with all synced fields for this row
  var data = {};
  var colKeys = Object.keys(config.columns);
  for (var i = 0; i < colKeys.length; i++) {
    var cLetter = colKeys[i];
    var cField = config.columns[cLetter];
    var cNum = letterToColumn(cLetter);
    var val = sheet.getRange(row, cNum).getValue();

    if (cField === 'gps_sold') {
      data[cField] = (val === 'X' || val === 'x' || val === true);
    } else if (cField === 'car_name' || cField === 'car_desc') {
      data[cField] = String(val || '');
    } else if (cField === 'deal_num') {
      data[cField] = parseInt(val) || 0;
    } else {
      data[cField] = parseFloat(String(val).replace(/[$,]/g, '')) || 0;
    }
  }

  data.sync_source = 'sheets';
  data.updated_at = new Date().toISOString();

  // Write directly to Supabase
  try {
    if (config.table === 'deals26') {
      // Update by sort_order
      supabasePatch(config.table, 'sort_order=eq.' + rowIndex, data);
    } else {
      // inventory_costs: get the nth row by id order
      var rows = supabaseGet(config.table, 'select=id&order=id.asc&limit=1&offset=' + (rowIndex - 1));
      if (rows && rows.length > 0) {
        supabasePatch(config.table, 'id=eq.' + rows[0].id, data);
      }
    }
  } catch (err) {
    Logger.log('Sheet→Supabase sync error: ' + err.message);
  }
}

// ============================================================
// DIRECTION 2: App → Google Sheet (via web app doPost)
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    if (body.secret !== SYNC_SECRET) {
      return jsonResponse({ error: 'Unauthorized' });
    }

    var tabName = body.tab;
    var config = TAB_CONFIG[tabName];
    if (!config) {
      return jsonResponse({ error: 'Unknown tab: ' + tabName });
    }

    var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      return jsonResponse({ error: 'Sheet tab not found: ' + tabName });
    }

    var rowIndex = body.row_index;
    var data = body.data;
    var targetRow = config.startRow + rowIndex - 1;

    // Set lock so onSheetEdit knows to skip this edit
    PropertiesService.getScriptProperties().setProperty('_syncLock', 'app');

    // Write each field to its column
    var colKeys = Object.keys(config.columns);
    for (var j = 0; j < colKeys.length; j++) {
      var cLetter = colKeys[j];
      var cField = config.columns[cLetter];
      if (data.hasOwnProperty(cField)) {
        var cNum = letterToColumn(cLetter);
        var val = data[cField];
        if (cField === 'gps_sold') {
          val = val ? 'X' : '';
        }
        sheet.getRange(targetRow, cNum).setValue(val);
      }
    }

    SpreadsheetApp.flush();

    return jsonResponse({ ok: true, row: targetRow });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

function doGet(e) {
  return jsonResponse({ status: 'ok', message: 'Car Factory Sheets Sync is running' });
}

// ============================================================
// Supabase helpers
// ============================================================
function supabaseGet(table, query) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + query;
  var res = UrlFetchApp.fetch(url, {
    method: 'get',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    },
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}

function supabasePatch(table, filter, data) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
  UrlFetchApp.fetch(url, {
    method: 'patch',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=minimal'
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
}

// ============================================================
// Helpers
// ============================================================
function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function columnToLetter(col) {
  var letter = '';
  while (col > 0) {
    var mod = (col - 1) % 26;
    letter = String.fromCharCode(65 + mod) + letter;
    col = Math.floor((col - 1) / 26);
  }
  return letter;
}

function letterToColumn(letter) {
  var col = 0;
  for (var i = 0; i < letter.length; i++) {
    col = col * 26 + (letter.charCodeAt(i) - 64);
  }
  return col;
}
