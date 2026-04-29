#!/usr/bin/env bash
# Push google-apps-script.js to Apps Script and update the live deployment
# so https://script.google.com/macros/s/AKfyc...Xb-luQ/exec serves the new code.
#
# Prereqs (one-time):
#   1. npm install -g @google/clasp
#   2. clasp login                              # browser auth as the script owner
#   3. Enable Apps Script API for that account: https://script.google.com/home/usersettings
#   4. Fill in scriptId in apps-script/.clasp.json (see PROJECT_SUMMARY.md)
#
# Usage:
#   ./scripts/deploy-apps-script.sh             # push + redeploy existing URL
#   ./scripts/deploy-apps-script.sh --new       # push + create a NEW deployment URL

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$REPO_ROOT/google-apps-script.js"
DEST_DIR="$REPO_ROOT/apps-script"
DEST="$DEST_DIR/Code.gs"
DEPLOYMENT_ID="AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ"

if [[ ! -f "$SRC" ]]; then
  echo "ERROR: $SRC not found" >&2
  exit 1
fi

if ! command -v clasp >/dev/null 2>&1; then
  echo "ERROR: clasp not installed. Run: npm install -g @google/clasp" >&2
  exit 1
fi

if ! grep -q '"scriptId"' "$DEST_DIR/.clasp.json" 2>/dev/null; then
  echo "ERROR: $DEST_DIR/.clasp.json missing or malformed" >&2
  exit 1
fi

if grep -q 'REPLACE_WITH_SCRIPT_ID' "$DEST_DIR/.clasp.json"; then
  echo "ERROR: scriptId in apps-script/.clasp.json is still the placeholder." >&2
  echo "  Open script.google.com → your project → Project Settings → copy the Script ID" >&2
  echo "  Paste it into apps-script/.clasp.json (replacing REPLACE_WITH_SCRIPT_ID)." >&2
  exit 1
fi

echo "→ Copying google-apps-script.js → apps-script/Code.gs"
cp "$SRC" "$DEST"

echo "→ clasp push (force, to overwrite remote)"
( cd "$DEST_DIR" && clasp push --force )

if [[ "${1:-}" == "--new" ]]; then
  echo "→ clasp deploy (new deployment URL)"
  ( cd "$DEST_DIR" && clasp deploy --description "deploy $(date +%Y-%m-%d_%H:%M)" )
else
  echo "→ clasp deploy --deploymentId $DEPLOYMENT_ID (updates existing URL)"
  ( cd "$DEST_DIR" && clasp deploy --deploymentId "$DEPLOYMENT_ID" --description "deploy $(date +%Y-%m-%d_%H:%M)" )
fi

echo "✓ Done. Live URL unchanged: https://script.google.com/macros/s/$DEPLOYMENT_ID/exec"
