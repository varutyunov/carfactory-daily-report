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

// Spreadsheet IDs — one per location
var SPREADSHEET_IDS = {
  'DeBary': '1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE',
  'DeLand': '1pNF6h9AX5MQsNoT-UxvrAOaT-7lulvGiWd_oTFkqyzM'
};
// Backward compat
var SPREADSHEET_ID = SPREADSHEET_IDS['DeBary'];

// Supabase config
var SUPABASE_URL = 'https://hphlouzqlimainczuqyc.supabase.co';
var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo';

// Tab config per location — maps sheet tab names to Supabase tables + column layouts
var LOCATION_CONFIGS = {
  'DeBary': {
    'Inventory': {
      table: 'inventory_costs',
      startRow: 20,
      columns: { 'G': 'purchase_cost', 'H': 'car_name', 'I': 'joint_expenses', 'J': 'vlad_expenses' },
      cellNotes: { 'I': 'expense_notes', 'J': 'vlad_expense_notes' }
    },
    'Deals26': {
      table: 'deals26',
      startRow: 2,
      columns: { 'A': 'cost', 'B': 'car_desc', 'C': 'expenses', 'D': 'taxes', 'E': 'money', 'F': 'owed', 'G': 'payments', 'H': 'dealer_fee', 'I': 'manny', 'J': 'deal_num', 'K': 'gps_sold' },
      cellNotes: { 'C': 'expense_notes', 'G': 'payment_notes' }
    }
  },
  'DeLand': {
    'Inventory': {
      table: 'inventory_costs',
      startRow: 17,
      columns: { 'G': 'purchase_cost', 'H': 'car_name', 'I': 'joint_expenses', 'J': 'vlad_expenses' },
      cellNotes: { 'I': 'expense_notes', 'J': 'vlad_expense_notes' }
    },
    'Deals26': {
      table: 'deals26',
      startRow: 2,
      columns: { 'A': 'cost', 'B': 'car_desc', 'C': 'expenses', 'D': 'taxes', 'E': 'money', 'F': 'owed', 'G': 'payments', 'H': 'dealer_fee', 'I': 'manny', 'J': 'deal_num', 'K': 'gps_sold' },
      cellNotes: { 'C': 'expense_notes', 'G': 'payment_notes' }
    }
  }
};

// Default TAB_CONFIG for backward compat (DeBary)
var TAB_CONFIG = LOCATION_CONFIGS['DeBary'];

// Helper: get config for a location
function _getConfig(location) {
  return LOCATION_CONFIGS[location] || LOCATION_CONFIGS['DeBary'];
}
function _getSpreadsheetId(location) {
  return SPREADSHEET_IDS[location] || SPREADSHEET_IDS['DeBary'];
}

// ============================================================
// DIRECTION 1: Google Sheet → Supabase (on cell edit)
// ============================================================
function onSheetEdit(e) {
  if (!e || !e.range) return;

  var sheet = e.range.getSheet();
  var tabName = sheet.getName();

  // Determine which location this spreadsheet belongs to
  var ssId = e.source ? e.source.getId() : '';
  var loc = 'DeBary';
  if (ssId === SPREADSHEET_IDS['DeLand']) loc = 'DeLand';

  // Profit26 tab has a non-column-based layout — handled separately.
  // Any edit triggers a full sheet re-read (captures formula cascades).
  if (tabName === 'Profit26') {
    var _profitLock = PropertiesService.getScriptProperties().getProperty('_syncLockTime');
    if (_profitLock && (Date.now() - parseInt(_profitLock)) < 5000) return;
    try { _syncProfitFromSheet(loc); } catch (e2) { Logger.log('onSheetEdit Profit26 sync err: ' + e2.message); }
    return;
  }

  var locConfig = _getConfig(loc);
  var config = locConfig[tabName];
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

  // Write directly to Supabase — filter by sort_order + location for reliable row matching
  try {
    supabasePatch(config.table, 'sort_order=eq.' + rowIndex + '&location=eq.' + encodeURIComponent(loc), data);
  } catch (err) {
    Logger.log('Sheet→Supabase sync error (' + loc + '): ' + err.message);
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
    var location = body.location || 'DeBary';
    var action = body.action || 'update';

    // ── Profit26 actions — handled before tab config lookup ──
    if (action === 'read_profit' || action === 'update_profit') {
      return _handleProfitAction(action, location, body.data || {});
    }
    if (action === 'sync_profit') {
      // Backfill / on-demand sync — reads full Profit26 sheet and upserts to Supabase
      var n = _syncProfitFromSheet(location);
      return jsonResponse({ ok: true, action: 'sync_profit', location: location, rowsUpserted: n });
    }

    var locConfig = _getConfig(location);
    var config = locConfig[tabName];
    if (!config) {
      return jsonResponse({ error: 'Unknown tab: ' + tabName });
    }

    var ss = SpreadsheetApp.openById(_getSpreadsheetId(location));
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) {
      return jsonResponse({ error: 'Sheet tab not found: ' + tabName });
    }

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
      var lastRow = sheet.getLastRow();

      // For inventory_costs tab: insert ABOVE the Total row so new cars
      // (including ones transferred between locations) land cleanly at the
      // bottom of the car list and keep the Total row's SUM formula intact.
      // Sheet's built-in insertRowBefore() auto-updates all formula ranges
      // below the insertion point, so the Total row's =sum(...) expands
      // correctly to include the new row.
      if (config.table === 'inventory_costs') {
        // Find the name column letter from config (car_name → usually 'H')
        var nameColL = null;
        var kkeys = Object.keys(config.columns);
        for (var kk = 0; kk < kkeys.length; kk++) {
          if (config.columns[kkeys[kk]] === 'car_name') { nameColL = kkeys[kk]; break; }
        }
        var totalRowIdx = -1;
        if (nameColL) {
          var ncol = letterToColumn(nameColL);
          for (var rr = lastRow; rr >= config.startRow; rr--) {
            var nv = String(sheet.getRange(rr, ncol).getValue() || '').trim();
            if (nv.toLowerCase() === 'total') { totalRowIdx = rr; break; }
          }
        }
        if (totalRowIdx > 0) {
          // Insert a blank row BEFORE Total (shifts Total down by one).
          // This inherits formatting from the row above (a real car row),
          // so the new row gets normal formatting instead of Total-row style.
          sheet.insertRowBefore(totalRowIdx);
          _writeRowToSheet(sheet, config, totalRowIdx, data);
          SpreadsheetApp.flush();
          return jsonResponse({ ok: true, action: 'insert', row: totalRowIdx, method: 'insertBeforeTotal' });
        }
        // No Total row found — fall through to default append
      }

      // Default: append at bottom (or at row_index if provided)
      var insertRow = lastRow + 1;
      if (body.row_index) {
        insertRow = config.startRow + body.row_index - 1;
      }
      _writeRowToSheet(sheet, config, insertRow, data);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, action: 'insert', row: insertRow });
    }

    // ── ACTION: DELETE — remove row entirely (no orphan formatting) ─
    if (action === 'delete') {
      var rowIndex = body.row_index;
      var targetRow = config.startRow + rowIndex - 1;
      // Find the name-column letter from the config so we can check for 'Total'
      // (inventory_costs uses car_name in col H; deals26 uses car_desc in col B)
      var nameField = (config.table === 'deals26') ? 'car_desc' : 'car_name';
      var nameColLetter = null;
      var cKeys = Object.keys(config.columns);
      for (var ck = 0; ck < cKeys.length; ck++) {
        if (config.columns[cKeys[ck]] === nameField) { nameColLetter = cKeys[ck]; break; }
      }
      // Guard: never delete the Total row (detected by nameField value === 'Total')
      var nameVal = '';
      if (nameColLetter) {
        nameVal = String(sheet.getRange(targetRow, letterToColumn(nameColLetter)).getValue() || '').trim();
      }
      if (nameVal.toLowerCase() === 'total') {
        return jsonResponse({ ok: false, error: 'refused_delete_total_row', row: targetRow });
      }
      // Full row delete — removes text + formatting (no orphan colored blanks)
      sheet.deleteRow(targetRow);
      SpreadsheetApp.flush();
      return jsonResponse({ ok: true, action: 'delete', row: targetRow, method: 'deleteRow' });
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

    // ── ACTION: FIX_TOTAL — fix Total row formatting ──
    if (action === 'fix_total') {
      fixTotalRow();
      return jsonResponse({ ok: true, action: 'fix_total', message: 'Total row fixed' });
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
      // Column F (owed) in Deals26 — copy formula from the row above
      if (config.table === 'deals26' && cField === 'owed') {
        var srcRow = targetRow - 1;
        if (srcRow >= config.startRow) {
          var srcCell = sheet.getRange(srcRow, cNum);
          var srcFormula = srcCell.getFormula();
          if (srcFormula) {
            srcCell.copyTo(cell);
          } else {
            // Fallback if no formula above
            var r = targetRow;
            cell.setFormula('=E' + r + '-A' + r + '-C' + r + '-D' + r + '-H' + r);
          }
        }
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
      // Column K (gps_sold) — red background = not registered yet
      if (cField === 'gps_sold') {
        cell.setBackground('#ff0000');
        cell.setFontColor('#ffffff');
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
  var locations = Object.keys(SPREADSHEET_IDS);

  for (var li = 0; li < locations.length; li++) {
    var loc = locations[li];
    var ssId = SPREADSHEET_IDS[loc];
    var locConfig = _getConfig(loc);
    var ss;
    try { ss = SpreadsheetApp.openById(ssId); } catch(e) { Logger.log('Cannot open ' + loc + ' sheet: ' + e.message); continue; }
    var tabNames = Object.keys(locConfig);

  for (var t = 0; t < tabNames.length; t++) {
    var tabName = tabNames[t];
    var config = locConfig[tabName];
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

    // Read Supabase rows for this location, keyed by name
    var locFilter = 'location=eq.' + encodeURIComponent(loc) + '&';
    var dbRows = supabaseGet(config.table, locFilter + 'select=*&order=sort_order.asc,id.asc&limit=500');
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
        sRow.location = loc;
        if (config.table === 'inventory_costs') {
          sRow.updated_at = new Date().toISOString();
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

    Logger.log('Reconcile ' + loc + '/' + tabName + ': sheet=' + sheetOrder.length + ' rows, db=' + dbRows.length + ' rows');
  } // end tab loop

  // Profit26 — full sheet → Supabase mirror
  try { _syncProfitFromSheet(loc); } catch (pe) { Logger.log('Reconcile Profit26 error for ' + loc + ': ' + pe.message); }

  } // end location loop
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


// ============================================================
// PROFIT26 TAB — Read/Write
// ============================================================
function _handleProfitAction(action, location, data) {
  var ssId = _getSpreadsheetId(location);
  var ss = SpreadsheetApp.openById(ssId);
  var sheet = ss.getSheetByName('Profit26');
  if (!sheet) return jsonResponse({ error: 'Profit26 tab not found' });

  if (action === 'read_profit') {
    // Layout: 4 months across, each month = 3 cols (label, value, spacer), starting at col D (4)
    // 3 blocks of 4 months stacked: rows 1-22 (Jan-Apr), rows 24-45 (May-Aug), rows 47-68 (Sep-Dec)
    // Row 1 of each block = month name header, rows 2-22 = bill items
    var MONTHS_PER_ROW = 4;
    var COLS_PER_MONTH = 3; // label, value, spacer
    var START_COL = 4; // column D
    var BLOCK_ROWS = 22; // header + 21 data rows
    var BLOCK_GAP = 1;   // blank row between blocks
    var monthNames = ['Jan','Feb','March','April','May','June','July','August','September','October','November','December'];

    // Find the start row — look for "Jan" in col D
    var startRow = 1;
    for (var sr = 1; sr <= 20; sr++) {
      var cellVal = String(sheet.getRange(sr, START_COL).getValue()).trim();
      if (cellVal === 'Jan' || cellVal === 'January') { startRow = sr; break; }
    }

    var months = [];
    for (var block = 0; block < 3; block++) {
      var blockStart = startRow + (block * (BLOCK_ROWS + BLOCK_GAP));
      for (var m = 0; m < MONTHS_PER_ROW; m++) {
        var labelCol = START_COL + (m * COLS_PER_MONTH);
        var valueCol = labelCol + 1;
        var monthIdx = block * MONTHS_PER_ROW + m;
        if (monthIdx >= 12) break;

        var monthData = { name: monthNames[monthIdx], items: [] };
        for (var row = 1; row < BLOCK_ROWS; row++) {
          var r = blockStart + row;
          var labelCell = sheet.getRange(r, labelCol);
          var valueCell = sheet.getRange(r, valueCol);
          var label = String(labelCell.getValue()).trim();
          var rawVal = valueCell.getValue();
          var formula = valueCell.getFormula() || '';
          var note = valueCell.getNote() || '';
          var labelNote = labelCell.getNote() || '';
          var displayValue = valueCell.getDisplayValue() || '';
          var val = 0;
          if (rawVal !== '' && rawVal !== null) {
            val = parseFloat(String(rawVal).replace(/[$,]/g, '')) || 0;
          }
          if (label || val || note || labelNote || formula) {
            monthData.items.push({
              label: label,
              value: val,
              displayValue: displayValue,
              // Keep backward-compatible: note = valueNote || labelNote (pre-v30 behavior).
              // New fields valueNote + labelNote expose them separately.
              note: note || labelNote,
              valueNote: note,
              labelNote: labelNote,
              formula: formula,
              isFormula: !!formula,
              row: r,
              col: valueCol
            });
          }
        }
        months.push(monthData);
      }
    }

    // Read yearly summary table — search after the 3 blocks
    var summarySearchStart = startRow + (3 * (BLOCK_ROWS + BLOCK_GAP));
    var summary = [];
    for (var ss2 = summarySearchStart; ss2 < summarySearchStart + 15; ss2++) {
      var h = String(sheet.getRange(ss2, START_COL).getValue()).trim().toLowerCase();
      if (h === 'month') {
        for (var si = 1; si <= 14; si++) {
          var sRow = ss2 + si;
          var sMonth = String(sheet.getRange(sRow, START_COL).getValue()).trim();
          if (!sMonth) break;
          var sProfit = parseFloat(String(sheet.getRange(sRow, START_COL + 1).getValue()).replace(/[$,]/g, '')) || 0;
          var sAvg = parseFloat(String(sheet.getRange(sRow, START_COL + 2).getValue()).replace(/[$,]/g, '')) || 0;
          summary.push({ month: sMonth, profit: sProfit, avg: sAvg });
        }
        break;
      }
    }

    return jsonResponse({ ok: true, action: 'read_profit', months: months, summary: summary });
  }

  if (action === 'update_profit') {
    var row = parseInt(data.row) || 0;
    var col = parseInt(data.col) || 0;
    var val = data.value;
    var note = data.note;

    if (row > 0 && col > 0) {
      var cell = sheet.getRange(row, col);
      // Protect formula cells — refuse to overwrite value; notes still allowed
      var existingFormula = cell.getFormula() || '';
      if (val !== undefined && val !== null && existingFormula) {
        return jsonResponse({ ok: false, error: 'formula_protected', formula: existingFormula, row: row, col: col });
      }
      PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
      if (val !== undefined && val !== null) {
        var numVal = parseFloat(String(val).replace(/[$,]/g, '')) || 0;
        cell.setValue(numVal);
        cell.setNumberFormat('$#,##0');
      }
      if (note !== undefined) {
        cell.setNote(note || '');
      }
    }

    return jsonResponse({ ok: true, action: 'update_profit', row: row, col: col });
  }

  if (action === 'profit_append_entry') {
    // Append one entry to Payments or Cash Sales formula + note for a given month.
    // Inputs: data.{month_idx: 0..11, row_type: 'payments'|'cash_sales',
    //               amount: number (can be negative), description: text}
    var monthIdxA = parseInt(data.month_idx);
    var rowTypeA = String(data.row_type || '');
    var amountA = parseFloat(data.amount);
    var descA = String(data.description || '').trim();
    if (isNaN(monthIdxA) || monthIdxA < 0 || monthIdxA > 11) {
      return jsonResponse({ ok: false, error: 'invalid_month_idx' });
    }
    if (isNaN(amountA)) {
      return jsonResponse({ ok: false, error: 'invalid_amount' });
    }
    if (rowTypeA !== 'payments' && rowTypeA !== 'cash_sales') {
      return jsonResponse({ ok: false, error: 'invalid_row_type' });
    }

    // Find startRow and compute target cell
    var START_COL_A = 4;
    var startRowA = 1;
    for (var srA = 1; srA <= 20; srA++) {
      var cvA = String(sheet.getRange(srA, START_COL_A).getValue()).trim();
      if (cvA === 'Jan' || cvA === 'January') { startRowA = srA; break; }
    }
    var BLOCK_ROWS_A = 22;
    var BLOCK_GAP_A = 1;
    var blockA = Math.floor(monthIdxA / 4);
    var mInBlockA = monthIdxA % 4;
    var blockStartInnerA = blockA * (BLOCK_ROWS_A + BLOCK_GAP_A);
    var rowOffsetA = rowTypeA === 'payments' ? 20 : 21;
    var targetRowA = startRowA + blockStartInnerA + rowOffsetA;
    var targetColA = START_COL_A + mInBlockA * 3 + 1;

    var cellA = sheet.getRange(targetRowA, targetColA);
    var existingFormulaA = cellA.getFormula() || '';
    var existingValueA = cellA.getValue();
    var existingNoteA = cellA.getNote() || '';

    // Build new formula — append +amount or -|amount|
    var signStrA = amountA < 0 ? ('-' + String(Math.abs(amountA))) : ('+' + String(amountA));
    var newFormulaA;
    if (existingFormulaA) {
      newFormulaA = existingFormulaA + signStrA;
    } else if (existingValueA !== '' && existingValueA !== null && existingValueA !== 0) {
      var existingNumA = parseFloat(String(existingValueA).replace(/[$,]/g, '')) || 0;
      newFormulaA = '=' + String(existingNumA) + signStrA;
    } else {
      // Empty or zero cell — start fresh (no leading +)
      newFormulaA = '=' + (amountA < 0 ? ('-' + String(Math.abs(amountA))) : String(amountA));
    }

    // Build new note — append a new line
    var noteEntryA = (amountA < 0 ? '-' + String(Math.abs(amountA)) : String(amountA)) + (descA ? ' ' + descA : '');
    var newNoteA = existingNoteA ? (existingNoteA.replace(/\s+$/,'') + '\n' + noteEntryA) : noteEntryA;

    PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
    cellA.setFormula(newFormulaA);
    cellA.setNumberFormat('$#,##0');
    cellA.setNote(newNoteA);

    return jsonResponse({
      ok: true, action: 'profit_append_entry',
      location: location, month_idx: monthIdxA, row_type: rowTypeA,
      amount: amountA, description: descA,
      row: targetRowA, col: targetColA,
      new_value: cellA.getValue(),
      new_formula: newFormulaA
    });
  }

  if (action === 'update_profit_formula') {
    // Carve-out for Payments / Cash Sales cells — explicitly writes a formula
    // and matching note in lockstep. Callers should only route editable
    // formula rows (Payments, Cash Sales) here; Core Bills / Total Bills etc.
    // stay protected by using update_profit.
    var rowF = parseInt(data.row) || 0;
    var colF = parseInt(data.col) || 0;
    var formula = String(data.formula || '');
    var noteF = data.note !== undefined ? String(data.note) : null;
    if (rowF <= 0 || colF <= 0 || !formula) {
      return jsonResponse({ ok: false, error: 'invalid_params' });
    }
    // Require formula to start with = (PostgREST/app contract — prevents
    // stray literal values sneaking in through this endpoint)
    if (formula.charAt(0) !== '=') formula = '=' + formula;
    PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
    var cellF = sheet.getRange(rowF, colF);
    cellF.setFormula(formula);
    cellF.setNumberFormat('$#,##0');
    if (noteF !== null) cellF.setNote(noteF);
    var newVal = cellF.getValue();
    return jsonResponse({
      ok: true, action: 'update_profit_formula',
      row: rowF, col: colF, value: newVal, formula: formula
    });
  }

  return jsonResponse({ error: 'Unknown profit action: ' + action });
}

// ============================================================
// PROFIT26 MIRROR SYNC — sheet → Supabase (profit + profit_summary)
// Reads the full sheet in batch and upserts. Called from onSheetEdit
// (any Profit26 edit) and from syncFullReconcile (periodic).
// ============================================================
function _syncProfitFromSheet(location) {
  var ssId = _getSpreadsheetId(location);
  var ss;
  try { ss = SpreadsheetApp.openById(ssId); }
  catch (e) { Logger.log('_syncProfitFromSheet: cannot open ' + location + ': ' + e.message); return 0; }
  var sheet = ss.getSheetByName('Profit26');
  if (!sheet) { Logger.log('_syncProfitFromSheet: Profit26 tab not found in ' + location); return 0; }

  var START_COL = 4;
  // Find start row — look for 'Jan' in col D
  var startRow = 1;
  for (var sr = 1; sr <= 20; sr++) {
    var cellVal = String(sheet.getRange(sr, START_COL).getValue()).trim();
    if (cellVal === 'Jan' || cellVal === 'January') { startRow = sr; break; }
  }

  var MONTHS_PER_ROW = 4;
  var COLS_PER_MONTH = 3;
  var BLOCK_ROWS = 22;
  var BLOCK_GAP = 1;
  var totalRows = 3 * BLOCK_ROWS + 2 * BLOCK_GAP;
  var totalCols = MONTHS_PER_ROW * COLS_PER_MONTH;

  // Batch reads — one API call each
  var range = sheet.getRange(startRow, START_COL, totalRows, totalCols);
  var values = range.getValues();
  var formulas = range.getFormulas();
  var notes = range.getNotes();
  var displayValues = range.getDisplayValues();

  // Build upsert payload
  var rows = [];
  var nowIso = new Date().toISOString();
  for (var block = 0; block < 3; block++) {
    var blockStartInner = block * (BLOCK_ROWS + BLOCK_GAP);
    for (var m = 0; m < MONTHS_PER_ROW; m++) {
      var labelColInner = m * COLS_PER_MONTH;
      var valueColInner = labelColInner + 1;
      var monthIdx = block * MONTHS_PER_ROW + m;
      if (monthIdx >= 12) break;
      for (var rin = 1; rin < BLOCK_ROWS; rin++) {
        var rInner = blockStartInner + rin;
        if (rInner >= totalRows) continue;
        var label = String(values[rInner][labelColInner] || '').trim();
        var rawVal = values[rInner][valueColInner];
        var formula = formulas[rInner][valueColInner] || '';
        var note = notes[rInner][valueColInner] || '';
        var labelNote = notes[rInner][labelColInner] || '';
        var displayValue = displayValues[rInner][valueColInner] || '';
        var val = 0;
        if (rawVal !== '' && rawVal !== null) {
          val = parseFloat(String(rawVal).replace(/[$,]/g, '')) || 0;
        }
        if (label || val || note || labelNote || formula) {
          rows.push({
            location: location,
            sheet_row: startRow + rInner,
            sheet_col: START_COL + valueColInner,
            month_idx: monthIdx,
            item_idx: rin - 1,
            label: label,
            value: val,
            display_value: displayValue,
            formula: formula,
            is_formula: !!formula,
            note: note,
            label_note: labelNote,
            updated_at: nowIso
          });
        }
      }
    }
  }

  try {
    _supabaseUpsert('profit', rows, 'location,sheet_row,sheet_col');
    Logger.log('_syncProfitFromSheet ' + location + ': upserted ' + rows.length + ' cells');
  } catch (e) {
    Logger.log('_syncProfitFromSheet ' + location + ' profit upsert error: ' + e.message);
  }

  // Yearly summary section — search for 'Month' header after the 3 blocks
  var summarySearchStart = startRow + 3 * (BLOCK_ROWS + BLOCK_GAP);
  var summaryRows = [];
  for (var ss2 = summarySearchStart; ss2 < summarySearchStart + 15; ss2++) {
    var h = String(sheet.getRange(ss2, START_COL).getValue()).trim().toLowerCase();
    if (h === 'month') {
      for (var si = 1; si <= 14; si++) {
        var sRow = ss2 + si;
        var sMonth = String(sheet.getRange(sRow, START_COL).getValue()).trim();
        if (!sMonth) break;
        var sProfit = parseFloat(String(sheet.getRange(sRow, START_COL + 1).getValue()).replace(/[$,]/g, '')) || 0;
        var sAvg = parseFloat(String(sheet.getRange(sRow, START_COL + 2).getValue()).replace(/[$,]/g, '')) || 0;
        summaryRows.push({
          location: location,
          sheet_row: sRow,
          month: sMonth,
          profit: sProfit,
          avg: sAvg,
          sort_order: si,
          updated_at: nowIso
        });
      }
      break;
    }
  }

  if (summaryRows.length) {
    try {
      _supabaseUpsert('profit_summary', summaryRows, 'location,sheet_row');
      Logger.log('_syncProfitFromSheet ' + location + ': upserted ' + summaryRows.length + ' summary rows');
    } catch (e) {
      Logger.log('_syncProfitFromSheet ' + location + ' summary upsert error: ' + e.message);
    }
  }

  return rows.length + summaryRows.length;
}

// Bulk upsert helper — uses on_conflict for merge-duplicates
function _supabaseUpsert(table, rows, onConflict) {
  if (!rows || !rows.length) return;
  var url = SUPABASE_URL + '/rest/v1/' + table + '?on_conflict=' + encodeURIComponent(onConflict);
  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    headers: {
      'apikey': SUPABASE_KEY,
      'Authorization': 'Bearer ' + SUPABASE_KEY,
      'Content-Type': 'application/json',
      'Prefer': 'resolution=merge-duplicates,return=minimal'
    },
    payload: JSON.stringify(rows),
    muteHttpExceptions: true
  });
  var code = res.getResponseCode();
  if (code < 200 || code >= 300) {
    Logger.log('_supabaseUpsert ERROR ' + code + ' ' + table + ' → ' + res.getContentText().substring(0, 300));
    throw new Error('Upsert failed: ' + code);
  }
}

function fixTotalRow() {
  var ss = SpreadsheetApp.openById('1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE');
  var sheet = ss.getSheetByName('Inventory');
  
  // Row 136 = Ram (should be white bg, NOT green)
  // Row 137 = Total (should be green bg with SUM formulas)
  
  var ramRow = 136;
  var totalRow = 137;
  
  // Fix Ram row 136 � clear green, set white background on column H
  var ramRange = sheet.getRange(ramRow, 1, 1, 11); // columns A-K
  ramRange.setBackground(null); // clear any background
  
  // Set column H (car name) to white background with black text for Ram
  var ramH = sheet.getRange(ramRow, 8); // column H
  ramH.setBackground('#ffffff');
  ramH.setFontColor('#000000');
  
  // Fix columns I, J � clear any formulas, set to $0
  sheet.getRange(ramRow, 9).setValue(0).setNumberFormat('$#,##0'); // I
  sheet.getRange(ramRow, 10).setValue(0).setNumberFormat('$#,##0'); // J
  
  // Fix column K � should be formula =G+I+J for Ram, clear the SUM
  sheet.getRange(ramRow, 11).setFormula('=G' + ramRow + '+I' + ramRow + '+J' + ramRow).setNumberFormat('$#,##0');
  
  // Fix Total row 137 � green background
  var totalRange = sheet.getRange(totalRow, 1, 1, 11);
  totalRange.setBackground('#00ff00');
  totalRange.setFontColor('#000000');
  totalRange.setFontWeight('bold');
  
  // Set Total formulas � SUM of data rows (20 to 136)
  sheet.getRange(totalRow, 7).setFormula('=SUM(G20:G136)').setNumberFormat('$#,##0');  // G = purchase_cost
  sheet.getRange(totalRow, 8).setValue('Total'); // H = label
  sheet.getRange(totalRow, 9).setFormula('=SUM(I20:I136)').setNumberFormat('$#,##0');  // I = joint_expenses
  sheet.getRange(totalRow, 10).setFormula('=SUM(J20:J136)').setNumberFormat('$#,##0'); // J = vlad_expenses
  sheet.getRange(totalRow, 11).setFormula('=SUM(K20:K136)').setNumberFormat('$#,##0'); // K = total
  
  // Also set column F total if it exists
  sheet.getRange(totalRow, 6).setFormula('=SUM(F20:F136)').setNumberFormat('$#,##0');  // F
  
  SpreadsheetApp.flush();
  Logger.log('Fixed Total row formatting and formulas');
}
