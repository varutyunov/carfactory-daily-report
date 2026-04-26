# Car Factory — Project Brain

## What This Is
Single-page PWA for a used car dealership with two locations (DeBary + DeLand). Manages inventory, employee work assignments, vehicle sales deals, payments, payroll, deposits, invoices, and AI voice assistant. Everything lives in one `index.html` (~27k lines). No framework — vanilla JS, inline CSS.

## Stack
- **Frontend:** Vanilla JS + HTML + inline CSS in `index.html`
- **Backend:** Supabase (Postgres DB + file storage)
- **Hosting:** GitHub Pages at https://carfactory.work
- **Serverless:** Netlify Functions (`/ai-proxy` for Claude, `/telegram-webhook`)
- **Push:** OneSignal SDK
- **OCR:** Google Vision API (receipt scanning)
- **AI:** Claude API via Netlify proxy + Web Speech API for voice

## CRITICAL: Git Deployment

**GitHub Pages serves from the `main` branch — NOT `master`.**

The repo has two branches: `master` (working branch) and `main` (live/deployed branch).
Git is configured with dual push refspecs so `git push` updates both automatically:
```
remote.origin.push = refs/heads/master:refs/heads/master
remote.origin.push = refs/heads/master:refs/heads/main
```

**Always push from `/c/Users/Vlad/Desktop/carfactory` (the main repo), never from a worktree.**
After pushing, verify the live site at https://carfactory.work reflects the change.

When merging before push: `git fetch origin main && git merge origin/main --no-edit && git push`
(version.json often conflicts — this handles it)

## Testing Rule
**Always test in preview before pushing.** Use mobile viewport (375x812). Vlad only cares about phone UX.

## File Structure
```
index.html          — THE app (all HTML + CSS + JS, ~27k lines)
sw.js               — Service worker (cache versioning, push, badge)
manifest.json       — PWA manifest (standalone, icons)
version.json        — Version tracker (auto-updated)
icon.png/icon-192/icon-512/apple-touch-icon — App icons
stock-*.png         — Placeholder vehicle images
netlify.toml        — Netlify config
scripts/            — Sync scripts (carpay-sync, gps-sync, inventory-sync) + one-shot maintenance (cleanup-sold-inventory-costs.py)
netlify/functions/  — Serverless (ai-proxy.js, telegram-webhook.js)
google-apps-script.js — Container-bound Apps Script for Google Sheets two-way sync
```

## Supabase Tables
| Table | Purpose |
|-------|---------|
| `employees` | Users: username, PIN, role (manager/employee), location |
| `inventory` | Vehicles: year, make, model, VIN, stock#, photo, mileage, location |
| `assignments` | Work assignments linking employees to vehicles + task lists |
| `car_photos` | Photos by category (photos, details, repairs, etc.) |
| `deals` | Sales: customer, vehicle, payment breakdown (JSON), location |
| `payments` | Individual payment entries: cash/card/check/zelle, tagged by week |
| `cash_payouts` | Weekly cash payout records per location |
| `deposits` | Vehicle deposit forms. Columns: customer_name, vehicle_desc, vin, stock, deposit_amount, balance, deposit_date, withdraw_until, id_photo_url, signed_form_url, deal_type, created_by, location, esign_status, esign_signature_url, seller_signature_url. **NOTE: NO `payment_method` or `remaining_balance` columns** |
| `invoices` | Service invoices with line items |
| `notifications` | In-app notifications with read status |
| `calendar_events` | Work calendar events |
| `payment_deletions` | Audit log of deleted payments |
| `carpay_customers` | CarPay external customer sync |
| `carpay_payments` | CarPay external payment sync |
| `app_settings` | Key-value config store (net deal adjustments, etc.) |
| `repo_gps_signals` | GPS tracking data |
| `inventory_costs` | Inventory Sheets tab — per-car cost tracking (purchase_cost, joint_expenses, vlad_expenses, expense_notes, vlad_expense_notes, sort_order). Syncs two-way with Google Sheet |
| `deals26` | Deals26 Sheets tab — deal financials with week grouping (expenses, expense_notes, payments, payment_notes, sold_inv_vin, sort_order). Syncs two-way with Google Sheet |
| `esign_requests` | E-sign tracking (form_type, form_record_id, form_html, status, signed_at, auth_certificate) |
| `void_releases` | Vehicle void/release forms |

## Supabase Helpers
```javascript
sbGet(table, params)     // GET — query with filters
sbPost(table, body)      // INSERT
sbPatch(table, id, body) // UPDATE by id
sbDelete(table, id)      // DELETE by id
sbUpload(path, file)     // Storage upload
sbSignUrl(storagePath)   // Get signed URL
```

## Authentication
- Login: username + 4-digit PIN against `employees` table
- Session stored in `localStorage` as `cf_session`
- `me` global = current user object `{id, name, username, pin, role, location}`
- Face ID: Credential Management API (not WebAuthn — broken in iOS PWA)
- Roles: `manager` (full access), `employee` (own tasks only)
- Owners: Vlad, Tommy — get extra features (AI, CarPay, payroll edit, net cash edit)

## Location System
Two locations: **DeBary** (default) and **DeLand**. Most views filter by `_payLocation`.
- Deals, payments, payroll, cash payouts all scoped per location
- DeBary employees: Ricky, Scott, Manny
- DeLand employees: Jesse
- Switching location resets all payment/deal state

## Key UI Sections (by div ID)
- `#login` — Login screen
- `#app` — Main app container
- **Manager:** `#mgr-home`, `#mgr-inventory`, `#mgr-assigned`, `#mgr-repair`, `#mgr-detail`, `#mgr-photos`, `#mgr-parts`, `#mgr-paint`
- **Employee:** `#emp-home`, `#emp-orbit-home`, `#emp-tab-tasks`, `#emp-inv-view`
- **Deals:** `#deal-overlay` (3-step form), `#deals-list` (deals view)
- **Payments:** `#pay-overlay`, `#pay-scan-canvas` (OCR)
- **Cash Out:** `#cash-payouts-sheet`, `#cash-out-deal-sheet`
- **Forms/Deposits:** `#deposit-overlay`, `#forms-list`
- **Invoices:** `#inv-overlay` (3-step form)
- **Vehicle Release:** `#vr-overlay` (void + release forms)
- **AI/Voice:** `#ai-input-bar`, `#ai-messages`, `#orbit-brain-btn`
- **Calendar:** `#cal-detail-panel`

## Key Global State Variables
```
me                    — Current user
S                     — Core state {employees[], inventory[], assignments[], notifications[]}
_payLocation          — 'DeBary' or 'DeLand'
_payCurrentWeekStart  — Current week being viewed (Date)
_payWeekData[]        — Payment rows for current week
_payDealRows[]        — Net deal adjustment settings
_payNetAdjusted       — Whether showing adjusted net cash view
_payNetAdjustAmt      — Adjusted net cash total
_payDealFullCashMap   — Full deal cash lookup by customer name
_dealsData[]          — Deals for current view
_cashPayouts[]        — Cash payouts for current week
_payBreakdown         — {cash, card, check, other, total}
```

## Payment System Details
- Payments tagged to weeks by `week_start` field
- Deal payments have `raw_ocr_text` starting with `'Deal — '` (em dash + vehicle desc)
- `_payWeekData` = all payment rows for the viewed week + location
- Net Cash = total cash minus deal-tagged cash, plus any adjusted deal amounts
- Net deal settings saved to `app_settings` table keyed by `cf_netdeal_{weekKey}_{location}`
- Deal cash can be split across holders: Vlad, Tommy, Manny, Deposit

## Payroll
- **DeBary:** Ricky, Scott, Manny payroll buttons
- **DeLand:** Jesse payroll button only
- Manny: $300/car after 5 sales (not $350)
- Payroll calculated from deals count, days worked, extras

## Service Worker (sw.js)
- Cache version: `cf-cache-v{N}` — bump on every deploy
- HTML: always network (never cached)
- Static assets: cache-first
- OneSignal imported for push
- Badge management via `SET_BADGE` message

## Common Patterns
- `moneyInput(el)` / `moneyVal(el)` — currency formatting on inputs
- `showView(id)` — switch visible view
- `showLoading(msg)` / `hideLoading()` — loading overlay
- `fuzzyMatch(fields, query)` — search/filter helper
- Every modal/overlay MUST have a back/close button
- `syncFromSupabase()` — pull all data, called after login and periodically

## ABSOLUTE RULE: No Auto-Posting — Everything Goes Through Review

**All payment automation MUST queue a Review card and wait for Vlad's explicit approval tap before writing anything to Deals26, Profit26, or any Google Sheet.**

This is a standing owner directive as of 2026-04-24. It applies to:
- CarPay payments (all, including accounts with known deal_links via Stage-2)
- Scanned payments
- Re-process pending (may auto-post for previously-approved deal_link accounts only — all other matches go to card for approval)
- Any new automated flow added in the future

**Do NOT add auto-posting logic** to any function unless Vlad explicitly says "you can auto-post now." The single exception is the Stage-2 deal_link path in `_appendCarPayPaymentToDeals26` (live CarPay sync for accounts previously approved by Vlad — this was already working before APPROVE_FIRST_MODE and Vlad has accepted it). Everything else must queue and wait.

`_APPROVE_FIRST_MODE = true` is the enforcing flag. Do not set it to false.

## ABSOLUTE RULE: Never Delete Working Code

**NEVER delete, replace, or overwrite existing working functions.** The user has never asked to delete code. Every function in the app was built for a reason and must be preserved. Violations of this rule have caused repeated loss of critical features.

**Hard rules:**
1. **NEVER remove a function.** If you're adding new logic, INSERT it — don't replace blocks that contain existing functions.
2. **NEVER replace more than one function at a time.** Each Edit must target one function or one small section within a function. If your `old_string` contains multiple function definitions, your edit is too broad — shrink it.
3. **ASK before any destructive edit.** If a change would remove or fundamentally restructure existing code, ask the user first. The user wants to approve any removal.
4. **INSERT, don't replace.** When adding new features, find the right insertion point and add code there. Don't replace a neighboring block that happens to be nearby.
5. **Read the target area fresh before every edit.** Code may have been added by a prior session. Never assume you know what's there from memory.
6. **Grep before EVERY commit.** Run a grep for all key function names in the area you edited. If any function that existed before is now missing, STOP and fix it before committing.
7. **After the commit, grep again.** Double-check the committed file still has all expected functions.
8. **NEVER mass-update or bulk-modify live data without explicit per-scope approval.** This applies to Supabase rows and Google Sheets cells. Even if the mutation "looks safe" or is "defensive cleanup," STOP — get the user to approve the specific scope first. Dry-run, show exactly which rows/cells will change, wait for "yes." No "while I'm here, let me also…" sweeps. (See: April 20, 2026 — a well-intentioned sweep cleared column G on 97 Deals26 rows and destroyed user-entered data. Never again.)

**Why this matters:** This is a 27k-line single-file app. A single overly broad Edit can silently delete dozens of functions. And a single over-broad data sweep can wipe real business data that isn't recoverable outside Google Sheets version history. The user loses hours of work and trust. There is no acceptable reason to delete working code or bulk-mutate live data without explicit permission.

## Operating Mode: phone-first, autonomous

**Vlad drives everything from the chat box on his phone. You handle the rest.**

This means:
- **Do not ask the user to paste credentials, open DevTools, run scripts locally, copy cURL commands, or drive a browser.** The user should never need to leave the chat to make you productive.
- Prefer automation paths that already have the secrets they need (GitHub Actions secrets, Supabase anon key in `supabase_keys.txt`, GitHub PAT in `../Automation/GIThub Carpay update.txt`).
- Ask for input only when a **decision** is needed (which direction, approve a scope, pick an option) — not to offload work you can do yourself.
- Assume the user cannot reliably use desktop tools. Don't suggest "open F12 and do X."

When a task requires credentials that aren't already on disk (CarPay login, any third-party portal), reach for the **Node-via-workflow-dispatch** pattern below.

## Automation scripts against external authenticated APIs

**Problem:** Tasks like scraping CarPay, testing external auth, or probing a site behind login need credentials that aren't local. Driving Chrome MCP sometimes fails (the dev host may be IP-blocked by the target site; the extension may not be connected).

**Default solution — Node script + one-shot GitHub Actions workflow_dispatch.**

GitHub Actions secrets already hold: `CARPAY_EMAIL`, `CARPAY_PASSWORD`, `CARPAY_DEBARY_ID` (656), `CARPAY_DELAND_ID` (657), `SUPABASE_URL`, `SUPABASE_KEY`. Use them without asking.

Playbook:
1. Write/modify a Node script under `scripts/` that reads the needed vars from `process.env`. Reuse the cookie jar + login helpers from `scripts/carpay-sync.js` for CarPay.
2. Create (or reuse) a minimal `.github/workflows/*.yml` that runs the script with the needed `secrets.*` env vars. `workflow_dispatch:` trigger only for probes.
3. Commit + push from the main repo (dual refspec pushes to master AND main).
4. Trigger:
   ```
   curl -sS -X POST -H "Authorization: Bearer <PAT>" \
     https://api.github.com/repos/varutyunov/carfactory-daily-report/actions/workflows/<name>.yml/dispatches \
     -d '{"ref":"main"}'
   ```
   PAT is in `C:\Users\Vlad\Desktop\Automation\GIThub Carpay update.txt` (second line — no-expiry token).
5. Get the latest run ID:
   ```
   curl -sS -H "Authorization: Bearer <PAT>" \
     "https://api.github.com/repos/varutyunov/carfactory-daily-report/actions/workflows/<name>.yml/runs?per_page=1"
   ```
6. Poll `/actions/runs/{id}` until `status == completed`. Typical probe: 20-40s. Runs are charged — don't let them loop.
7. Fetch logs via `/actions/jobs/{id}/logs` (text). Secrets are masked as `***` — safe to grep/share.
8. **Delete the probe script + workflow once done.** Leaving them around leaks intent in the repo history; commit a deletion in the same session.

Why this beats Chrome MCP for authenticated external sites:
- The target's IP blocks often don't apply to GitHub Actions runners.
- No credential paste anywhere — secrets stay in GitHub.
- Reproducible: each run is a clean ephemeral env. No browser state drift.
- Parallel-safe. Multiple probes can fire side-by-side.

Use Chrome MCP only for tasks that must stay in the user's authenticated browser session (e.g. Supabase SQL Editor DDL below, where the user's existing session is the credential).

## Supabase DDL / Schema Changes

**Problem:** The anon key stored in `supabase_keys.txt` (and used everywhere in the app) is a PostgREST-limited key. It can do CRUD but **cannot run DDL** (`ALTER TABLE`, `CREATE TABLE`, etc.). No SQL-executing RPC exists in this project. The service-role key is deliberately not in the repo.

**Default solution — browser automation via `mcp__Claude_in_Chrome`.**

When DDL is needed, **do not ask the user to run it in the dashboard manually.** Use the Chrome MCP tool to do it end-to-end:

1. Navigate the user's browser to `https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/sql/new` (the SQL Editor — the user is already authenticated on their browser session).
2. Wait ~5s for Monaco to load.
3. Click into the editor, `Ctrl+A` to select any existing text, type the SQL, click the **Run** button (ref for "Run" element).
4. Read the results panel to confirm "Success. No rows returned" or similar.
5. Verify via PostgREST: query the table for the new column to confirm the cache refreshed.

**Do NOT** try to extract the service_role key via JavaScript / `javascript_tool` — JWT-shaped strings are actively blocked from being returned by the MCP layer (correct safety behavior). It's also unnecessary: the SQL Editor runs inside the already-authenticated session.

**If browser automation isn't available in this session**, fall back to: open the SQL Editor URL via `start ""` on Windows, give the user the exact SQL to paste, wait for them to confirm. Don't try to hack around it with notes-field prefixes or other schema-less workarounds — the DDL is 30 seconds of work once someone can run it.

## Safe Editing Mechanics

1. **Use surgical edits.** Target the smallest possible block. Never replace an entire function just to change a few lines inside it.
2. **Never replace across function boundaries.** If your `old_string` spans from inside one function into another, you risk deleting everything between them.
3. **The version.json merge is safe.** `git fetch origin main && git merge origin/main --no-edit` only changes `version.json`. It does NOT overwrite `index.html`. If code is missing after a push cycle, the edit — not the merge — deleted it.

## Deploy Checklist
1. Make changes in worktree
2. Test in preview (mobile viewport)
3. Copy files to main repo: `cp worktree/index.html /c/Users/Vlad/Desktop/carfactory/`
4. Bump `sw.js` cache version
5. `git add`, `git commit`, then push from main repo
6. `git fetch origin main && git merge origin/main --no-edit && git push`

The pre-push git hook (`scripts/validate-features.sh`) runs automatically and blocks the push if any protected feature is missing.

## PROTECTED FEATURES — NEVER DELETE
These are built, working, and must survive every future change. `scripts/validate-features.sh` enforces this on every push.

### Deposit Payment Tracking
- **Method badge:** `_payMethodBadge(method)` — styled badge for cash/card/zelle/m.o.
- **Forms detail:** `openFormDetail` includes `#form-dep-method` div that async-loads payment method from `payments` table (matches by customer name + amount)
- **Forms edit:** `formDepEditMethod(payId)`, `formDepRenderMethodEdit`, `formDepCancelMethodEdit`, `formDepSaveMethod` — inline method editor in deposit detail
- **Module vars:** `_formDepMethodPayId`, `_formDepMethodRows[]`
- **Payments detail:** `payViewDetail` shows "Paid With" + TAP TO EDIT for deposits (owner only), "Method" for regular payments
- **Payments edit:** `payEditDepMethod(id)`, `payRenderDepMethodEdit`, `paySaveDepMethod` — inline method editor in weekly payments detail
- **Module vars:** `_payEditDepMethodId`, `_payDepMethodRows[]`
- **Auto-post:** Deposits auto-post to weekly payments on save (no manual toggle). Method string built from `_depPayments` array.
- **Deposit-deal matching:** `_buildDealFullCashMap` builds `_payDealDepositMap` matching deposit cash to deals by VIN → vehicle desc → customer name. `_getDealFullCash` subtracts prior deposit cash from deal cash for net cash calculation.

### E-Sign System (Legal electronic signatures via ESIGN Act / UETA)
- **Library:** `signature_pad@4.1.7` — loaded in `<head>` scripts
- **Overlay:** `#esign-overlay` with `#esign-status-preparing`, `#esign-status-ready`, `#esign-status-sent`
- **UI entry points (DELETED TWICE — keep all three):** purple "✍️ Send for E-Sign" buttons, one each in
  - `openFormDetail` (deposit detail) → `onclick="esignOpen('deposit')"`
  - `openInvoiceDetail` (invoice detail) → `onclick="esignOpen('invoice')"`
  - Void/Release Step 2 form → `onclick="esignOpen('void_release')"`
  All three are enforced by `scripts/validate-features.sh`. Do NOT remove or "consolidate" these buttons — they are the only way users can start the e-sign flow for a fresh record (`_buildEsignSection` returns empty when `esign_status` is null, so without these buttons there is no way in).
- **Send flow:** `esignOpen`, `esignClose`, `esignCreateRequest`, `esignCopyLink`, `esignSendSMS`, `esignSendEmail`, `esignShare`
- **Polling:** `_esignStartPolling`, `_esignStopPolling`, `_esignPollCheck`, `_esignResumePolling`
- **After customer signs:** `_esignShowSignedAlert` (green banner + vibrate), `_esignOpenCounterSign` (navigate to detail)
- **Counter-sign pad:** `_buildEsignSection`, `_initCounterSignPad`, `_clearCounterSign`, `_submitCounterSign`
- **Completion:** `_showCompletedReview`, `_viewSignedForm`, `_completeAndClose`, `_resolveEsignSigUrl`
- **Supabase table:** `esign_requests` (form_type, form_record_id, form_html, status, signed_at, auth_certificate)
- **Signing page:** `sign.html` at `carfactory.work/sign.html?token=`

### Forms System (Deposits / Invoices / Void-Release)
- **Overlay:** `#forms-overlay` with inner tabs: Deposits · Invoices · Void/Release
- **Deposit detail:** `openFormDetail` — includes e-sign section
- **Invoice detail:** `openInvoiceDetail` — tappable list items, includes e-sign section
- **Void/Release list:** `loadVoidRelease` + `renderVRList` — loads real records from Supabase, tappable
- **Void/Release detail:** `openVRDetail` — includes e-sign section + counter-sign pad
- **Delete:** `formDeleteConfirm` + `formDeleteFinal` (also removes linked esign_requests)

### Void/Release Form
- **Overlay:** `#vr-overlay`
- **Middle name field:** `#vr-mname` — sits between first and last name in Step 1
- **Vehicle search:** `vrLoadVehicles` queries inventory + deposits + **deals (last 200)**
- **Preview:** `vrGoPreview` — builds full name from `[fname, mname, lname].filter(Boolean).join(' ')`
- **Save flow:** `vrSignedFormTaken` (enables save btn) → `vrSave` (uploads signed photo → Supabase)
- **E-sign button:** in Step 2, triggers `esignOpen('void_release')`

### Sheets Tab (Inventory + Deals26)
- **Overlay:** `#inv-sheets-overlay` — two sub-tabs: Inventory and Deals26
- **Inventory tab:** Card-based layout showing per-car costs (purchase cost, joint expenses, vlad expenses, total). Clickable Joint/Vlad amounts open expense breakdown popups (`isShowExpPopup`) that read itemized notes from `expense_notes` / `vlad_expense_notes` columns. Location filter (DeBary/DeLand). Edit/save via `isEditOpen`/`isEditSave`. Link to inventory cars via `isLinkOpen`/`isLinkSave`.
- **Deals26 tab:** Deal financials with week grouping. Expenses/payments breakdown popups (`d26ShowExpPopup`, `d26ShowPmtPopup`). Edit via `d26Edit`/`d26Save`.
- **Data source:** `inventory_costs` and `deals26` Supabase tables
- **Sort:** By `sort_order` column (matches Google Sheet row position)
- **Key vars:** `_isData`, `_isLoc`, `_isEditIdx`, `_isLinkIdx`, `_shPageIdx`, `_d26Data`, `_d26EditIdx`

### Google Sheets Two-Way Sync
- **Sheet IDs:** DeBary `1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE`, DeLand `1pNF6h9AX5MQsNoT-UxvrAOaT-7lulvGiWd_oTFkqyzM`
- **Architecture:** Google Apps Script (container-bound) ↔ Supabase REST API (direct, no Netlify middleman)
- **Sheet → Supabase:** Apps Script `onEdit` trigger detects changes → calls Supabase REST API directly to upsert rows (matched by `sort_order + location`)
- **App → Sheet:** `sheetsPush(tab, rowIndex, data)` function in index.html calls the Apps Script web app URL to write changes back to the sheet
- **Apps Script URL:** Hardcoded in `sheetsPush` function (container-bound, deployed as web app)
- **Sheet is master.** The 5-min `syncFullReconcile` trigger reads the sheet as source of truth and updates Supabase to match. Supabase is effectively a cache for the app to read quickly.
- **Reconciler matching keys (April 2026 fix):** normalized (trim + lowercase) for all tables; Deals26 uses compound key `car_desc + deal_num` so multiple deals on the same car across different weeks stay distinct rather than collapsing. Inventory uses `car_name + location`.
- **Reconciler self-heals DB duplicates:** when multiple DB rows share a normalized key, keep one (prefer `car_id` set → most recent `updated_at`) and delete the rest.
- **Reconciler dedupes insert path:** after an INSERT the reconciler registers the new row in its in-memory `dbByName` so the next sheet row with the same normalized key UPDATEs instead of re-inserting.
- **`delete` action has name-safety:** when the app pushes a delete, it passes the expected `car_name`/`car_desc` in `data`. Apps Script verifies the sheet row's name matches before calling `sheet.deleteRow(targetRow)`. If sort_order drifted, it scans ±20 rows for the expected name; on mismatch, it refuses with `{ok:false, error:'name_mismatch'}`. Protects against wrong-row deletes.
- **Conflict prevention:** 5-second `_syncLockTime` property — after an app→sheet write, `onSheetEdit` skips for 5s to prevent feedback loops.

### Trade-In Payment Method
- **Payment option:** `trade_in` added to all 6 payment method dropdowns (deal upload, deal edit, deposit forms)
- **Vehicle fields:** When "Trade-In" selected, expands year/make/model/color/miles inputs
- **Stored in JSON:** `{method:'trade_in', amount, trade_year, trade_make, trade_model, trade_color, trade_miles}`
- **Display:** Purple badge (`#a855f7`), vehicle details shown in deal detail view
- **Auto-creates inventory:** `_createTradeInCar()` creates `inventory` + `inventory_costs` rows (short name + "trade" suffix, linked via `car_id`, inserts before Total row)

### Deals26 Auto-Populate (from deal upload)
- **On deal submit:** `_autopopulateDeals26(record, car)` creates deals26 row with: car_desc (inventory_costs.car_name + customer last name), cost, expenses, money (total_collected), dealer_fee=$399, deal_num (auto-incremented), gps_sold, sold_inv_vin
- **`sort_order` + `deal_num` MUST be location-filtered** when computing — the DB queries in `_autopopulateDeals26` filter by `record.location`. Without the filter, DeBary's sort_order was being offset by DeLand's row count, pushing entries into blank rows past the current week (April 2026 fix).
- **Column G (payments) stays blank for new deal uploads.** `_autopopulateDeals26` explicitly drops `payments` + `payment_notes` from the sheet payload (Supabase still stores 0 by default). Vlad enters payments manually in the sheet. Do NOT re-add blanket clearContent logic to Apps Script — it wipes user-entered values on other save paths.
- **Auto-delete sold car from inventory_costs:** After inserting the deals26 row, the function deletes the linked `inventory_costs` row (Supabase + sheet) so the sold car is transferred out of the Inventory tab.
- **Expense notes merge with newlines:** joint + vlad expense notes combined with `\n` separator to match Google Sheets cell-note format.
- **On deal edit:** `_updateDeals26FromDeal()` updates money/gps if deal is edited. Finds existing row by `sold_inv_vin`; creates via `_autopopulateDeals26` if no match.
- **Tax lookup:** Fetches `PendingSalesDebary.csv` / `PendingSalesDeland.csv` from GitHub, matches by VIN, pulls salestax + tagfee + titlefee.
- **Periodic tax fill:** `_fillMissingTaxes()` runs every 30 min + on page load. Retries until CSV has the data.

### Inventory Auto-Create (CSV Sync → Review → App Sheets)
- **v592 (Apr 25, 2026): everything goes through Review now — same as payments.** No direct sheet writes from CSV sync or `+ ADD`.
- **On CSV sync:** `_autoCreateInventoryCosts(insertedRows)` builds the short car_name + draft IC payload and calls `_queueInventoryAddReview(icDraft, 'csv-sync')`. That POSTs a `payment_reviews` row with `reason='inv_create_pending'`, `status='pending'`, `snapshot.ic = {car_name, car_id, purchase_cost, joint_expenses, vlad_expenses, expense_notes, vlad_expense_notes, location, source}`. Dedupes by car_id, then by `car_name + location` against pending reviews.
- **On lot move:** `_relocateInventoryCosts` detects when the CSV reports a vehicle in a different location than its IC row; queues `payment_reviews` row with `reason='inv_relocate_pending'`, `snapshot.move = {ic_id, car_name, oldLoc, newLoc, car_id}`.
- **On manual + ADD:** `invSheetsAddCar(name)` queues `inv_create_pending` (source `'manual'`); user gets an alert "queued for review."
- **Approve handlers:** in `_reviewApprovePending`, BEFORE the `if (!r.deal_id)` deal-only branch:
  - `inv_create_pending` → `_executeInventoryAdd(icDraft)` computes sort_order from this lot's Total row, creates IC row in Supabase (deduping by car_id and name+location), calls `sheetsPush('insert', sort_order, …)` to write the row before Total, bumps Total's sort_order. Rolls back IC row on sheet failure.
  - `inv_relocate_pending` → `_executeRelocate(move)` re-fetches live IC row, deletes from old sheet, computes new sort_order from new lot's Total, PATCHes Supabase, calls `sheetsPush('insert', …)` for new sheet, bumps new Total, decrements old-loc sort_orders.
- **Review cards:** `_reviewRender` has two new branches before the "Payment review cards" section. `inv_create_pending` is a blue card "New inventory → DeBary/DeLand Sheet" with car_name, location, source, cost. `inv_relocate_pending` is a purple card "Lot move → DeLand/DeBary Sheet" with car_name, oldLoc → newLoc, cost.
- **Why this changed:** Standing rule from 2026-04-24 — nothing posts to Google Sheets without Vlad's tap. Inventory adds and lot moves were the last auto-posters.

### Inventory Master CSV Promotion Pipeline
- **Source:** Dealer software exports timestamped CSVs to `Inventory/DeBary/InventoryMaster YYYYMMDDHHmm-Company-33532001.csv` and `Inventory/Deland/InventoryMaster YYYYMMDDHHmm-Company-33532002.csv`.
- **Promotion:** `.github/workflows/inventory-master-sync.yml` runs on push to `Inventory/**/*.csv` (or workflow_dispatch). It picks the newest filename per location, copies to root `InventoryMaster.csv` / `InventoryMasterDeland.csv`, commits as `github-actions[bot]`, pushes to BOTH `main` and `master` so dual-branch deploy stays in sync. Mirrors `pending-sales-sync.yml` exactly.
- **Downstream effects of root-CSV change (chain):**
  1. Push to `InventoryMaster*.csv` triggers `inventory-sync.yml` → runs `scripts/inventory-sync.js` → updates Supabase `inventory` table (insert new VINs, patch location/miles/color, soft-delete sold).
  2. App fetches root CSVs via `raw.githubusercontent.com/varutyunov/carfactory-daily-report/main/InventoryMaster*.csv` on next open → `_autoCreateInventoryCosts` and `_relocateInventoryCosts` queue `inv_create_pending` / `inv_relocate_pending` reviews.
  3. Vlad approves in Review tab → IC row created + sheet row inserted (or relocated).
- **`inventory-sync.yml` schedule:** cron `30 12,14,16,18,20,22,0 * * 1-6` (UTC, Mon–Sat). On push it also re-runs.

### Expense / Payment Popup Parsing
- **Popups:** `isShowExpPopup` (inventory Joint/Vlad), `d26ShowExpPopup` (deals26 expenses), `d26ShowPmtPopup` (deals26 payments).
- **Separator:** Google Sheets cell notes use NEWLINES. Parser splits on `/\r?\n|,/` (newline OR comma for backward compat). Saves write with `\n` only so sheet ↔ app round-trips cleanly.
- **Regex:** `/^\$?(\d+(?:\.\d+)?)\s*(.*)$/` — accepts optional `$` prefix (existing notes like `"$150 Perry"`) and amount-only lines (like `"582"`). Older regex required a description; that landed `$`-prefixed and amount-only entries in the description slot with no amount.
- **Remainder row:** if the sum of the parsed items is less than the stored column total (e.g. cell says $592 but note only itemizes $10), the popup appends an unnamed row for the difference so the popup total always matches the Sheets Inventory / Deals26 table value. Save paths emit no trailing space when description is empty.

### Apps Script Auto-Deploy
- **Deploy script:** `python scripts/deploy-apps-script.py "description"` — pushes code + creates version + updates deployment
- **OAuth credentials:** `scripts/.google-credentials.json` + `scripts/.google-token.json` (both in .gitignore)
- **Features deployed:** Car color coding on column B, currency formatting ($#,##0), week separator borders (deal_num=1), column F formula (copies from row above), column G skip when payments=0 (leaves whatever's there — do NOT `clearContent` globally, it wiped data once), delete-action name verification (refuses + offers ±20-row scan), reconciler with normalized keys + compound keys for Deals26 + DB dupe healing, error logging on all Supabase calls

## Recent Work (April 2026)

### Completed
- **Sheets tab restored** from git history (~700 lines) with both Inventory and Deals26 sub-tabs
- **Google Sheets two-way sync** — removed Netlify dependency, syncs directly via Supabase REST + Apps Script
- **Inventory Sheets redesigned** — switched from table to card layout with clickable expense popups
- **Expense breakdown popups** — Joint/Vlad amounts are clickable, show itemized expenses from cell notes
- **Sort by sheet position** — inventory sorted by `sort_order` matching Google Sheet row order
- **Payment vehicle search** — added vehicle search to payment form (inventory + past deals)
- **Customer auto-fill** — selecting a past deal auto-fills customer name in payments
- **Deal type toggle** — Finance vs Purchased in Full in deal edit
- **Deposit form save fix** — removed `payment_method` column (doesn't exist in deposits table)
- **Deposit-deal matching** — VIN → vehicle desc → customer name fuzzy matching for net cash
- **Owner payment posting** — owners can post payments like employees
- **Trade-In payment method** — new payment type with vehicle detail fields + auto inventory creation
- **Deals26 auto-populate** — deals auto-create deals26 rows with cost/expenses/taxes from inventory_costs + Pending Sales CSV
- **Inventory auto-create from CSV** — new cars from InventoryMaster sync auto-create inventory_costs rows
- **Apps Script deploy pipeline** — automated deployment from CLI, no manual pasting
- **Sheets tab layout swap** — DeBary/DeLand small tabs on top, Inventory/Deals26 big buttons below

### Completed — April 20, 2026 (Sync fix day)
- **inventory_costs duplicate cleanup (DeBary):** 8 duplicate rows across 3 groups (Accord, Forte, Tundra) removed from Supabase; car_id re-linked to correct inventory rows (Forte had been pointing at a Camry).
- **Auto-delete sold car from inventory_costs:** `_autopopulateDeals26` now removes the sold car's `inventory_costs` row (Supabase + Google Sheet) after creating the Deals26 entry — completes the transfer from Inventory tab to Deals26.
- **Apps Script `delete` action name safety:** verifies `car_name`/`car_desc` matches the sheet row before deleting; scans ±20 rows if `sort_order` drifted; refuses on mismatch.
- **Reconciler hardening:** normalized match keys (trim+lowercase); Deals26 uses compound key `car_desc + deal_num`; self-heals in-DB duplicates; updates in-memory `dbByName` after INSERT so duplicate-named sheet rows don't cause re-inserts.
- **`_autoCreateInventoryCosts` dedupe:** checks for existing `car_name + location` before POSTing, prevents orphan duplicates when CSV sync reassigns `inventory.id`.
- **`invSheetsAddCar` dedupe:** same check, offers to open existing row.
- **Expense/payment popup parser fixes:** split on newline OR comma; accept `$` prefix; amount-only items parse; add remainder row when item sum < stored total. Saves write with newlines to match sheet format.
- **`_autopopulateDeals26` location-filter fix:** `sort_order` and `deal_num` queries now filter by `record.location`. Previously used combined count across DeBary+DeLand, which pushed DeBary writes past the current week (3 DeBary deals landed at rows 177-179 instead of 122-124).
- **Column G blank for new deal uploads:** `_autopopulateDeals26` drops `payments`/`payment_notes` from the sheet payload; column G stays untouched on the new row.
- **Backfill cleanup:** retroactively removed 17 already-sold cars from `inventory_costs` (Supabase + sheet) via new `scripts/cleanup-sold-inventory-costs.py`.
- **Deals ↔ Deals26 alignment:** 12 previously-unlinked deals got their `sold_inv_vin` populated; 5 money mismatches resolved (including card-fee adjustments); 1 duplicate removed (Celeste Johnson); Linsey Solano renumbered; 3 orphan sheet rows moved back to correct week position.
- **Helper script:** `scripts/cleanup-sold-inventory-costs.py` — idempotent, dry-run by default, `--apply` to execute.
- **Apps Script versions shipped:** v38 (reconciler + delete safety), v39 (reverted), v40 (current — skip-only column G). Cache bumps v491 → v496.

### Known Issues / Gotchas
- `deposits` table has NO `payment_method` column — payment method is tracked in the `payments` table instead (via auto-posted deposit payment)
- `deposits` table uses `balance` (NOT `remaining_balance`) for the remaining balance column
- Service worker cache must be bumped (`sw.js`) on every deploy or changes won't show on phones
- `git push` often needs `git fetch origin main && git merge origin/main --no-edit` first (version.json conflicts)
- **Deals26 sheet has a gap:** DeBary's Deals26 tab has a ~55-row empty stretch between rows 122-176. The contiguous deals historically fill up through row ~121, then recent auto-populated deals were landing past this gap (fixed April 2026). `read_all` returns `_sheetRow` (absolute) and `_rowIndex` (relative to data-having rows) — always trust `_rowIndex` / `sort_order` not the visual row number.
- **Google Sheets cell notes use `\n` separators, NOT commas.** Any parser that splits on comma alone will show only the first line item. Fixed across all expense/payment popups in April 2026.
- **`sort_order` collisions are real.** Legacy `inventory_costs` dupes had 2-3 rows sharing the same sort_order. The Apps Script `onSheetEdit` PATCH filters by `sort_order + location`; if multiple DB rows match, all get patched. Reconciler cleanup (April 2026) removed these, and new dedupe checks in `_autoCreateInventoryCosts` / `invSheetsAddCar` prevent new ones.
- **Reconciler only runs every 5 min.** Between runs, `sort_order` in DB can drift from actual sheet position (if rows shifted). `onSheetEdit` PATCHes by `sort_order + location` which will hit the wrong DB row until the next reconcile. Most edits settle correctly within the 5-min window.
- **Sheet writes via `sheetsPush` use `sort_order` as `row_index`, not visual sheet row.** `targetRow = startRow + rowIndex - 1`. For sheets with gaps, `row_index` counts hasData positions, not raw row numbers — always read the live sheet first if you need an exact row (use the `read_all` action and pick `_rowIndex`).
- **The Apps Script `update` action writes only the fields in `data`** — other columns are untouched. Skipping a field (e.g. dropping `payments` from the payload) leaves the cell alone; this is the correct way to "don't touch column G" for new deal uploads. Do NOT add blanket `clearContent` to Apps Script — it nuked 97 rows' column G on April 20, 2026.
- **When doing data repairs, ALWAYS read the live state first.** The DB `sort_order` can be stale relative to the sheet; writing to `row_index=X` will hit a different row than you expect if the sheet has been restructured. Use `action:read_all` to resolve the current `_rowIndex` before any targeted write or delete.
