// ============================================================
// Google Apps Script — Two-Way Sync for "Car Factory Debary"
// ============================================================
// Install: Extensions > Apps Script > paste this > Save
// Then: Deploy > New deployment > Web app > Anyone > Deploy
// Copy the web app URL → set as APPS_SCRIPT_WEB_URL in Netlify env vars
// Also set SHEETS_SYNC_SECRET in both Netlify and here (line below)
// Then: Triggers (clock icon) > Add trigger > onSheetEdit > On edit
// ============================================================

var SYNC_SECRET = 'CHANGE_ME_TO_YOUR_SECRET'; // Must match Netlify env SHEETS_SYNC_SECRET
var NETLIFY_SYNC_URL = 'https://carfactory.work/.netlify/functions/sheets-sync';

// Tab config — maps sheet tab names to Supabase tables + column layouts
var TAB_CONFIG = {
  'Inventory': {
    table: 'inventory_costs',
    startRow: 20,    // First data row in the sheet (1-indexed)
    columns: {
      // column letter → Supabase field
      'G': 'purchase_cost',    // Cost
      'H': 'car_name',         // Car Name
      'I': 'joint_expenses',   // Joint Expenses
      'J': 'vlad_expenses',    // Vlad Expenses
      // K = Total (formula, don't sync back)
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
      'K': 'gps_sold'         // X = true
    }
  }
};

// Lock to prevent re-entrant edits
var _syncing = false;

// ============================================================
// DIRECTION 1: Google Sheet → Supabase (on edit)
// ============================================================
function onSheetEdit(e) {
  if (_syncing) return;
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var tabName = sheet.getName();
  var config = TAB_CONFIG[tabName];
  if (!config) return; // Not a synced tab

  var row = e.range.getRow();
  var col = e.range.getColumn();
  var colLetter = columnToLetter(col);

  // Check if this is a data row
  if (row < config.startRow) return;

  // Check if this is a synced column
  var field = config.columns[colLetter];
  if (!field) return;

  // Get the row index relative to start
  var rowIndex = row - config.startRow + 1;

  // Build data object with all synced fields for this row
  var data = {};
  var colKeys = Object.keys(config.columns);
  for (var i = 0; i < colKeys.length; i++) {
    var cLetter = colKeys[i];
    var cField = config.columns[cLetter];
    var cNum = letterToColumn(cLetter);
    var val = sheet.getRange(row, cNum).getValue();

    // Type conversions
    if (cField === 'gps_sold') {
      data[cField] = (val === 'X' || val === 'x' || val === true);
    } else if (cField === 'car_name' || cField === 'car_desc' || cField === 'expense_notes' || cField === 'notes') {
      data[cField] = String(val || '');
    } else if (cField === 'deal_num') {
      data[cField] = parseInt(val) || 0;
    } else {
      // Numeric — strip $ and commas
      data[cField] = parseFloat(String(val).replace(/[$,]/g, '')) || 0;
    }
  }

  // POST to Netlify function
  var payload = {
    secret: SYNC_SECRET,
    table: config.table,
    action: 'update_by_index',
    row_index: rowIndex,
    data: data
  };

  try {
    UrlFetchApp.fetch(NETLIFY_SYNC_URL, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    });
  } catch (err) {
    Logger.log('Sync error: ' + err.message);
  }
}

// ============================================================
// DIRECTION 2: App → Google Sheet (via web app POST)
// ============================================================
function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);

    // Auth check
    if (body.secret !== SYNC_SECRET) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unauthorized' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    // Only process app-sourced updates
    if (body.source !== 'app') {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Invalid source' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var tabName = body.tab;
    var config = null;
    // Find config by tab name
    var configKeys = Object.keys(TAB_CONFIG);
    for (var i = 0; i < configKeys.length; i++) {
      if (configKeys[i] === tabName) {
        config = TAB_CONFIG[configKeys[i]];
        config._tabName = configKeys[i];
        break;
      }
    }
    if (!config) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Unknown tab: ' + tabName }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = ss.getSheetByName(config._tabName);
    if (!sheet) {
      return ContentService.createTextOutput(JSON.stringify({ error: 'Sheet not found: ' + config._tabName }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    var rowIndex = body.row_index;
    var data = body.data;
    var targetRow = config.startRow + rowIndex - 1;

    // Set syncing flag to prevent onEdit from re-triggering
    _syncing = true;

    // Write each field to its column
    var colKeys = Object.keys(config.columns);
    for (var j = 0; j < colKeys.length; j++) {
      var cLetter = colKeys[j];
      var cField = config.columns[cLetter];
      if (data.hasOwnProperty(cField)) {
        var cNum = letterToColumn(cLetter);
        var val = data[cField];

        // Format for sheet
        if (cField === 'gps_sold') {
          val = val ? 'X' : '';
        }

        sheet.getRange(targetRow, cNum).setValue(val);
      }
    }

    _syncing = false;
    SpreadsheetApp.flush();

    return ContentService.createTextOutput(JSON.stringify({ ok: true, row: targetRow }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {
    _syncing = false;
    return ContentService.createTextOutput(JSON.stringify({ error: err.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Allow GET for testing
function doGet(e) {
  return ContentService.createTextOutput(JSON.stringify({ status: 'ok', message: 'Car Factory Sheets Sync is running' }))
    .setMimeType(ContentService.MimeType.JSON);
}

// ============================================================
// Helpers
// ============================================================
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
