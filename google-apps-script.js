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
    // All of these are routed to _handleProfitAction which has handlers for
    // each. Previously only 'read_profit' and 'update_profit' were listed
    // here, so profit_append_entry / profit_update_entry / profit_remove_entry
    // / update_profit_formula all fell through to the tab-config lookup and
    // returned 'Unknown tab: undefined'. That silently broke
    // _appendCashSaleToProfit AND the new Payroll Net → Extras post.
    if (action === 'read_profit' || action === 'update_profit' ||
        action === 'profit_append_entry' || action === 'profit_update_entry' ||
        action === 'profit_remove_entry' || action === 'update_profit_formula' ||
        action === 'profit_reformat_notes') {
      return _handleProfitAction(action, location, body.data || {});
    }
    if (action === 'sync_profit') {
      // Backfill / on-demand sync — reads full Profit26 sheet and upserts to Supabase
      var n = _syncProfitFromSheet(location);
      return jsonResponse({ ok: true, action: 'sync_profit', location: location, rowsUpserted: n });
    }

    // ── Payment automation: append to Deals26 (or Deals25) col G ──
    // Searches the Deals26 tab for a row matching last_name + year/make/model
    // tokens. If no hit, falls back to Deals25. On confident single match,
    // appends +amount to col G's growing formula and adds a note line. Returns
    // col F (owed) value so the caller can decide whether to also post to
    // Profit26 Payments. On zero/multiple/partial match, returns a status the
    // caller routes to the Review queue.
    if (action === 'deals26_append_payment') {
      return _handleDeals26AppendPayment(location, body.data || {});
    }

    // Direct row write for Review-queue approvals. Bypasses the matcher.
    // Inputs: body.data.{ tab: 'Deals26'|'Deals25', row, amount, note_line }
    if (action === 'deals26_append_payment_direct') {
      return _handleDeals26AppendPaymentDirect(location, body.data || {});
    }

    // Surgical cell-write for one-off rollbacks / fixes. Writes a raw
    // formula to col G + replaces col G's cell note verbatim. Use when
    // we need to reverse a test-write or correct a malformed entry
    // without losing the growing-formula history.
    // Inputs: body.data.{ tab, row, payments_formula: '=400+400+340',
    //                     payment_notes: 'line1\\nline2' }
    if (action === 'deals26_get_row_g') {
      var grgTab = String(body.data && body.data.tab || 'Deals26');
      var grgRow = parseInt(body.data && body.data.row);
      if (!grgRow || grgRow < 2) return jsonResponse({ ok: false, error: 'invalid_row' });
      var grgSs = SpreadsheetApp.openById(_getSpreadsheetId(location));
      var grgSheet = grgSs.getSheetByName(grgTab);
      if (!grgSheet) return jsonResponse({ ok: false, error: 'no_sheet' });
      var grgCell = grgSheet.getRange(grgRow, 7);
      var grgB = grgSheet.getRange(grgRow, 2).getValue();
      return jsonResponse({
        ok: true, action: 'deals26_get_row_g',
        tab: grgTab, row: grgRow,
        car_desc: String(grgB || ''),
        value: grgCell.getValue(),
        formula: grgCell.getFormula() || '',
        note: grgCell.getNote() || ''
      });
    }

    if (action === 'deals26_set_row_g') {
      var srgTab = String(body.data && body.data.tab || 'Deals26');
      var srgRow = parseInt(body.data && body.data.row);
      var formula = String(body.data && body.data.payments_formula || '');
      var noteStr = body.data && body.data.hasOwnProperty('payment_notes')
        ? String(body.data.payment_notes) : null;
      if (!srgRow || srgRow < 2) return jsonResponse({ ok: false, error: 'invalid_row' });
      if (!formula || formula.charAt(0) !== '=') return jsonResponse({ ok: false, error: 'formula_must_start_with_=' });
      var srgSs = SpreadsheetApp.openById(_getSpreadsheetId(location));
      var srgSheet = srgSs.getSheetByName(srgTab);
      if (!srgSheet) return jsonResponse({ ok: false, error: 'no_sheet' });
      PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
      var srgCell = srgSheet.getRange(srgRow, 7);
      srgCell.setFormula(formula);
      srgCell.setNumberFormat('$#,##0');
      if (noteStr !== null) srgCell.setNote(noteStr);
      return jsonResponse({
        ok: true, action: 'deals26_set_row_g',
        tab: srgTab, row: srgRow,
        value: srgCell.getValue(), formula: formula
      });
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
      // Safety: if the caller passed the expected name in body.data.<nameField>,
      // verify the sheet row actually matches before deleting. Guards against
      // stale sort_order pointing at the wrong car (e.g. when rows shifted).
      var expectedName = '';
      if (body.data && body.data[nameField]) expectedName = String(body.data[nameField]).trim();
      if (expectedName) {
        var actualLc = nameVal.toLowerCase();
        var expectedLc = expectedName.toLowerCase();
        if (actualLc !== expectedLc) {
          // Try scanning nearby rows (±20) in case sort_order drifted
          var found = -1;
          if (nameColLetter) {
            var nCol = letterToColumn(nameColLetter);
            var lastR = sheet.getLastRow();
            var minR = Math.max(config.startRow, targetRow - 20);
            var maxR = Math.min(lastR, targetRow + 20);
            for (var rr = minR; rr <= maxR; rr++) {
              var v = String(sheet.getRange(rr, nCol).getValue() || '').trim().toLowerCase();
              if (v === expectedLc) { found = rr; break; }
            }
          }
          if (found > 0) {
            targetRow = found;
          } else {
            Logger.log('Delete refused: expected "' + expectedName + '" at row ' + targetRow + ' but found "' + nameVal + '"');
            return jsonResponse({ ok: false, error: 'name_mismatch', expected: expectedName, actual: nameVal, row: targetRow });
          }
        }
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
      // Column G (payments) in Deals26 — preserve the growing formula pattern.
      // Payment automation stores col G as "=amt1+amt2+..." via the
      // deals26_append_payment action. If the app's edit popup later tries
      // to push a raw total here, we:
      //   - If the cell already holds a formula, only write if the incoming
      //     total differs from the formula's evaluated value (deliberate
      //     override). In that override case we reset to a single-value
      //     formula "=total" so future auto-appends keep the + chain.
      //   - If the incoming total matches, preserve the formula — the
      //     popup is just echoing the same total, don't clobber the detail.
      if (config.table === 'deals26' && cField === 'payments') {
        var existingGFormula = cell.getFormula() || '';
        if (existingGFormula) {
          var existingGVal = parseFloat(cell.getValue()) || 0;
          var incomingG = parseFloat(val) || 0;
          if (Math.abs(existingGVal - incomingG) < 0.01) {
            // Same total — keep the growing formula
            continue;
          }
          // Deliberate override — reset to a single-value formula
          cell.setFormula('=' + String(incomingG));
          cell.setNumberFormat('$#,##0');
          continue;
        }
        // No formula in the cell — fall through to the default setValue path
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
      // Normalize match key: trim + lowercase. For Deals26, include deal_num
      // so multiple deals on the same car (different weeks) stay distinct
      // rather than collapsing together.
      var rowKey = rowName.trim().toLowerCase();
      if (config.table === 'deals26') rowKey += '||' + (rowData.deal_num || 0);
      if (hasData && rowName) {
        sheetByName[rowKey] = rowData;
        sheetOrder.push(rowKey);
      }
    }

    // Read Supabase rows for this location, keyed by name
    var locFilter = 'location=eq.' + encodeURIComponent(loc) + '&';
    var dbRows = supabaseGet(config.table, locFilter + 'select=*&order=sort_order.asc,id.asc&limit=500');
    if (!Array.isArray(dbRows)) continue;

    // Group DB rows by the same normalized key used for sheet rows. When
    // multiple DB rows share a key, keep the best one (prefer car_id set →
    // most recent updated_at) and queue the rest for deletion. This self-heals
    // legacy duplicates that slipped in before dedupe was added.
    var dbByName = {};
    var _dbGroups = {};
    for (var d = 0; d < dbRows.length; d++) {
      var dName = dbRows[d][nameField] || '';
      if (!dName) continue;
      var dKey = dName.trim().toLowerCase();
      if (config.table === 'deals26') dKey += '||' + (dbRows[d].deal_num || 0);
      if (!_dbGroups[dKey]) _dbGroups[dKey] = [];
      _dbGroups[dKey].push(dbRows[d]);
    }
    var _gkeys = Object.keys(_dbGroups);
    for (var gi = 0; gi < _gkeys.length; gi++) {
      var _group = _dbGroups[_gkeys[gi]];
      if (_group.length === 1) {
        dbByName[_gkeys[gi]] = _group[0];
        continue;
      }
      _group.sort(function(a, b) {
        if (!!a.car_id !== !!b.car_id) return b.car_id ? 1 : -1;
        return String(b.updated_at || '').localeCompare(String(a.updated_at || ''));
      });
      dbByName[_gkeys[gi]] = _group[0];
      for (var gj = 1; gj < _group.length; gj++) {
        try {
          Logger.log('Reconcile DUP-DELETE: ' + tabName + ' → "' + _group[gj][nameField] + '" id=' + _group[gj].id);
          supabaseDelete(config.table, 'id=eq.' + _group[gj].id);
        } catch (err) {
          Logger.log('Reconcile DUP-DELETE error id=' + _group[gj].id + ': ' + err.message);
        }
      }
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
          Logger.log('Reconcile INSERT: ' + tabName + ' → "' + sRow[nameField] + '" sort=' + newSortOrder);
          var _postRes = supabasePost(config.table, sRow);
          // Register the new row so if a later sheetOrder entry shares this
          // normalized key (shouldn't happen with deal_num-aware keys, but
          // guards against lingering edge cases) it updates instead of
          // inserting another duplicate.
          if (Array.isArray(_postRes) && _postRes[0]) {
            dbByName[sName] = _postRes[0];
          } else {
            dbByName[sName] = sRow;
          }
        } catch (err) {
          Logger.log('Reconcile INSERT error for "' + sRow[nameField] + '": ' + err.message);
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

// Location-aware Profit26 sheet layout. The two sheets have historically
// had different block sizes: DeBary = 24 rows per month (1 header + 23 data),
// DeLand = 22 rows per month (1 header + 21 data). The reconciler and the
// profit_append_entry action must use the right block size for each sheet,
// otherwise DeBary's trailing 2 rows (Extras + Net Profit) get truncated
// or writes land on the wrong row.
function _getProfitLayout(location) {
  if (location === 'DeBary') {
    return {
      BLOCK_ROWS: 24,
      BLOCK_GAP: 1,
      // rin offset (where rin=0 is the month-header row) for the write-side
      // targets used by profit_append_entry / profit_update_entry.
      offsets: { payments: 20, cash_sales: 21, extras: 22, net_profit: 23 }
    };
  }
  // DeLand (default)
  return {
    BLOCK_ROWS: 22,
    BLOCK_GAP: 1,
    offsets: { payments: 18, cash_sales: 19, extras: 20, net_profit: 21 }
  };
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
    // Block size is location-aware (see _getProfitLayout): DeBary=24, DeLand=22.
    var MONTHS_PER_ROW = 4;
    var COLS_PER_MONTH = 3; // label, value, spacer
    var START_COL = 4; // column D
    var _rpLayout = _getProfitLayout(location);
    var BLOCK_ROWS = _rpLayout.BLOCK_ROWS;
    var BLOCK_GAP = _rpLayout.BLOCK_GAP;
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
    if (rowTypeA !== 'payments' && rowTypeA !== 'cash_sales' && rowTypeA !== 'extras') {
      return jsonResponse({ ok: false, error: 'invalid_row_type' });
    }

    // Find startRow and compute target cell. Block size and row offsets are
    // location-aware (see _getProfitLayout) — previously hardcoded offsets
    // for payments/cash_sales worked for DeBary only and silently landed on
    // DeLand's Net Profit row.
    var START_COL_A = 4;
    var startRowA = 1;
    for (var srA = 1; srA <= 20; srA++) {
      var cvA = String(sheet.getRange(srA, START_COL_A).getValue()).trim();
      if (cvA === 'Jan' || cvA === 'January') { startRowA = srA; break; }
    }
    var _apLayout = _getProfitLayout(location);
    var BLOCK_ROWS_A = _apLayout.BLOCK_ROWS;
    var BLOCK_GAP_A = _apLayout.BLOCK_GAP;
    var blockA = Math.floor(monthIdxA / 4);
    var mInBlockA = monthIdxA % 4;
    var blockStartInnerA = blockA * (BLOCK_ROWS_A + BLOCK_GAP_A);
    var rowOffsetA = _apLayout.offsets[rowTypeA];
    if (rowOffsetA === undefined) {
      return jsonResponse({ ok: false, error: 'offset_not_defined', row_type: rowTypeA });
    }
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

  if (action === 'profit_update_entry') {
    // Update one entry in Payments or Cash Sales formula + note.
    // Inputs: data.{month_idx, row_type, old_amount, old_description,
    //               new_amount, new_description}
    return _profitMutateEntry(sheet, data, 'update', location);
  }

  if (action === 'profit_remove_entry') {
    // Remove one entry from Payments or Cash Sales formula + note.
    // Inputs: data.{month_idx, row_type, amount, description}
    return _profitMutateEntry(sheet, data, 'remove', location);
  }

  if (action === 'profit_reformat_notes') {
    // Iterate all Profit26 Payments + Cash Sales + Extras cells for
    // every month. For each note line over 26 chars, rewrite it to fit
    // (drop known color tokens, collapse multi-word model to first
    // word, truncate lastName). Preserves amount (leading) and M/D
    // (trailing) — those are the data.
    //
    // Inputs: data.mode = 'preview' | 'apply' (preview returns counts
    // + sample before/after; apply writes back to cells).
    var pMode = String(data.mode || 'preview');
    var pLayout = _getProfitLayout(location);
    var P_START_COL = 4;
    var pStartRow = 1;
    for (var sr2 = 1; sr2 <= 20; sr2++) {
      var cvv = String(sheet.getRange(sr2, P_START_COL).getValue()).trim();
      if (cvv === 'Jan' || cvv === 'January') { pStartRow = sr2; break; }
    }
    var MAX_NOTE = 26;
    var COLOR_WORDS = {'white':1,'black':1,'silver':1,'red':1,'blue':1,'gray':1,'grey':1,'green':1,'yellow':1,'gold':1,'orange':1,'purple':1,'tan':1,'brown':1,'beige':1,'pearl':1,'maroon':1,'teal':1,'navy':1,'bronze':1,'burgundy':1,'champagne':1,'charcoal':1,'copper':1,'cream':1,'ivory':1};
    var fitNoteLine = function(line){
      var trimmed = String(line).trim();
      if (!trimmed) return line;
      var tokens = trimmed.split(/\s+/);
      if (tokens.length === 0) return line;
      // Detect compound lines — two payments mashed into one note line
      // (e.g. "220 16 RDX grey Hernandez 204 15 Lancer Davis"). Single
      // payments are typically <35 chars. Very long lines with a later
      // 3+ digit amount are almost certainly compound; leave them so
      // user can edit by hand rather than mangling the data.
      if (trimmed.length > 40) {
        for (var ci = 3; ci < tokens.length - 1; ci++){
          if (/^\d{3,4}$/.test(tokens[ci])) return line;
        }
      }
      var amt = tokens[0];
      var dateRe = /^\d{1,2}\/\d{1,2}$/;
      var yearRe = /^\d{2}$|^(19|20)\d{2}$/;
      var last = tokens[tokens.length - 1];
      var hasDate = dateRe.test(last);
      var date = hasDate ? last : '';
      var rest = hasDate ? tokens.slice(1, -1) : tokens.slice(1);
      // Year (2-digit or 4-digit) is part of the prefix — preserve it
      // with the amount so the drop strategy doesn't swallow the model.
      var year = '';
      if (rest.length > 0 && yearRe.test(rest[0])){
        year = rest[0];
        rest = rest.slice(1);
      }
      // Step 1: drop known color tokens anywhere in rest
      var middle = rest.filter(function(t){ return !COLOR_WORDS[t.toLowerCase()]; });
      var prefix = amt + (year ? ' ' + year : '');
      var join = function(arr){
        var out = [prefix].concat(arr);
        if (date) out.push(date);
        return out.join(' ');
      };
      var result = join(middle);
      if (result.length <= MAX_NOTE) return result;
      // Step 2: keep only first and last middle tokens (collapse
      // multi-word model / extra tokens).
      if (middle.length > 2){
        middle = [middle[0], middle[middle.length - 1]];
        result = join(middle);
        if (result.length <= MAX_NOTE) return result;
      }
      // Step 3: truncate the lastName (last token).
      if (middle.length >= 1){
        var prefixLen = prefix.length + 1 + (middle.length > 1 ? middle[0].length + 1 : 0);
        var suffixLen = (date ? 1 + date.length : 0);
        var avail = MAX_NOTE - prefixLen - suffixLen;
        if (avail >= 2){
          middle[middle.length - 1] = middle[middle.length - 1].slice(0, avail);
        }
        result = join(middle);
      }
      if (result.length > MAX_NOTE) result = result.slice(0, MAX_NOTE);
      return result;
    };

    var totalCells = 0, cellsChanged = 0, linesTouched = 0, totalLines = 0;
    var samples = [];
    var rowTypes = ['payments', 'cash_sales', 'extras'];
    for (var mIdx = 0; mIdx < 12; mIdx++){
      var blk = Math.floor(mIdx / 4);
      var mInB = mIdx % 4;
      var blockStart = blk * (pLayout.BLOCK_ROWS + pLayout.BLOCK_GAP);
      var colN = P_START_COL + mInB * 3 + 1;
      for (var rti = 0; rti < rowTypes.length; rti++){
        var rt = rowTypes[rti];
        var off = pLayout.offsets[rt];
        if (off === undefined) continue;
        var rowN = pStartRow + blockStart + off;
        var cellN = sheet.getRange(rowN, colN);
        var noteN = cellN.getNote() || '';
        if (!noteN) continue;
        totalCells++;
        var origLines = noteN.split(/\r?\n/);
        var changed = false;
        var newLines = origLines.map(function(l){
          var trimmed = (l || '').trim();
          if (!trimmed) return l;
          totalLines++;
          if (trimmed.length <= MAX_NOTE) return l;
          var fitted = fitNoteLine(trimmed);
          if (fitted !== trimmed){
            changed = true;
            linesTouched++;
            if (samples.length < 12){
              samples.push({row: rowN, col: colN, row_type: rt, month: mIdx + 1, from: trimmed, to: fitted});
            }
          }
          return fitted;
        });
        if (changed){
          cellsChanged++;
          if (pMode === 'apply'){
            PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
            cellN.setNote(newLines.join('\n'));
          }
        }
      }
    }

    return jsonResponse({
      ok: true, action: 'profit_reformat_notes',
      mode: pMode, location: location,
      total_cells_with_notes: totalCells,
      total_lines: totalLines,
      cells_changed: cellsChanged,
      lines_reformatted: linesTouched,
      samples: samples
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

// Locate Profit26 cell for a given month + row_type and run update/remove on it.
// Shared by profit_update_entry and profit_remove_entry.
// Matching strategy:
//   Primary  — match note line exactly by '<oldAmount> <oldDescription>' (trimmed)
//              then align with the same-index number in the formula.
//   Fallback — match by signed number in formula alone if note line not found.
function _profitMutateEntry(sheet, data, mode, location) {
  var monthIdxM = parseInt(data.month_idx);
  var rowTypeM = String(data.row_type || '');
  if (isNaN(monthIdxM) || monthIdxM < 0 || monthIdxM > 11) {
    return jsonResponse({ ok: false, error: 'invalid_month_idx' });
  }
  if (rowTypeM !== 'payments' && rowTypeM !== 'cash_sales' && rowTypeM !== 'extras') {
    return jsonResponse({ ok: false, error: 'invalid_row_type' });
  }

  // Locate the target cell using location-aware block size and offsets.
  var START_COL_M = 4;
  var startRowM = 1;
  for (var srM = 1; srM <= 20; srM++) {
    var cvM = String(sheet.getRange(srM, START_COL_M).getValue()).trim();
    if (cvM === 'Jan' || cvM === 'January') { startRowM = srM; break; }
  }
  var _mtLayout = _getProfitLayout(location);
  var BLOCK_ROWS_M = _mtLayout.BLOCK_ROWS;
  var BLOCK_GAP_M = _mtLayout.BLOCK_GAP;
  var blockM = Math.floor(monthIdxM / 4);
  var mInBlockM = monthIdxM % 4;
  var blockStartInnerM = blockM * (BLOCK_ROWS_M + BLOCK_GAP_M);
  var rowOffsetM = _mtLayout.offsets[rowTypeM];
  if (rowOffsetM === undefined) {
    return jsonResponse({ ok: false, error: 'offset_not_defined', row_type: rowTypeM });
  }
  var targetRowM = startRowM + blockStartInnerM + rowOffsetM;
  var targetColM = START_COL_M + mInBlockM * 3 + 1;
  var cellM = sheet.getRange(targetRowM, targetColM);

  var formulaM = cellM.getFormula() || '';
  var noteM = cellM.getNote() || '';

  // Parse formula into [{sign:'+'|'-', value}...] so we can manipulate by index
  var body = formulaM.replace(/^=\s*/, '').trim();
  var tokens = body.split(/([+\-])/).map(function(t){return t.trim();}).filter(Boolean);
  var entries = [];
  var sign = '+';
  for (var ti = 0; ti < tokens.length; ti++) {
    var tk = tokens[ti];
    if (tk === '+' || tk === '-') { sign = tk; continue; }
    var vv = parseFloat(tk);
    if (!isNaN(vv)) { entries.push({ sign: sign, value: vv }); sign = '+'; }
  }

  // Parse note lines
  var noteLines = noteM.split(/\r?\n/);
  var parsedLines = noteLines.map(function(l){
    var trimmed = (l || '').trim();
    var m = trimmed.match(/^(-?\d+(?:\.\d+)?)\s+(.*)$/);
    if (m) return { raw: l, amount: parseFloat(m[1]), desc: m[2].trim() };
    var m2 = trimmed.match(/^(-?\d+(?:\.\d+)?)$/);
    if (m2) return { raw: l, amount: parseFloat(m2[1]), desc: '' };
    return { raw: l, amount: null, desc: trimmed };
  });

  // Find matching index — prefer full match of amount+desc, fall back to amount-only
  var oldAmount, oldDesc;
  if (mode === 'update') {
    oldAmount = parseFloat(data.old_amount);
    oldDesc = String(data.old_description || '').trim();
  } else {
    oldAmount = parseFloat(data.amount);
    oldDesc = String(data.description || '').trim();
  }
  if (isNaN(oldAmount)) return jsonResponse({ ok: false, error: 'invalid_old_amount' });

  // Index in note that matches (amount + desc)
  var noteMatchIdx = -1;
  for (var pi = 0; pi < parsedLines.length; pi++) {
    var pl = parsedLines[pi];
    if (pl.amount != null && Math.abs(pl.amount - oldAmount) < 0.01 && pl.desc === oldDesc) {
      noteMatchIdx = pi; break;
    }
  }
  // If no full match, try amount-only fallback
  if (noteMatchIdx < 0) {
    for (var pi2 = 0; pi2 < parsedLines.length; pi2++) {
      var pl2 = parsedLines[pi2];
      if (pl2.amount != null && Math.abs(pl2.amount - oldAmount) < 0.01) {
        noteMatchIdx = pi2; break;
      }
    }
  }

  // Find the formula-entry index that corresponds to the same numeric amount
  // (entries are in formula-order; note lines are in the same order by convention)
  var formulaMatchIdx = -1;
  if (noteMatchIdx >= 0 && entries.length > noteMatchIdx) {
    var cand = entries[noteMatchIdx];
    var signedVal = cand.sign === '-' ? -cand.value : cand.value;
    if (Math.abs(signedVal - oldAmount) < 0.01) formulaMatchIdx = noteMatchIdx;
  }
  // Fallback: scan entries for first signed-amount match
  if (formulaMatchIdx < 0) {
    for (var ei = 0; ei < entries.length; ei++) {
      var sv = entries[ei].sign === '-' ? -entries[ei].value : entries[ei].value;
      if (Math.abs(sv - oldAmount) < 0.01) { formulaMatchIdx = ei; break; }
    }
  }

  if (formulaMatchIdx < 0 && noteMatchIdx < 0) {
    return jsonResponse({ ok: false, error: 'entry_not_found', old_amount: oldAmount });
  }

  // Apply mutation
  if (mode === 'remove') {
    if (formulaMatchIdx >= 0) entries.splice(formulaMatchIdx, 1);
    if (noteMatchIdx >= 0) parsedLines.splice(noteMatchIdx, 1);
  } else {
    var newAmount = parseFloat(data.new_amount);
    var newDesc = String(data.new_description || '').trim();
    if (isNaN(newAmount)) return jsonResponse({ ok: false, error: 'invalid_new_amount' });
    if (formulaMatchIdx >= 0) {
      entries[formulaMatchIdx] = { sign: newAmount < 0 ? '-' : '+', value: Math.abs(newAmount) };
    }
    if (noteMatchIdx >= 0) {
      var newNoteLine = (newAmount < 0 ? '-' + String(Math.abs(newAmount)) : String(newAmount)) +
        (newDesc ? ' ' + newDesc : '');
      parsedLines[noteMatchIdx] = { raw: newNoteLine, amount: newAmount, desc: newDesc };
    }
  }

  // Rebuild formula
  var newFormula;
  if (!entries.length) {
    newFormula = '';
  } else {
    var parts = entries.map(function(e, idx){
      if (idx === 0) return (e.sign === '-' ? '-' : '') + String(e.value);
      return e.sign + String(e.value);
    });
    newFormula = '=' + parts.join('');
  }

  // Rebuild note
  var newNoteLinesOut = parsedLines.map(function(p){ return p.raw != null ? p.raw : ((p.amount != null ? String(p.amount) : '') + (p.desc ? ' ' + p.desc : '')); });
  var newNote = newNoteLinesOut.join('\n').replace(/\n+$/, '');

  PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
  if (newFormula) {
    cellM.setFormula(newFormula);
    cellM.setNumberFormat('$#,##0');
  } else {
    // All entries removed — clear value back to 0 and clear note
    cellM.setValue(0);
    cellM.setNumberFormat('$#,##0');
  }
  cellM.setNote(newNote);

  return jsonResponse({
    ok: true,
    action: mode === 'update' ? 'profit_update_entry' : 'profit_remove_entry',
    row: targetRowM, col: targetColM,
    new_value: cellM.getValue(),
    new_formula: newFormula,
    formula_match_idx: formulaMatchIdx,
    note_match_idx: noteMatchIdx
  });
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
  // Block size is location-dependent — DeBary has 24 rows/month (Extras +
  // Net Profit at bottom), DeLand has 22. Using a global constant used to
  // silently truncate DeBary's last 2 rows per block.
  var _layout = _getProfitLayout(location);
  var BLOCK_ROWS = _layout.BLOCK_ROWS;
  var BLOCK_GAP = _layout.BLOCK_GAP;
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

// ============================================================
// PAYMENT AUTOMATION — append to Deals26 (or Deals25) col G
// ============================================================
//
// Called from app side on every scanned/entered customer payment.
// Flow:
//   1. Search Deals26 col B for a row matching last_name AND year+make+model.
//   2. If no match, fall back to Deals25 (same spreadsheet, different tab).
//   3. If exactly one confident match → append +amount to col G's growing
//      formula ( "=" + sum ), append a new line to the col G note, then
//      read back col F (owed) so the caller can decide whether to also
//      post to Profit26 Payments (F > 0 means the deal is in profit).
//   4. If zero / multiple / partial matches → return a status so the caller
//      queues the payment in the Review tab for manual approval.
//
// Inputs (body.data):
//   last_name   — lowercase last-name token for the customer
//   year        — "2017" or "17" (we match both forms)
//   make        — "Honda" / "civic" / etc
//   model       — "Civic" / "accord" / etc
//   color       — optional, for note formatting (not used for matching)
//   amount      — positive number
//   note_line   — pre-built by client per format rules (≤32 chars)
// ============================================================
function _handleDeals26AppendPayment(location, data) {
  try {
    var lastName = String(data.last_name || '').trim().toLowerCase();
    // last_names is an array of surname candidates (Hispanic names often
    // carry two, e.g. "Borroto Garcia" — sheet may list either). If the
    // client didn't send it, fall back to the single last_name.
    var lastNames = [];
    if (Array.isArray(data.last_names)) {
      for (var lni = 0; lni < data.last_names.length; lni++) {
        var t = String(data.last_names[lni] || '').trim().toLowerCase();
        if (t) lastNames.push(t);
      }
    }
    if (!lastNames.length && lastName) lastNames = [lastName];
    var year = String(data.year || '').trim();
    var make = String(data.make || '').trim().toLowerCase();
    var model = String(data.model || '').trim().toLowerCase();
    var color = String(data.color || '').trim().toLowerCase();
    var amount = parseFloat(data.amount);
    var noteLine = String(data.note_line || '').trim();

    if (!lastNames.length || !model || isNaN(amount) || amount <= 0 || !noteLine) {
      return jsonResponse({ ok: false, error: 'invalid_params',
        got: { last_names: lastNames, year: year, make: make, model: model, amount: amount, note_line_len: noteLine.length } });
    }

    // Lookup chain: Deals26 → Deals25 → Deals24 across BOTH locations.
    // Payments sometimes get tagged with the wrong location (e.g. a DeBary
    // customer pays at the DeLand office, so the payment says DeLand but
    // the deal row lives on DeBary's sheet). Search the payment's primary
    // location first, then fall back to the other one if no confident hit.
    var primaryLoc = location;
    var otherLoc = (primaryLoc === 'DeBary') ? 'DeLand' : 'DeBary';
    var primarySs = SpreadsheetApp.openById(_getSpreadsheetId(primaryLoc));
    var otherSs = SpreadsheetApp.openById(_getSpreadsheetId(otherLoc));

    // Run the 3-tab search in the primary location
    var primary = _searchTabsForMatch(primarySs, lastNames, year, make, model, color);
    primary.matchedLoc = primaryLoc;
    var result = primary;
    var ss = primarySs;
    var useLoc = primaryLoc;

    // If no confident match primary, try the other location
    if (result.status !== 'matched') {
      var other = _searchTabsForMatch(otherSs, lastNames, year, make, model, color);
      other.matchedLoc = otherLoc;
      if (other.status === 'matched') {
        result = other;
        ss = otherSs;
        useLoc = otherLoc;
      } else {
        // Rank across the two locations to pick the best non-matched
        // result for the Review card. Merge candidates from BOTH so the
        // user sees every near-match across the entire business.
        var rankS = { matched: 0, multiple: 1, partial: 2, no_match: 3, no_sheet: 4 };
        if ((rankS[other.status] || 5) < (rankS[result.status] || 5)) {
          result = other;
          useLoc = otherLoc;
        }
      }
    }
    var usedTab = result.usedTab || 'Deals26';

    if (result.status !== 'matched') {
      // Merge partial candidates from BOTH locations so the Review UI
      // shows every row that was close — including cross-location hits
      // that the user might want to approve manually.
      var mergedCandidates = [];
      [[primarySs, primaryLoc], [otherSs, otherLoc]].forEach(function(pair){
        var xSs = pair[0]; var xLoc = pair[1];
        ['Deals26','Deals25','Deals24'].forEach(function(tab){
          var rr = _findDealMatch(xSs, tab, lastNames, year, make, model, color);
          if (rr.candidates && rr.candidates.length) {
            rr.candidates.forEach(function(c){
              c.tab = tab;
              c.loc = xLoc;
              mergedCandidates.push(c);
            });
          }
        });
      });
      return jsonResponse({
        ok: true,
        action: 'deals26_append_payment',
        status: result.status === 'no_sheet' ? 'no_match' : result.status,
        location: primaryLoc,
        candidates: mergedCandidates
      });
    }

    // Confident match — append to col G (formula + note) on the matched
    // row. `ss` and `useLoc` were set above — they point to the spreadsheet
    // that actually contains the row, which may be the cross-location
    // fallback (e.g. payment tagged DeLand but deal lives on DeBary).
    var sheet = ss.getSheetByName(usedTab);
    var gCol = 7; // Col G
    var fCol = 6; // Col F
    var gCell = sheet.getRange(result.row, gCol);
    var fCell = sheet.getRange(result.row, fCol);

    // Swap the noteLine's last-name token to whatever Vlad typed on the
    // matched deals26 row. The payload's lastname comes from parsing
    // customer_name (last space-separated token), which picks the wrong
    // surname for compound names. Pass the full lastNames candidate
    // array so the rewrite picks whichever surname appears on the row.
    noteLine = _rewriteNoteLineLastName(noteLine, result.car_desc, lastNames);

    var existingFormula = gCell.getFormula() || '';
    var existingValue = gCell.getValue();
    var existingNote = gCell.getNote() || '';

    // Dup-check. Col G formula grows cumulatively ("=300+200+200"), so
    // just having the amount in the formula is NOT a block — that's
    // historical. We only skip when a NOTE LINE fully matches (same
    // amount AND same M/D date), and we flag when amount + date match
    // but other pieces differ (same-day same-amount → probable dupe).
    // Amount-alone in the note is allowed to post — user confirmed
    // cumulative history shouldn't block new payments.
    if (data.check_dup) {
      var noteLines = existingNote.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
      if (noteLines.indexOf(noteLine) !== -1) {
        return jsonResponse({
          ok: true,
          action: 'deals26_append_payment',
          status: 'already_posted',
          location: location,
          tab: usedTab,
          row: result.row,
          car_desc: result.car_desc
        });
      }
      var newDateMatch = /\s(\d{1,2}\/\d{1,2})\s*$/.exec(noteLine);
      var amtPrefix = String(amount) + ' ';
      if (newDateMatch) {
        var newDate = newDateMatch[1];
        var sameDaySameAmt = noteLines.some(function(l){
          if (l.indexOf(amtPrefix) !== 0) return false;
          var m = /\s(\d{1,2}\/\d{1,2})\s*$/.exec(l);
          return m && m[1] === newDate;
        });
        if (sameDaySameAmt) {
          return jsonResponse({
            ok: true,
            action: 'deals26_append_payment',
            status: 'possible_duplicate',
            location: location,
            tab: usedTab,
            row: result.row,
            car_desc: result.car_desc,
            candidates: [{ row: result.row, car_desc: result.car_desc, tab: usedTab }]
          });
        }
      }
    }

    var signStr = '+' + String(amount);
    var newFormula;
    if (existingFormula) {
      // Already a growing formula — append
      newFormula = existingFormula + signStr;
    } else if (existingValue !== '' && existingValue !== null && existingValue !== 0) {
      // Stray raw number — convert to =oldNum+amount
      var existingNum = parseFloat(String(existingValue).replace(/[$,]/g, '')) || 0;
      newFormula = '=' + String(existingNum) + signStr;
    } else {
      // Blank cell — start the formula. Note: no leading + on the first entry.
      newFormula = '=' + String(amount);
    }

    var newNote = existingNote
      ? (existingNote.replace(/\s+$/, '') + '\n' + noteLine)
      : noteLine;

    PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
    gCell.setFormula(newFormula);
    gCell.setNumberFormat('$#,##0');
    gCell.setNote(newNote);

    SpreadsheetApp.flush();

    // Read col F (owed) AFTER the G write so the sheet formula can recompute
    var owedValue = fCell.getValue();
    var owedNum = parseFloat(owedValue);
    if (isNaN(owedNum)) owedNum = 0;

    return jsonResponse({
      ok: true,
      action: 'deals26_append_payment',
      status: 'matched',
      location: useLoc, // sheet that actually got the write (may differ from payload)
      requested_location: location, // original payment.location for debugging
      tab: usedTab,
      row: result.row,
      car_desc: result.car_desc,
      owed: owedNum,
      new_formula: newFormula
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'exception', message: err.message });
  }
}

// Search Deals26 → Deals25 → Deals24 in a given spreadsheet. Returns:
//   { status: 'matched', row, car_desc, usedTab }
//   { status: 'multiple', candidates, usedTab }
//   { status: 'partial',  candidates, usedTab }
//   { status: 'no_match' }
//   { status: 'no_sheet' } — none of the three tabs exist
function _searchTabsForMatch(ss, lastNames, year, make, model, color) {
  var lookupTabs = ['Deals26', 'Deals25', 'Deals24'];
  var rank = { matched: 0, multiple: 1, partial: 2, no_match: 3, no_sheet: 4 };
  var best = { status: 'no_sheet' };
  var bestTab = null;
  for (var li = 0; li < lookupTabs.length; li++) {
    var r = _findDealMatch(ss, lookupTabs[li], lastNames, year, make, model, color);
    if (r.status === 'matched') {
      r.usedTab = lookupTabs[li];
      return r;
    }
    if ((rank[r.status] || 5) < (rank[best.status] || 5)) {
      best = r;
      bestTab = lookupTabs[li];
    }
  }
  best.usedTab = bestTab;
  return best;
}

// Known vehicle-model tokens that are ALSO common English/Spanish words
// people use as surnames. When the customer's parsed lastname list only
// contains tokens from this set, the lastname filter is dangerously wide
// (e.g. "Pedro SIERRA Sanchez" paying for an Expedition — "sierra" would
// match every GMC Sierra row in the sheet). In that case the matcher
// falls back to a pure year+model scan. Tokens here are also used to
// down-rank ambiguous lastname tokens in favor of non-ambiguous ones.
var _AMBIGUOUS_LASTNAME_TOKENS = {
  'sierra': true, 'expedition': true, 'explorer': true, 'ranger': true,
  'frontier': true, 'titan': true, 'tahoe': true, 'yukon': true,
  'suburban': true, 'colorado': true, 'silverado': true, 'sonata': true,
  'elantra': true, 'tucson': true, 'malibu': true, 'fusion': true,
  'escape': true, 'edge': true, 'focus': true, 'taurus': true,
  'traverse': true, 'impala': true, 'cruze': true, 'equinox': true,
  'outlook': true, 'cooper': true, 'santa': true, 'rogue': true,
  'sentra': true, 'altima': true, 'maxima': true, 'accord': true,
  'civic': true, 'pilot': true, 'odyssey': true, 'camry': true,
  'corolla': true, 'tacoma': true, 'tundra': true, 'mustang': true,
  'charger': true, 'challenger': true, 'ram': true, 'beetle': true,
  'jetta': true, 'passat': true, 'wrangler': true, 'cherokee': true,
  'compass': true, 'patriot': true, 'journey': true, 'durango': true,
  'avenger': true, 'caliber': true
};

// Find a deal row in the given Deals tab whose col B (car_desc) matches
// the payment's qualifiers. Matching rule (option B, locked with user):
//
//   REQUIRED — confident match needs all three: last name, year, model.
//   TIEBREAKER — if 2+ rows match the required three, use color to
//   narrow it down. If color picks exactly one, that's the match.
//   BONUS — make is treated as a soft signal (shows in partials), not
//   required. The sheet convention often omits make ("16 Passat
//   Gauvin" not "16 VW Passat Gauvin").
//
// Returns:
//   { status: 'matched', row, car_desc }                 — exactly one confident hit
//   { status: 'multiple', candidates: [{row,car_desc}] } — 2+ required-hits and color couldn't narrow
//   { status: 'partial',  candidates: [...] }            — last name OR car hit, but not both
//   { status: 'no_match' }                               — nothing
//   { status: 'no_sheet' }                               — tab missing
// lastNames may be a single string (legacy callers) or an array of
// surname candidates. For two-last-name customers (e.g. "Borroto Garcia"),
// the sheet may list either — we match if ANY of the candidates appears
// in col B.
function _findDealMatch(ss, tabName, lastNames, year, make, model, color) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) return { status: 'no_sheet' };

  var startRow = 2;
  var lastRow = sheet.getLastRow();
  if (lastRow < startRow) return { status: 'no_match' };

  var rng = sheet.getRange(startRow, 2, lastRow - startRow + 1, 1);
  var vals = rng.getValues();

  // Year alternates — 4-digit and 2-digit tail both accepted
  var yearAlts = [];
  if (year) {
    yearAlts.push(year);
    if (year.length === 4) yearAlts.push(year.slice(2));
    if (year.length === 2) yearAlts.push('20' + year);
  }
  var colorL = color ? String(color).toLowerCase() : '';

  // Normalize lastNames to an array of non-empty strings. Partition into
  // "strong" (non-ambiguous) and "weak" (matches a known model token).
  // When we only have weak candidates — e.g. "Pedro SIERRA Sanchez" paying
  // for an Expedition — the lastname filter is dangerously wide because
  // "sierra" is a GMC model. We still try weak tokens (some customers
  // genuinely are named Sierra), but if they zero out we fall back to a
  // pure year+model scan instead of flooding Review with wrong candidates.
  var nameListAll = [];
  var nameListStrong = [];
  var nameListWeak = [];
  if (Array.isArray(lastNames)) {
    for (var lnx = 0; lnx < lastNames.length; lnx++) {
      var lnn = String(lastNames[lnx] || '').trim().toLowerCase();
      if (!lnn) continue;
      nameListAll.push(lnn);
      if (_AMBIGUOUS_LASTNAME_TOKENS[lnn]) nameListWeak.push(lnn);
      else nameListStrong.push(lnn);
    }
  } else if (lastNames) {
    var lnStr = String(lastNames).trim().toLowerCase();
    if (lnStr) {
      nameListAll.push(lnStr);
      if (_AMBIGUOUS_LASTNAME_TOKENS[lnStr]) nameListWeak.push(lnStr);
      else nameListStrong.push(lnStr);
    }
  }
  if (!nameListAll.length) return { status: 'no_match' };

  // Prefer strong tokens; only fall back to weak if no strong tokens exist.
  var nameList = nameListStrong.length ? nameListStrong : nameListAll;
  var onlyWeak = !nameListStrong.length && nameListWeak.length > 0;

  // Pre-scan full sheet once so we can do a year+model fallback later.
  var allRows = [];
  for (var ri = 0; ri < vals.length; ri++) {
    var descR = String(vals[ri][0] || '').trim();
    if (!descR) continue;
    var descRL = descR.toLowerCase();
    allRows.push({
      row: startRow + ri,
      car_desc: descR,
      descL: descRL,
      has_last: nameListAll.some(function(n){ return _wordBoundary(descRL, n); }),
      has_year: yearAlts.length ? yearAlts.some(function(y){ return _wordBoundary(descRL, y.toLowerCase()); }) : false,
      has_make: make ? _wordBoundary(descRL, make) : false,
      has_model: model ? _wordBoundary(descRL, model) : false,
      has_color: colorL ? _wordBoundary(descRL, colorL) : false
    });
  }

  // ── Progressive narrowing (locked Apr 2026, revised for v58 after
  // misfires on ambiguous-lastname payments like "Pedro Sierra Sanchez"
  // → Expedition, where "sierra" matched every GMC Sierra row):
  //   1. Filter to rows where a non-ambiguous last-name token matches.
  //      (If only ambiguous tokens exist, use those but plan a year+model
  //       fallback for zero / bad hits.)
  //   2. If 1 hit → that's the match.
  //   3. Multiple hits + model → keep only rows where model also matches.
  //   4. 1 hit → match. Multiple → narrow by year. 1 hit → match.
  //   5. Still multiple → narrow by color. 1 hit → match.
  //   6. Still ambiguous → return as 'multiple' candidates.
  //   Fallback: if model narrowing zeros out, OR we only had weak tokens
  //   and got zero hits, scan the sheet for year+model matches and
  //   surface those as partial candidates (merged with any lastname
  //   hits we did find, deduped).
  var lastHits = allRows.filter(function(r){
    return nameList.some(function(n){ return _wordBoundary(r.descL, n); });
  });

  var ret = function(row){ return { status: 'matched', row: row.row, car_desc: row.car_desc }; };

  // Helper: build year+model fallback candidates for Review. v59 — require
  // year AND model when both are provided (was: just model). Prevents a
  // 17 Expedition payment matching a 2004 Expedition "because it's the
  // only Expedition on the sheet". If year is missing from the payload,
  // fall back to model alone; if model is missing, year alone. Sorts by
  // match score so the best candidate appears first.
  var yearModelFallback = function(){
    if (!model && !yearAlts.length) return [];
    var hits = allRows.filter(function(r){
      if (model && yearAlts.length) return r.has_model && r.has_year;
      if (model) return r.has_model;
      if (yearAlts.length) return r.has_year;
      return false;
    });
    // Rank: color match pulls to top (when color provided)
    hits.sort(function(a, b){
      var sa = (a.has_year ? 2 : 0) + (a.has_model ? 2 : 0) + (a.has_color ? 1 : 0);
      var sb = (b.has_year ? 2 : 0) + (b.has_model ? 2 : 0) + (b.has_color ? 1 : 0);
      return sb - sa;
    });
    return hits;
  };

  var dedupRows = function(rows){
    var seen = {}; var out = [];
    rows.forEach(function(r){ if (!seen[r.row]){ seen[r.row] = true; out.push(r); } });
    return out;
  };

  if (!lastHits.length) {
    // Zero lastname hits — surface year+model fallback as partial, NEVER
    // auto-match. User explicitly approves each fallback pick in Review.
    // (v58 had a `if (fb.length === 1) return ret(fb[0])` branch that
    // auto-posted a 17 Expedition payment to the only 2004 Expedition
    // it found in the other location — removed in v59.)
    var fb = yearModelFallback();
    if (fb.length) return { status: 'partial', candidates: _stripInternal(fb) };
    return { status: 'no_match' };
  }

  // Step 2: exactly one last-name hit — but if the only token was weak
  // (ambiguous with a model name) AND model doesn't also line up on
  // this row, don't trust it. Demote to partial and add y+m fallback.
  if (lastHits.length === 1) {
    var only = lastHits[0];
    if (onlyWeak && model && !only.has_model) {
      var fb1 = yearModelFallback();
      var merged1 = dedupRows(lastHits.concat(fb1));
      return { status: 'partial', candidates: _stripInternal(merged1) };
    }
    // Strong single hit — but still require year and model to line up
    // when both are provided (prevents a "garcia" hit on a 2013 Civic
    // from auto-posting a 2017 Accord payment). If year/model mismatch,
    // demote to partial with y+m fallback alternatives.
    if (model && yearAlts.length && (!only.has_model || !only.has_year)) {
      var fb1b = yearModelFallback();
      var merged1b = dedupRows(lastHits.concat(fb1b));
      return { status: 'partial', candidates: _stripInternal(merged1b) };
    }
    return ret(only);
  }

  // Step 3: narrow by model when we have a model string
  var modelHits = lastHits;
  if (model){
    modelHits = lastHits.filter(function(r){ return r.has_model; });
    if (modelHits.length === 1){
      // Require year match too when year is provided
      if (yearAlts.length && !modelHits[0].has_year){
        var fb2a = yearModelFallback();
        var merged2a = dedupRows(lastHits.concat(fb2a));
        return { status: 'partial', candidates: _stripInternal(merged2a) };
      }
      return ret(modelHits[0]);
    }
    if (modelHits.length === 0){
      // Model filter zeroed it out. v58: also pull year+model matches
      // (any row) so Review shows the likely-correct deal even when the
      // lastname was wrong or nicknamed. Merge + dedupe.
      var fb2 = yearModelFallback();
      var merged2 = dedupRows(lastHits.concat(fb2));
      return { status: 'partial', candidates: _stripInternal(merged2) };
    }
  }

  // Step 4: narrow by year
  if (yearAlts.length){
    var yearHits = modelHits.filter(function(r){ return r.has_year; });
    if (yearHits.length === 1) return ret(yearHits[0]);
    if (yearHits.length > 1) modelHits = yearHits;
  }

  // Step 5: narrow by color
  if (colorL){
    var colorHits = modelHits.filter(function(r){ return r.has_color; });
    if (colorHits.length === 1) return ret(colorHits[0]);
    if (colorHits.length > 1) modelHits = colorHits;
  }

  // Still multiple — surface as candidates for review
  return { status: 'multiple', candidates: _stripInternal(modelHits) };
}

// Rewrite the note_line's last-name token to match the car_desc on the
// target row. The app parses customer_name and takes the last space-
// separated token, which picks the wrong surname for Hispanic compound
// names (e.g. "ADRIANNA LOPEZ" → "lopez" is actually fine, but if the
// deals26 row was keyed "Lopez Cruz", v56's "take last word" logic
// would have written "cruz", which is wrong — Vlad typed "Lopez" as
// the primary surname).
//
// Correct behavior: use the payload's lastNames array (caller's
// computed surname candidates) and pick whichever one actually
// appears on the matched row. Fall back to car_desc's last word only
// when nothing from lastNamesHint matches.
//
// Input noteLine shape (from the app's _paymentNoteLine):
//   "{amount} {model} [{color}] {lastname} [{M/D}]"
// We identify the lastname token as the word right before the
// trailing M/D (or the last word if no date).
function _rewriteNoteLineLastName(noteLine, carDesc, lastNamesHint){
  if (!noteLine || !carDesc) return noteLine;
  var descL = String(carDesc).toLowerCase();
  var tokens = noteLine.trim().split(/\s+/);
  if (tokens.length < 2) return noteLine;
  var dateRe = /^\d{1,2}\/\d{1,2}$/;
  var hasDate = dateRe.test(tokens[tokens.length - 1]);
  var lastIdx = hasDate ? tokens.length - 2 : tokens.length - 1;
  if (lastIdx < 1) return noteLine;

  var wordBoundary = function(hay, needle){
    if (!needle) return false;
    var esc = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp('\\b' + esc + '\\b', 'i').test(hay);
  };

  // Candidate pool: caller's hints first, then the noteLine's current
  // lastname (so we don't drop info we already had).
  var candidates = [];
  if (Array.isArray(lastNamesHint)){
    for (var lh = 0; lh < lastNamesHint.length; lh++){
      var c = String(lastNamesHint[lh] || '').trim().toLowerCase();
      if (c && candidates.indexOf(c) === -1) candidates.push(c);
    }
  }
  var currentLast = tokens[lastIdx].toLowerCase();
  if (candidates.indexOf(currentLast) === -1) candidates.push(currentLast);

  // Pick first candidate that actually appears on the deals26 row.
  var newLast = null;
  for (var ci = 0; ci < candidates.length; ci++){
    if (wordBoundary(descL, candidates[ci])){ newLast = candidates[ci]; break; }
  }
  // Fallback: no candidate matched → use car_desc's last word (old v56 behavior)
  if (!newLast){
    var descTokens = String(carDesc).trim().split(/\s+/);
    newLast = descTokens[descTokens.length - 1];
    if (newLast) newLast = newLast.toLowerCase();
  }
  if (!newLast || currentLast === newLast) return noteLine;
  tokens[lastIdx] = newLast;
  return tokens.join(' ');
}

// Drop the lookup-only `descL` field when returning candidates.
function _stripInternal(rows){
  return rows.map(function(r){
    return {
      row: r.row, car_desc: r.car_desc,
      has_last: r.has_last, has_year: r.has_year,
      has_make: r.has_make, has_model: r.has_model,
      has_color: r.has_color
    };
  });
}

// Direct row write — used when the user approves a specific candidate in
// the Review queue. The candidate { tab, row } has already been chosen;
// we just append the amount to col G and return the recomputed col F.
function _handleDeals26AppendPaymentDirect(location, data) {
  try {
    var tabName = String(data.tab || 'Deals26');
    var row = parseInt(data.row);
    var amount = parseFloat(data.amount);
    var noteLine = String(data.note_line || '').trim();

    if (!tabName || !row || row < 2 || isNaN(amount) || amount <= 0 || !noteLine) {
      return jsonResponse({ ok: false, error: 'invalid_params' });
    }
    if (tabName !== 'Deals26' && tabName !== 'Deals25' && tabName !== 'Deals24') {
      return jsonResponse({ ok: false, error: 'invalid_tab' });
    }

    var ss = SpreadsheetApp.openById(_getSpreadsheetId(location));
    var sheet = ss.getSheetByName(tabName);
    if (!sheet) return jsonResponse({ ok: false, error: 'no_sheet' });

    var gCell = sheet.getRange(row, 7); // Col G
    var fCell = sheet.getRange(row, 6); // Col F

    // Pull the matched row's car_desc (col B) to align the note's last-name
    // token with what Vlad typed on the row — same rule as the matcher path.
    // For the direct path the caller didn't send lastNames, so the rewrite
    // falls back to using the noteLine's current lastname token as its
    // only candidate (and car_desc's last word if that doesn't match).
    var rowCarDesc = String(sheet.getRange(row, 2).getValue() || '').trim();
    noteLine = _rewriteNoteLineLastName(noteLine, rowCarDesc, Array.isArray(data.last_names) ? data.last_names : null);

    var existingFormula = gCell.getFormula() || '';
    var existingValue = gCell.getValue();
    var existingNote = gCell.getNote() || '';

    // Dup-check — same date-aware logic as deals26_append_payment.
    // Amount in the cumulative formula doesn't block; only same-line or
    // same-day-same-amount note entries do.
    if (data.check_dup) {
      var lines = existingNote.split(/\r?\n/).map(function(l){ return l.trim(); }).filter(Boolean);
      if (lines.indexOf(noteLine) !== -1) {
        return jsonResponse({
          ok: true, action: 'deals26_append_payment_direct',
          status: 'already_posted', tab: tabName, row: row
        });
      }
      var newDateMatch2 = /\s(\d{1,2}\/\d{1,2})\s*$/.exec(noteLine);
      var amtPrefix = String(amount) + ' ';
      if (newDateMatch2) {
        var newDate2 = newDateMatch2[1];
        var hit2 = lines.some(function(l){
          if (l.indexOf(amtPrefix) !== 0) return false;
          var m = /\s(\d{1,2}\/\d{1,2})\s*$/.exec(l);
          return m && m[1] === newDate2;
        });
        if (hit2) {
          return jsonResponse({
            ok: true, action: 'deals26_append_payment_direct',
            status: 'possible_duplicate', tab: tabName, row: row
          });
        }
      }
    }

    var signStr = '+' + String(amount);
    var newFormula;
    if (existingFormula) {
      newFormula = existingFormula + signStr;
    } else if (existingValue !== '' && existingValue !== null && existingValue !== 0) {
      var existingNum = parseFloat(String(existingValue).replace(/[$,]/g, '')) || 0;
      newFormula = '=' + String(existingNum) + signStr;
    } else {
      newFormula = '=' + String(amount);
    }

    var newNote = existingNote
      ? (existingNote.replace(/\s+$/, '') + '\n' + noteLine)
      : noteLine;

    PropertiesService.getScriptProperties().setProperty('_syncLockTime', String(Date.now()));
    gCell.setFormula(newFormula);
    gCell.setNumberFormat('$#,##0');
    gCell.setNote(newNote);

    SpreadsheetApp.flush();

    var owedValue = fCell.getValue();
    var owedNum = parseFloat(owedValue);
    if (isNaN(owedNum)) owedNum = 0;

    return jsonResponse({
      ok: true,
      action: 'deals26_append_payment_direct',
      status: 'matched',
      tab: tabName,
      row: row,
      owed: owedNum,
      new_formula: newFormula
    });
  } catch (err) {
    return jsonResponse({ ok: false, error: 'exception', message: err.message });
  }
}

// Whole-word match of `needle` inside `haystack`. Handles hyphenated names
// (Garcia-Martinez matches both "garcia" and "martinez" and "garcia-martinez"),
// case-insensitive (caller lowercases). Returns true if needle appears with
// word boundaries, OR if haystack contains the needle bracketed by hyphen.
function _wordBoundary(haystack, needle) {
  if (!needle) return true;
  if (!haystack) return false;
  // Escape regex specials
  var escaped = needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  // \b needle \b, also allow hyphen on either side for compound names
  var re = new RegExp('(^|[\\s,\\-\\/])' + escaped + '(?=[\\s,\\-\\/]|$)', 'i');
  return re.test(haystack);
}
