#!/usr/bin/env bash
# validate-features.sh
# Checks that all protected features are present in index.html before a push.
# Exit code 1 = something is missing. Run automatically via .git/hooks/pre-push.

FILE="index.html"
ERRORS=0

check() {
  local label="$1"
  local pattern="$2"
  if ! grep -qE "$pattern" "$FILE"; then
    echo "❌ MISSING: $label"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "🔍 Validating protected features in $FILE..."

# ── LIBRARIES ──────────────────────────────────────────────────
check "SignaturePad library"        "signature_pad"
check "html2canvas library"         "html2canvas"
check "jsPDF library"               "jspdf|jsPDF"

# ── CORE SUPABASE HELPERS ──────────────────────────────────────
check "sbGet helper"                "async function sbGet"
check "sbPost helper"               "async function sbPost"
check "sbPatch helper"              "async function sbPatch"
check "sbDelete helper"             "async function sbDelete"
check "sbUpload helper"             "function sbUpload|async function sbUpload"
check "sbSignUrl helper"            "function sbSignUrl|sbSignPhotoUrl"

# ── CORE UI HELPERS ────────────────────────────────────────────
check "showLoading"                 "function showLoading"
check "hideLoading"                 "function hideLoading"
check "showView"                    "function showView"
check "syncFromSupabase"            "async function syncFromSupabase"
check "doLogin"                     "async function doLogin"
check "moneyInput"                  "function moneyInput"
check "moneyVal"                    "function moneyVal"
check "fuzzyMatch"                  "function fuzzyMatch"

# ── HTML OVERLAYS ──────────────────────────────────────────────
check "forms-overlay"               'id="forms-overlay"'
check "deposit-overlay"             'id="deposit-overlay"'
check "inv-overlay"                 'id="inv-overlay"'
check "vr-overlay"                  'id="vr-overlay"'
check "esign-overlay"               'id="esign-overlay"'
check "esign-status-preparing"      'id="esign-status-preparing"'
check "esign-status-ready"          'id="esign-status-ready"'
check "esign-status-sent"           'id="esign-status-sent"'

# ── DEAL UPLOAD FORM ───────────────────────────────────────────
check "deal-overlay"                'id="deal-overlay"'
check "deal-upload-notes"           'id="deal-upload-notes"'
check "dealSubmit"                  'function dealSubmit'
check "dealSubmit saves notes"      'deal-upload-notes.*value'

# ── VOID/RELEASE FIELDS ────────────────────────────────────────
check "vr-mname (middle name)"      'id="vr-mname"'
check "vr-void-date (auto-filled)"  'id="vr-void-date"'
check "vr-void-print (auto-filled)" 'id="vr-void-print"'

# ── E-SIGN JS FUNCTIONS ────────────────────────────────────────
check "esignOpen"                   'function esignOpen'
check "esignClose"                  'function esignClose'
check "esignCreateRequest"          'function esignCreateRequest'
check "esignCopyLink"               'function esignCopyLink'
check "esignSendSMS"                'function esignSendSMS'
check "esignSendEmail"              'function esignSendEmail'
check "esignShare"                  'function esignShare'
check "_esignStartPolling"          'function _esignStartPolling'
check "_esignStopPolling"           'function _esignStopPolling'
check "_esignPollCheck"             'function _esignPollCheck'
check "_esignResumePolling"         'function _esignResumePolling'
check "_esignShowSignedAlert"       'function _esignShowSignedAlert'
check "_esignOpenCounterSign"       'function _esignOpenCounterSign'
check "_resolveEsignSigUrl"         'function _resolveEsignSigUrl'
check "_buildEsignSection"          'function _buildEsignSection'
check "_initCounterSignPad"         'function _initCounterSignPad'
check "_clearCounterSign"           'function _clearCounterSign'
check "_submitCounterSign"          'function _submitCounterSign'
check "_showCompletedReview"        'function _showCompletedReview'
check "_viewSignedForm"             'function _viewSignedForm'
check "_completeAndClose"           'function _completeAndClose'

# ── E-SIGN UI TRIGGERS (buttons users tap to start the flow) ───
# These were silently deleted twice by broad edits that kept the
# functions intact but removed the entry points. Guard explicitly.
check "E-Sign button: deposit"      "esignOpen\('deposit'\)"
check "E-Sign button: invoice"      "esignOpen\('invoice'\)"
check "E-Sign button: void_release" "esignOpen\('void_release'\)"

# ── FORMS DETAIL VIEWS ─────────────────────────────────────────
check "openFormDetail"              'function openFormDetail'
check "openInvoiceDetail"           'function openInvoiceDetail'
check "openVRDetail"                'function openVRDetail'
check "renderVRList"                'function renderVRList'
check "loadVoidRelease"             'function loadVoidRelease'
check "formDeleteConfirm"           'function formDeleteConfirm'
check "formDeleteFinal"             'function formDeleteFinal'

# ── VOID/RELEASE FORM LOGIC ────────────────────────────────────
check "openVoidRelease"             'function openVoidRelease'
check "vrClose"                     'function vrClose'
check "vrBack"                      'function vrBack'
check "vrLoadVehicles"              'function vrLoadVehicles'
check "vrGoPreview"                 'function vrGoPreview'
check "vrSignedFormTaken"           'function vrSignedFormTaken'
check "vrSave"                      'function vrSave'

# ── vrLoadVehicles must include deals (not just inventory) ─────
check "vrLoadVehicles queries deals" "vrLoadVehicles.*|deals.*vrLoadVehicles|deals.*select=customer_name"

# ── E-SIGN LEGAL / EVIDENCE SYSTEM ────────────────────────────
check "_esignStampLine"             'function _esignStampLine'
check "_injectFormSignatures"       'function _injectFormSignatures'
check "Electronic Evidence Summary" 'Electronic Evidence Summary'
check "ESIGN Act legal footer"      'ESIGN.*7001|7001.*ESIGN'
check "esign-void-cust-sig spot"    'id="esign-void-cust-sig"'
check "esign-rel-cust-sig spot"     'id="esign-rel-cust-sig"'
check "esign-rel-dealer-sig spot"   'id="esign-rel-dealer-sig"'

# ── PDF DOWNLOAD ───────────────────────────────────────────────
check "_downloadSignedFormPDF"      'function _downloadSignedFormPDF'

# ── CASH OUT DEAL — IMPLEMENTATION INTEGRITY ───────────────────
# cashOutDealOpen must be async (so it can fetch fresh deals)
check "cashOutDealOpen is async"    'async function cashOutDealOpen'
# cashOutDealOpen must fetch deals live from Supabase (not rely on stale cache)
check "cashOutDealOpen fetches fresh deals" "allDeals.*sbGet|sbGet.*deals.*limit"
# codSelectDeal must embed customer name in paid_to (not use removed 'notes' column)
check "codSelectDeal embeds customer in paid_to" "paid_to.*customer_name"

# ── VOID/RELEASE — IMPLEMENTATION INTEGRITY ───────────────────
# vrGoPreview must auto-fill the print name field
check "vrGoPreview fills print name"  'vr-void-print.*textContent|textContent.*vr-void-print'
# vrGoPreview must auto-fill the date field
check "vrGoPreview fills date"        'vr-void-date.*textContent|textContent.*vr-void-date'

# ── ESIGN — IMPLEMENTATION INTEGRITY ──────────────────────────
# esignOpen must actually show the overlay
check "esignOpen shows overlay"       'esign-overlay.*style|style.*esign-overlay'
# _esignPollCheck must fetch from esign_requests table
check "_esignPollCheck queries esign_requests" "esign_requests.*status.*pending|pending.*esign_requests"
# _submitCounterSign must patch esign_requests to completed
check "_submitCounterSign marks completed" "esign_requests.*completed|completed.*esign_requests"
# Counter-sign pad must use black ink (so it shows on white form background)
check "Counter-sign pad uses black ink" "penColor.*#000"
# _injectFormSignatures must target the void customer sig spot
check "_injectFormSignatures targets sig spots" "esign-void-cust-sig"

# ── SHEETS TAB (Inventory + Deals26) ──────────────────────────
check "openInvSheets"                'async function openInvSheets'
check "closeInvSheets"               'function closeInvSheets'
check "shSetPage"                    'function shSetPage'
check "invSheetsSetLoc"              'function invSheetsSetLoc'
check "invSheetsRender"              'function invSheetsRender'
check "invSheetsAddCar"              'async function invSheetsAddCar'
check "isEditOpen"                   'function isEditOpen'
check "isEditSave"                   'async function isEditSave'
check "isShowExpPopup"               'function isShowExpPopup'
check "isExpSave"                    'async function isExpSave'
check "isLinkOpen"                   'function isLinkOpen'
check "isLinkSelect"                 'async function isLinkSelect'
check "isDeleteCar"                  'async function isDeleteCar'
check "d26Render"                    'function d26Render'
check "d26Edit"                      'function d26Edit'
check "d26Save"                      'async function d26Save'
check "d26Delete"                    'async function d26Delete'
check "d26ShowExpPopup"              'function d26ShowExpPopup'
check "d26ExpSave"                   'async function d26ExpSave'
check "d26ShowPmtPopup"              'function d26ShowPmtPopup'
check "d26PmtSave"                   'async function d26PmtSave'
check "sheetsPush"                   'function sheetsPush'
check "shLoadDeals"                  'async function shLoadDeals'

# ── DEALS26 AUTO-POPULATE ─────────────────────────────────────
check "_autopopulateDeals26"         'async function _autopopulateDeals26'
check "_updateDeals26FromDeal"       'async function _updateDeals26FromDeal'
check "_fillMissingTaxes"            'async function _fillMissingTaxes'
check "dealSubmit calls autopopulate" '_autopopulateDeals26.*record.*car'
check "dealEditSave calls update"    '_updateDeals26FromDeal'

# ── TRADE-IN PAYMENT METHOD ──────────────────────────────────
check "trade_in option in dealRenderPayments" "value=\"trade_in\".*Trade-In|trade_in.*Trade"
check "_createTradeInCar"            'async function _createTradeInCar'
check "dealSubmit calls createTradeIn" '_createTradeInCar'
check "Trade-in badge color"         'trade_in.*a855f7'

# ── INVENTORY AUTO-CREATE FROM CSV SYNC ───────────────────────
check "_autoCreateInventoryCosts"    'async function _autoCreateInventoryCosts'
check "syncLocation calls autoCreate" '_autoCreateInventoryCosts.*inserted'
check "syncNow calls autoCreate"     '_autoCreateInventoryCosts.*inserted'

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ All protected features & implementation checks passed."
  exit 0
else
  echo "🚨 $ERRORS check(s) FAILED. Push blocked."
  echo "   Fix the missing items or restore them from git history before pushing."
  exit 1
fi
