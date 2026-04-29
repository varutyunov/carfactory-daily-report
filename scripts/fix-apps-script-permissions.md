# Fix Apps Script Permissions — Paste this into Desktop Claude

The Apps Script web app deployment lost spreadsheet permissions after the last deploy. The web app runs as arutyunovv@gmail.com but the Google Sheet is owned by a different account (Premier Auto Group). The sheet has been shared with arutyunovv@gmail.com as Editor.

## What's broken
The web app returns this error on any action that touches the spreadsheet:
```
"You do not have permission to call SpreadsheetApp.openById"
```

## Steps to fix

### Step 1: Re-authorize the script manually
1. Open this Google Sheet in the browser (as arutyunovv@gmail.com): `https://docs.google.com/spreadsheets/d/1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE`
2. Go to **Extensions → Apps Script**
3. In the Apps Script editor, select **`syncFullReconcile`** from the function dropdown at the top
4. Click **Run** (the play button)
5. A permissions/authorization popup will appear — **approve all permissions**
6. The function may show an error or succeed — either is fine, the point is to authorize

### Step 2: Verify the fix
After authorizing, test the web app by running this:
```bash
curl -s "https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec" -X POST -H "Content-Type: text/plain" -d '{"secret":"cf-sync-2026","action":"run_sync","tab":"Inventory"}' -L
```

If it returns `{"ok":true,"action":"run_sync","message":"Full reconciliation completed"}` — it's fixed.

If it still returns a permissions error, try Step 3.

### Step 3: Redeploy with correct scopes (only if Step 2 still fails)
Run the deploy script:
```bash
python scripts/deploy-apps-script.py "Fix spreadsheet permissions"
```

Then repeat Step 1 (run syncFullReconcile manually in the editor to trigger the auth prompt).

### Step 4: Verify the triggers still exist
In the Apps Script editor:
1. Click the **clock icon** (Triggers) in the left sidebar
2. You should see:
   - `syncFullReconcile` — Time-driven — Every 5 minutes
   - `onSheetEdit` — From spreadsheet — On edit
3. If `syncFullReconcile` trigger is missing, select `setupReconcileTrigger` from the function dropdown and click Run
4. If `onSheetEdit` trigger is missing, click **+ Add Trigger** → function: `onSheetEdit`, event source: From spreadsheet, event type: On edit

### Step 5: Final verification
Run this to confirm everything works end-to-end:
```bash
curl -s "https://script.google.com/macros/s/AKfycbxKUGfGi0WFQZFIKl2ElJhdaCNLBy95TJVJDBNvIEVRaDr9ja5zMo6WcwwPh453Xb-luQ/exec" -X POST -H "Content-Type: text/plain" -d '{"secret":"cf-sync-2026","action":"read_all","tab":"Deals26"}' -L
```

Should return `{"ok":true,"action":"read_all","rows":[...]}` with 100+ rows.
