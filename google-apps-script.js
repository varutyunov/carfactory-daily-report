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
    },
    // Cell notes on these columns sync to Supabase fields
    cellNotes: {
      'I': 'expense_notes',       // joint expenses breakdown
      'J': 'vlad_expense_notes'   // vlad expenses breakdown
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
    },
    // Cell notes on these columns sync to Supabase fields
    cellNotes: {
      'C': 'expense_notes',    // expense breakdown
      'G': 'payment_notes'     // payment breakdown
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
  // Lock uses a timestamp; edits within 5 seconds of a doPost are skipped
  var lockTime = PropertiesService.getScriptProperties().getProperty('_syncLockTime');
  if (lockTime && (Date.now() - parseInt(lockTime)) < 5000) {
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

  // Also read cell notes if configured (e.g. expense breakdowns)
  if (config.cellNotes) {
    var noteKeys = Object.keys(config.cellNotes);
    for (var n = 0; n < noteKeys.length; n++) {
      var nLetter = noteKeys[n];
      var nField = config.cellNotes[nLetter];
      var nNum = letterToColumn(nLetter);
      var noteVal = sheet.getRange(row, nNum).getNote();
      data[nField] = noteVal || '';
    }
  }

  data.sync_source = 'sheets';
  data.updated_at = new Date().toISOString();

  // Write directly to Supabase — always use sort_order for reliable row matching
  try {
    supabasePatch(config.table, 'sort_order=eq.' + rowIndex, data);
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

    var action = body.action || 'update';

    // Set timestamp lock so onSheetEdit skips edits for 5 seconds
    PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));

    // ── ACTION: UPDATE (default) ──────────────────────────────
    if (action === 'update') {
      var rowIndex = body.row_index;
      var data = body.data;
      var targetRow = config.startRow + rowIndex - 1;
      _writeRowToSheet(sheet, config, targetRow, data);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, action: 'update', row: targetRow });
    }

    // ── ACTION: INSERT — add new row to sheet ─────────────────
    if (action === 'insert') {
      var data = body.data;
      // Find last used row in the synced columns and insert after it
      var lastRow = sheet.getLastRow();
      var insertRow = lastRow + 1;
      // If row_index is provided, calculate target position
      if (body.row_index) {
        insertRow = config.startRow + body.row_index - 1;
      }
      _writeRowToSheet(sheet, config, insertRow, data);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, action: 'insert', row: insertRow });
    }

    // ── ACTION: DELETE — clear row from sheet ─────────────────
    if (action === 'delete') {
      var rowIndex = body.row_index;
      var targetRow = config.startRow + rowIndex - 1;
      // Clear all synced columns in this row
      var colKeys = Object.keys(config.columns);
      for (var j = 0; j < colKeys.length; j++) {
        var cNum = letterToColumn(colKeys[j]);
        var cell = sheet.getRange(targetRow, cNum);
        cell.clearContent();
        cell.clearNote();
      }
      // Also clear cell notes columns
      if (config.cellNotes) {
        var noteKeys = Object.keys(config.cellNotes);
        for (var n = 0; n < noteKeys.length; n++) {
          var nNum = letterToColumn(noteKeys[n]);
          sheet.getRange(targetRow, nNum).clearNote();
        }
      }
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, action: 'delete', row: targetRow });
    }

    // ── ACTION: READ_ALL — read all rows for reconciliation ───
    if (action === 'read_all') {
      var rows = [];
      var lastRow = sheet.getLastRow();
      if (lastRow < config.startRow) {
        return jsonResponse({ ok: true, action: 'read_all', rows: [] });
      }
      for (var r = config.startRow; r <= lastRow; r++) {
        var rowData = {};
        var hasData = false;
        var colKeys = Object.keys(config.columns);
        for (var c = 0; c < colKeys.length; c++) {
          var cLetter = colKeys[c];
          var cField = config.columns[cLetter];
          var cNum = letterToColumn(cLetter);
          var val = sheet.getRange(r, cNum).getValue();
          if (cField === 'gps_sold') {
            rowData[cField] = (val === 'X' || val === 'x' || val === true);
          } else if (cField === 'car_name' || cField === 'car_desc') {
            rowData[cField] = String(val || '');
            if (val) hasData = true;
          } else if (cField === 'deal_num') {
            rowData[cField] = parseInt(val) || 0;
          } else {
            rowData[cField] = parseFloat(String(val).replace(/[$,]/g, '')) || 0;
            if (val) hasData = true;
          }
        }
        // Read cell notes
        if (config.cellNotes) {
          var noteKeys = Object.keys(config.cellNotes);
          for (var n = 0; n < noteKeys.length; n++) {
            var nLetter = noteKeys[n];
            var nField = config.cellNotes[nLetter];
            var nNum = letterToColumn(nLetter);
            rowData[nField] = sheet.getRange(r, nNum).getNote() || '';
          }
        }
        rowData._sheetRow = r;
        rowData._rowIndex = r - config.startRow + 1;
        if (hasData) rows.push(rowData);
      }
      return jsonResponse({ ok: true, action: 'read_all', rows: rows });
    }

    // ── ACTION: SETUP_TRIGGER — create the 5-min reconcile trigger ──
    if (action === 'setup_trigger') {
      setupReconcileTrigger();
      return jsonResponse({ ok: true, action: 'setup_trigger', message: 'Reconcile trigger created (every 5 min)' });
    }

    return jsonResponse({ error: 'Unknown action: ' + action });

  } catch (err) {
    return jsonResponse({ error: err.message });
  }
}

// Helper: write data fields + cell notes to a sheet row
function _writeRowToSheet(sheet, config, targetRow, data) {
  var colKeys = Object.keys(config.columns);
  for (var j = 0; j < colKeys.length; j++) {
    var cLetter = colKeys[j];
    var cField = config.columns[cLetter];
    if (data.hasOwnProperty(cField)) {
      var cNum = letterToColumn(cLetter);
      var val = data[cField];
      if (cField === 'gps_sold') val = val ? 'X' : '';
      sheet.getRange(targetRow, cNum).setValue(val);
    }
  }
  if (config.cellNotes) {
    var noteKeys = Object.keys(config.cellNotes);
    for (var n = 0; n < noteKeys.length; n++) {
      var nLetter = noteKeys[n];
      var nField = config.cellNotes[nLetter];
      if (data.hasOwnProperty(nField)) {
        var nNum = letterToColumn(nLetter);
        sheet.getRange(targetRow, nNum).setNote(data[nField] || '');
      }
    }
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

function supabasePost(table, data) {
  var url = SUPABASE_URL + '/rest/v1/' + table;
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    payload: JSON.stringify(data),
    muteHttpExceptions: true
  });
  return JSON.parse(res.getContentText());
}

function supabaseDelete(table, filter) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
  UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    },
    muteHttpExceptions: true
  });
}

// ============================================================
// FULL RECONCILIATION — run on time-based trigger (every 5 min)
// Matches by car_name/car_desc (NOT row position) so row
// deletions and insertions in the sheet don't scramble data.
// Google Sheet is the source of truth.
// ============================================================
function syncFullReconcile() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var tabNames = Object.keys(TAB_CONFIG);

  for (var t = 0; t < tabNames.length; t++) {
    var tabName = tabNames[t];
    var config = TAB_CONFIG[tabName];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) continue;

    var nameField = config.table === 'deals26' ? 'car_desc' : 'car_name';

    // Read all sheet rows, keyed by name
    var lastRow = sheet.getLastRow();
    var sheetByName = {};
    var sheetOrder = [];

    for (var r = config.startRow; r <= lastRow; r++) {
      var rowData = {};
      var hasData = false;
      var colKeys = Object.keys(config.columns);

      for (var c = 0; c < colKeys.length; c++) {
        var cLetter = colKeys[c];
        var cField = config.columns[cLetter];
        var cNum = letterToColumn(cLetter);
        var val = sheet.getRange(r, cNum).getValue();
        if (cField === 'gps_sold') {
          rowData[cField] = (val === 'X' || val === 'x' || val === true);
        } else if (cField === 'car_name' || cField === 'car_desc') {
          rowData[cField] = String(val || '');
          if (val) hasData = true;
        } else if (cField === 'deal_num') {
          rowData[cField] = parseInt(val) || 0;
        } else {
          rowData[cField] = parseFloat(String(val).replace(/[$,]/g, '')) || 0;
          if (val && parseFloat(String(val).replace(/[$,]/g, '')) !== 0) hasData = true;
        }
      }

      // Read cell notes
      if (config.cellNotes) {
        var noteKeys = Object.keys(config.cellNotes);
        for (var n = 0; n < noteKeys.length; n++) {
          var nLetter = noteKeys[n];
          var nField = config.cellNotes[nLetter];
          var nNum = letterToColumn(nLetter);
          rowData[nField] = sheet.getRange(r, nNum).getNote() || '';
        }
      }

      var rowName = rowData[nameField] || '';
      if (hasData && rowName) {
        sheetByName[rowName] = rowData;
        sheetOrder.push(rowName);
      }
    }

    // Read all Supabase rows, keyed by name
    var dbRows = supabaseGet(config.table, 'select=*&order=sort_order.asc,id.asc&limit=500');
    if (!Array.isArray(dbRows)) continue;

    var dbByName = {};
    for (var d = 0; d < dbRows.length; d++) {
      var dName = dbRows[d][nameField] || '';
      if (dName) dbByName[dName] = dbRows[d];
    }

    // Sheet → Supabase: add new cars, update changed values + sort_order
    for (var si = 0; si < sheetOrder.length; si++) {
      var sName = sheetOrder[si];
      var sRow = sheetByName[sName];
      var newSortOrder = si + 1;

      if (!dbByName[sName]) {
        // New in sheet → INSERT to Supabase
        sRow.sort_order = newSortOrder;
        sRow.sync_source = 'sheets';
        sRow.updated_at = new Date().toISOString();
        if (config.table === 'inventory_costs') {
          sRow.location = sRow.location || 'DeBary';
        }
        try { supabasePost(config.table, sRow); } catch (err) {
          Logger.log('Reconcile INSERT error: ' + err.message);
        }
      } else {
        // Exists in both — check for value/note/sort_order changes
        var dbRec = dbByName[sName];
        var patch = {};
        var changed = false;

        // Check sort_order
        if (dbRec.sort_order !== newSortOrder) {
          patch.sort_order = newSortOrder;
          changed = true;
        }

        // Check column values
        var colKeys2 = Object.keys(config.columns);
        for (var c2 = 0; c2 < colKeys2.length; c2++) {
          var cf = config.columns[colKeys2[c2]];
          if (cf === nameField) continue; // skip the name field itself
          var sheetVal = sRow[cf];
          var dbVal = dbRec[cf];
          // Compare numbers with tolerance, strings exact
          if (typeof sheetVal === 'number') {
            if (Math.abs((sheetVal || 0) - (parseFloat(dbVal) || 0)) > 0.01) {
              patch[cf] = sheetVal;
              changed = true;
            }
          } else if (typeof sheetVal === 'boolean') {
            if (sheetVal !== !!dbVal) {
              patch[cf] = sheetVal;
              changed = true;
            }
          } else {
            if ((sheetVal || '') !== (dbVal || '')) {
              patch[cf] = sheetVal;
              changed = true;
            }
          }
        }

        // Check cell notes
        if (config.cellNotes) {
          var noteKeys3 = Object.keys(config.cellNotes);
          for (var n3 = 0; n3 < noteKeys3.length; n3++) {
            var nf = config.cellNotes[noteKeys3[n3]];
            if ((sRow[nf] || '') !== (dbRec[nf] || '')) {
              patch[nf] = sRow[nf] || '';
              changed = true;
            }
          }
        }

        if (changed) {
          patch.sync_source = 'sheets';
          patch.updated_at = new Date().toISOString();
          try { supabasePatch(config.table, 'id=eq.' + dbRec.id, patch); } catch (err) {
            Logger.log('Reconcile UPDATE error: ' + err.message);
          }
        }
      }
    }

    // Supabase → delete: cars in DB but not in sheet anymore
    var dbNames = Object.keys(dbByName);
    for (var dk = 0; dk < dbNames.length; dk++) {
      var dkName = dbNames[dk];
      if (!sheetByName[dkName]) {
        try { supabaseDelete(config.table, 'id=eq.' + dbByName[dkName].id); } catch (err) {
          Logger.log('Reconcile DELETE error: ' + err.message);
        }
      }
    }
  }
}

// ============================================================
// TRIGGER SETUP — run once to create the 5-min reconcile trigger
// ============================================================
function setupReconcileTrigger() {
  // Remove any existing reconcile triggers
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncFullReconcile') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }
  // Create new 5-minute trigger
  ScriptApp.newTrigger('syncFullReconcile')
    .timeBased()
    .everyMinutes(5)
    .create();
  Logger.log('Created syncFullReconcile trigger (every 5 minutes)');
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
