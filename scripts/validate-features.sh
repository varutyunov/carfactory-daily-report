#!/usr/bin/env bash
# validate-features.sh
# Checks that all protected features are present in index.html before a push.
# Exit code 1 = something is missing. Run automatically via .git/hooks/pre-push.

FILE="index.html"
ERRORS=0

check() {
  local label="$1"
  local pattern="$2"
  if ! grep -q "$pattern" "$FILE"; then
    echo "❌ MISSING: $label"
    ERRORS=$((ERRORS + 1))
  fi
}

echo "🔍 Validating protected features in $FILE..."

# ── LIBRARIES ──────────────────────────────────────────────────
check "SignaturePad library"        "signature_pad"

# ── HTML OVERLAYS ──────────────────────────────────────────────
check "forms-overlay"               'id="forms-overlay"'
check "deposit-overlay"             'id="deposit-overlay"'
check "inv-overlay"                 'id="inv-overlay"'
check "vr-overlay"                  'id="vr-overlay"'
check "esign-overlay"               'id="esign-overlay"'
check "esign-status-preparing"      'id="esign-status-preparing"'
check "esign-status-ready"          'id="esign-status-ready"'
check "esign-status-sent"           'id="esign-status-sent"'

# ── VOID/RELEASE FIELDS ────────────────────────────────────────
check "vr-mname (middle name)"      'id="vr-mname"'

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
check "vrLoadVehicles queries deals" "vrLoadVehicles.*\|deals.*vrLoadVehicles\|deals.*select=customer_name"

echo ""
if [ $ERRORS -eq 0 ]; then
  echo "✅ All $(($(grep -c 'check "' "$0"))) protected features present."
  exit 0
else
  echo "🚨 $ERRORS protected feature(s) MISSING. Push blocked."
  echo "   Fix the missing items or restore them from git history before pushing."
  exit 1
fi
