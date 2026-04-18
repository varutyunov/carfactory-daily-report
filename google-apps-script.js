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

  // Only set updated_at for tables that have it (inventory_costs does, deals26 doesn't)
  if (config.table === 'inventory_costs') {
    data.updated_at = new Date().toISOString();
  }

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

    // ── ACTION: RUN_SYNC — manually trigger full reconciliation ──
    if (action === 'run_sync') {
      syncFullReconcile();
      return jsonResponse({ ok: true, action: 'run_sync', message: 'Full reconciliation completed' });
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
      var cell = sheet.getRange(targetRow, cNum);
      // Column G (payments) in Deals26 — skip writing if zero, leave empty for manual entry
      if (config.table === 'deals26' && cField === 'payments' && (val === 0 || val === '0' || !val)) {
        continue;
      }
      // Column F (owed) in Deals26 is a formula: =E-A-C-D-H (money - cost - expenses - taxes - dealer_fee)
      if (config.table === 'deals26' && cField === 'owed') {
        var r = targetRow;
        cell.setFormula('=E' + r + '-A' + r + '-C' + r + '-D' + r + '-H' + r);
        cell.setNumberFormat('$#,##0');
      } else {
        cell.setValue(val);
        // Format currency columns as $#,##0
        if (cField !== 'car_desc' && cField !== 'car_name' && cField !== 'deal_num' && cField !== 'gps_sold' && typeof val === 'number') {
          cell.setNumberFormat('$#,##0');
        }
      }
      // Color column B (car_desc) based on car color in description
      if (cField === 'car_desc' || cField === 'car_name') {
        _applyCarColor(sheet, targetRow, cNum, String(val));
      }
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
  // Week separator: thick top border when deal_num = 1 (Deals26 only)
  if (config.table === 'deals26' && data.hasOwnProperty('deal_num') && parseInt(data.deal_num) === 1) {
    var allColKeys = Object.keys(config.columns);
    var allColNums = allColKeys.map(function(l){ return letterToColumn(l); });
    var minC = Math.min.apply(null, allColNums);
    var maxC = Math.max.apply(null, allColNums);
    var rowRange = sheet.getRange(targetRow, minC, 1, maxC - minC + 1);
    rowRange.setBorder(true, null, null, null, null, null, '#000000', SpreadsheetApp.BorderStyle.SOLID_THICK);
  }
}

// Apply car color as cell background on column B
function _applyCarColor(sheet, row, col, desc) {
  var COLOR_MAP = {
    'black':     '#000000',
    'white':     '#ffffff',
    'grey':      '#999999',
    'gray':      '#999999',
    'silver':    '#c0c0c0',
    'blue':      '#4a86c8',
    'red':       '#cc0000',
    'green':     '#38761d',
    'gold':      '#bf9000',
    'tan':       '#d2b48c',
    'maroon':    '#800000',
    'brown':     '#783f04',
    'orange':    '#e69138',
    'yellow':    '#ffd966',
    'purple':    '#674ea7',
    'beige':     '#f5f0e1',
    'burgundy':  '#800020',
    'champagne': '#f7e7ce',
    'nardo':     '#767b7e',
    'charcoal':  '#464646',
    'bronze':    '#cd7f32'
  };
  // Light text for dark backgrounds
  var DARK_COLORS = ['black','maroon','brown','burgundy','charcoal','green','red','purple','blue','nardo'];

  var words = desc.toLowerCase().split(/\s+/);
  var bgColor = null;
  var colorName = null;
  for (var i = 0; i < words.length; i++) {
    if (COLOR_MAP[words[i]]) {
      bgColor = COLOR_MAP[words[i]];
      colorName = words[i];
      break;
    }
  }
  var cell = sheet.getRange(row, col);
  if (bgColor) {
    cell.setBackground(bgColor);
    cell.setFontColor(DARK_COLORS.indexOf(colorName) !== -1 ? '#ffffff' : '#000000');
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
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('supabaseGet ERROR ' + code + ' ' + table + '?' + query + ' → ' + res.getContentText().substring(0, 200));
  }
  return JSON.parse(res.getContentText());
}

function supabasePatch(table, filter, data) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
  var res = UrlFetchApp.fetch(url, {
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
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('supabasePatch ERROR ' + code + ' ' + table + '?' + filter + ' → ' + res.getContentText().substring(0, 200));
  }
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
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('supabasePost ERROR ' + code + ' ' + table + ' → ' + res.getContentText().substring(0, 200));
    Logger.log('supabasePost payload: ' + JSON.stringify(data).substring(0, 300));
  }
  return JSON.parse(res.getContentText());
}

function supabaseDelete(table, filter) {
  var url = SUPABASE_URL + '/rest/v1/' + table + '?' + filter;
  var res = UrlFetchApp.fetch(url, {
    method: 'delete',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY
    },
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('supabaseDelete ERROR ' + code + ' ' + table + '?' + filter + ' → ' + res.getContentText().substring(0, 200));
  }
}

// ============================================================
// FULL RECONCILIATION — run on time-based trigger (every 5 min)
// Matches by car_name/car_desc (NOT row position) so row
// deletions and insertions in the sheet don't scramble data.
// Google Sheet is the source of truth.
// Uses batch reads (getValues/getNotes) for speed.
// ============================================================
function syncFullReconcile() {
  Logger.log('syncFullReconcile START');
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var tabNames = Object.keys(TAB_CONFIG);

  for (var t = 0; t < tabNames.length; t++) {
    var tabName = tabNames[t];
    var config = TAB_CONFIG[tabName];
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) continue;

    var nameField = config.table === 'deals26' ? 'car_desc' : 'car_name';
    var lastRow = sheet.getLastRow();
    if (lastRow < config.startRow) continue;
    var numRows = lastRow - config.startRow + 1;

    // Determine column range for batch read
    var colKeys = Object.keys(config.columns);
    var colNums = colKeys.map(function(l){ return letterToColumn(l); });
    var minCol = Math.min.apply(null, colNums);
    var maxCol = Math.max.apply(null, colNums);
    var numCols = maxCol - minCol + 1;

    // Batch read all values and notes in one call each
    var dataRange = sheet.getRange(config.startRow, minCol, numRows, numCols);
    var allValues = dataRange.getValues();

    // Batch read notes for cellNotes columns
    var allNotes = {};
    if (config.cellNotes) {
      var noteKeys = Object.keys(config.cellNotes);
      for (var nk = 0; nk < noteKeys.length; nk++) {
        var nCol = letterToColumn(noteKeys[nk]);
        var noteRange = sheet.getRange(config.startRow, nCol, numRows, 1);
        allNotes[noteKeys[nk]] = noteRange.getNotes(); // 2D array
      }
    }

    // Parse sheet rows keyed by name
    var sheetByName = {};
    var sheetOrder = [];

    for (var r = 0; r < numRows; r++) {
      var rowData = {};
      var hasData = false;

      for (var c = 0; c < colKeys.length; c++) {
        var cLetter = colKeys[c];
        var cField = config.columns[cLetter];
        var cIdx = letterToColumn(cLetter) - minCol; // index into allValues row
        var val = allValues[r][cIdx];

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

      // Read cell notes from batch
      if (config.cellNotes) {
        var nKeys = Object.keys(config.cellNotes);
        for (var n = 0; n < nKeys.length; n++) {
          var nField = config.cellNotes[nKeys[n]];
          rowData[nField] = (allNotes[nKeys[n]] && allNotes[nKeys[n]][r]) ? allNotes[nKeys[n]][r][0] || '' : '';
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
        if (config.table === 'inventory_costs') {
          sRow.updated_at = new Date().toISOString();
          sRow.location = sRow.location || 'DeBary';
        }
        try {
          Logger.log('Reconcile INSERT: ' + tabName + ' → "' + sName + '" sort=' + newSortOrder);
          supabasePost(config.table, sRow);
        } catch (err) {
          Logger.log('Reconcile INSERT error for "' + sName + '": ' + err.message);
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
          if (config.table === 'inventory_costs') {
            patch.updated_at = new Date().toISOString();
          }
          try {
            Logger.log('Reconcile UPDATE: ' + tabName + ' → "' + sName + '" id=' + dbRec.id + ' fields=' + Object.keys(patch).join(','));
            supabasePatch(config.table, 'id=eq.' + dbRec.id, patch);
          } catch (err) {
            Logger.log('Reconcile UPDATE error for "' + sName + '": ' + err.message);
          }
        }
      }
    }

    // Supabase → delete: cars in DB but not in sheet anymore
    var dbNames = Object.keys(dbByName);
    for (var dk = 0; dk < dbNames.length; dk++) {
      var dkName = dbNames[dk];
      if (!sheetByName[dkName]) {
        try {
          Logger.log('Reconcile DELETE: ' + tabName + ' → "' + dkName + '" id=' + dbByName[dkName].id);
          supabaseDelete(config.table, 'id=eq.' + dbByName[dkName].id);
        } catch (err) {
          Logger.log('Reconcile DELETE error for "' + dkName + '": ' + err.message);
        }
      }
    }

    Logger.log('Reconcile ' + tabName + ': sheet=' + sheetOrder.length + ' rows, db=' + dbRows.length + ' rows');
  }
  Logger.log('syncFullReconcile DONE');
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
