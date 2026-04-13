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
scripts/            — Sync scripts (carpay-sync, gps-sync, inventory-sync)
netlify/functions/  — Serverless (ai-proxy.js, telegram-webhook.js)
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
| `deposits` | Vehicle intake forms (customer, vehicle, deposit amounts) |
| `invoices` | Service invoices with line items |
| `notifications` | In-app notifications with read status |
| `calendar_events` | Work calendar events |
| `payment_deletions` | Audit log of deleted payments |
| `carpay_customers` | CarPay external customer sync |
| `carpay_payments` | CarPay external payment sync |
| `app_settings` | Key-value config store (net deal adjustments, etc.) |
| `repo_gps_signals` | GPS tracking data |

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

**Why this matters:** This is a 27k-line single-file app. A single overly broad Edit can silently delete dozens of functions. The user loses hours of work and trust. There is no acceptable reason to delete working code without explicit permission.

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
