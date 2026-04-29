# Car Factory - Complete Project Summary

> Last updated: 2026-04-18
> Written for: The next Claude session that has never seen this project

---

## WHAT THE APP IS

Car Factory is a **single-page Progressive Web App (PWA)** for a used car dealership with two locations: **DeBary** (primary) and **DeLand** (secondary), both in Florida. Everything lives in one `index.html` file (~27,000 lines). No framework - vanilla JS, inline CSS, no build step.

### Who Uses It
- **Vlad** (owner) - full access, primary user, uses it on iPhone as a standalone PWA
- **Tommy** (owner) - full access
- **Ricky, Scott, Manny** - DeBary employees
- **Jesse** - DeLand employee
- **Dennis** - DeBary employee (payroll only)

### What It Does
- Manages vehicle inventory across two lots
- Assigns work (detail, photos, parts, repair, paint) to employees
- Tracks sales deals (finance and cash)
- Records and categorizes payments (cash/card/check/zelle/trade-in)
- Calculates payroll and net cash per location per week
- Scans receipts via OCR (Google Gemini Vision)
- Syncs with CarPay (external payment processor)
- Registers GPS devices with Passtime OASIS
- Sends push notifications via OneSignal
- Provides an AI voice assistant (Claude)
- Generates invoices, deposit forms, and void/release forms
- E-sign system for legal electronic signatures (ESIGN Act / UETA)
- Two-way Google Sheets sync for inventory costs and deal financials (both locations)

### Roles
| Role | Access |
|------|--------|
| `manager` | Full access: inventory, assignments, deals, payments, payroll, all settings |
| `employee` | Own tasks only, can view inventory, upload photos, submit work |
| Owner (Vlad/Tommy) | Everything managers get + AI chat, CarPay, payroll editing, net cash adjustments |

---

## TECH STACK & ARCHITECTURE

### Stack
- **Frontend:** Vanilla JS + HTML + inline CSS in `index.html`
- **Backend:** Supabase (Postgres DB + file storage)
- **Hosting:** GitHub Pages at https://carfactory.work
- **Serverless:** Netlify Functions (`/ai-proxy` for Claude, `/telegram-webhook`)
- **Push:** OneSignal SDK
- **OCR:** Google Gemini 2.5 Flash (with fallback to gemini-2.5-flash-lite)
- **AI:** Claude API via Netlify proxy + Web Speech API for voice
- **Automation:** GitHub Actions (inventory sync, CarPay sync, GPS registration)
- **Google Sheets Sync:** Apps Script (container-bound) ↔ Supabase REST API (direct, no Netlify middleman)
- **External Systems:** CarPay dealers portal, Passtime OASIS GPS, Telegram Bot

### How The App Loads
1. User opens https://carfactory.work on iPhone (standalone PWA)
2. Service worker intercepts - HTML always fetched from network, static assets cached
3. Login screen shows - user enters username + 4-digit PIN (or Face ID)
4. Session stored in `localStorage` as `cf_session`
5. `syncFromSupabase()` pulls all data (employees, inventory, assignments, notifications)
6. Manager home screen shows orbit tiles (inventory, tasks, repairs, etc.)

---

## FILE STRUCTURE

```
Root Files:
  index.html                    - THE app (all HTML + CSS + JS, ~27,000 lines)
  sw.js                         - Service worker (cache v475, push, badge)
  manifest.json                 - PWA manifest (standalone, icons)
  version.json                  - Auto-generated timestamp for cache busting
  netlify.toml                  - Netlify config
  CNAME                         - DNS pointing to carfactory.work
  CLAUDE.md                     - Project brain / instructions for Claude
  sign.html                     - E-sign customer signing page (carfactory.work/sign.html?token=)
  google-apps-script.js         - Container-bound Apps Script for Google Sheets two-way sync
  package.json                  - Node deps (Playwright, Bun)

Icons & Placeholders:
  icon.png / icon-192.png / icon-512.png  - App icons
  apple-touch-icon.png                     - iOS icon
  stock-coupe/sedan/truck/van.png          - Placeholder vehicle images

Inventory & Sales CSVs:
  InventoryMaster.csv           - DeBary inventory (from dealer system)
  InventoryMasterDeLand.csv     - DeLand inventory
  PendingSalesDebary.csv        - DeBary pending sales (taxes, fees from Wayne Reaves)
  PendingSalesDeland.csv        - DeLand pending sales (taxes, fees from Wayne Reaves)
  Sold Inventory.csv            - DeBary sold vehicles
  Sold Inventory Deland.csv     - DeLand sold vehicles
  SoldInventoryDeBary.csv       - DeBary sold (alternate format)
  SoldInventoryDeLand.csv       - DeLand sold (alternate format)

Scripts (/scripts/):
  inventory-sync.js             - CSV to Supabase inventory sync
  carpay-sync.js                - CarPay web scraper (GitHub Actions)
  carpay-bookmarklet.js         - CarPay manual sync (run in browser console)
  gps-sync.js                   - Passtime OASIS GPS registration (Playwright)
  gps-bookmarklet.js            - GPS manual sync (run in Passtime browser)
  deploy-apps-script.py         - Automated Apps Script deployment (OAuth2)
  remote-control.bat            - Remote control script

Netlify Functions (/netlify/functions/):
  ai-proxy.js                   - CORS proxy for Claude API
  telegram-webhook.js           - Telegram bot webhook handler

GitHub Actions (/.github/workflows/):
  deploy.yml                    - Auto-deploy to GitHub Pages on push to main
  version.yml                   - Auto-generate version.json timestamp
  carpay-sync.yml               - CarPay sync every 2 hours (Mon-Sat 8am-8pm ET)
  gps-sync.yml                  - GPS registration daily at 9am ET
  inventory-sync.yml            - Inventory sync on CSV change or every 2 hours
```

---

## SUPABASE TABLES

### `employees`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| name | text | Display name |
| username | text | Login username |
| pin | text | 4-digit PIN |
| role | text | 'manager' or 'employee' |
| location | text | 'DeBary' or 'DeLand' |

### `inventory`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| name | text | "Year Make Model" display string |
| stock | text | Stock number |
| vin | text | VIN |
| location | text | 'DeBary' or 'DeLand' |
| color | text | Exterior color |
| miles | text | Mileage |
| photo | text | Primary photo URL |
| work | jsonb | Work state tracking per category |

### `inventory_costs`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| car_name | text | Short name (e.g. "13 Soul grey 69k") |
| car_id | int | FK to inventory (nullable, linked when auto-created) |
| purchase_cost | numeric | What we paid |
| joint_expenses | numeric | Joint expenses total |
| vlad_expenses | numeric | Vlad-only expenses total |
| expense_notes | text | Itemized joint expense breakdown |
| vlad_expense_notes | text | Itemized vlad expense breakdown |
| location | text | 'DeBary' or 'DeLand' |
| sort_order | int | Matches Google Sheet row position |

### `deals26`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| car_desc | text | Car name + customer last name |
| cost | numeric | Purchase cost |
| expenses | numeric | Joint + vlad expenses |
| expense_notes | text | Expense breakdown |
| taxes | numeric | salestax + tagfee + titlefee |
| money | numeric | Total collected |
| owed | numeric | Formula: money - cost - expenses - taxes - dealer_fee |
| payments | numeric | Payments received |
| payment_notes | text | Payment breakdown |
| dealer_fee | numeric | Doc fee ($399) |
| manny | numeric | Commission (Manny for DeBary, Jesse for DeLand) |
| deal_num | int | Deal number within week (1 = first of week) |
| gps_sold | boolean | GPS device sold with vehicle |
| sold_inv_vin | text | VIN linking to deals table |
| location | text | 'DeBary' or 'DeLand' |
| sort_order | int | Matches Google Sheet row position |

### `deals`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| customer_name | text | Buyer name |
| vehicle_desc | text | "Year Make Model" |
| vin | text | Vehicle VIN |
| deal_type | text | 'finance' or 'cash' |
| total_collected | numeric | Total amount |
| payments | jsonb | Payment breakdown array |
| gps_serial | text | GPS device serial (finance deals) |
| photo_urls | text[] | Deal document photos |
| location | text | 'DeBary' or 'DeLand' |
| created_by | text | Who created the deal |

### `payments`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| customer_name | text | |
| vehicle_year/make/model/vin/color | text | Vehicle details |
| amount | text | Payment amount (stored with $ formatting) |
| payment_method | text | 'cash', 'card', 'check', 'zelle', 'money_order', 'trade_in' |
| payment_date | text | |
| payment_time | text | |
| week_start | text | Week bucket (YYYY-MM-DD) |
| raw_ocr_text | text | OCR text or "Deal — ..." for deal payments, "Deposit — ..." for deposits |
| location | text | |
| receipt_photo_url | text | Receipt photo |
| card_fee_added | boolean | 4% card fee included |
| original_amount | text | Pre-fee amount |
| is_final_payment | boolean | |
| notes | text | |
| logged_by | text | |
| delete_requested | boolean | |
| delete_requested_by | text | |

### `deposits`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| customer_name | text | |
| vehicle_desc | text | |
| vin | text | |
| deposit_amount | numeric | |
| balance | numeric | Remaining balance (**NOT** `remaining_balance`) |
| deposit_date | text | |
| location | text | |
| deal_type | text | |
| esign_status | text | |
| esign_signature_url | text | |
| seller_signature_url | text | |
| **NOTE:** NO `payment_method` column — method tracked in `payments` table via auto-posted deposit payment |

### `esign_requests`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| form_type | text | 'deposit', 'invoice', 'void_release' |
| form_record_id | int | FK to the form's table |
| form_html | text | Full HTML of the form to sign |
| status | text | 'pending', 'signed', 'completed' |
| signed_at | timestamp | |
| auth_certificate | jsonb | Signing authentication details |

### `invoices`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| customer_name | text | |
| vehicle_desc | text | |
| items | jsonb | Line items array (description + price) |
| total | numeric | |
| location | text | |

### `void_releases`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| customer name/vehicle fields | text | |
| signed_form_url | text | Signed photo upload |
| location | text | |

### `cash_payouts`
| Column | Type | Purpose |
|--------|------|---------|
| id | int | Primary key |
| paid_to | text | Employee name |
| amount | numeric | Payout amount |
| week_start | text | Week bucket |
| location | text | |

### `app_settings`
| Column | Type | Purpose |
|--------|------|---------|
| key | text | e.g. `cf_netdeal_{weekKey}_{location}` |
| value | jsonb | |

### `notifications`, `calendar_events`, `payment_deletions`, `carpay_customers`, `carpay_payments`, `repo_gps_signals`
See CLAUDE.md for full column details.

### Supabase Storage
- **Bucket:** `car-photos/` (private, requires signed URLs via `sbSignUrl()`)

---

## GOOGLE SHEETS TWO-WAY SYNC

### Architecture
- **Sheet → Supabase:** Apps Script `onEdit` trigger + 5-min reconciler (`syncFullReconcile`). Google Sheet is source of truth.
- **App → Sheet:** Instant via `sheetsPush(tab, rowIndex, data, action, location)` on every save. Fire-and-forget.
- **No Netlify middleman:** Apps Script talks directly to Supabase REST API. App talks directly to Apps Script web app URL.
- **Apps Script deploy:** Automated via `python scripts/deploy-apps-script.py "description"`. OAuth token at `scripts/.google-token.json`.

### Google Sheets
| Location | Sheet ID | Tabs |
|----------|----------|------|
| DeBary | `1eUXKqWP_I_ysXZUDDhNLvWgPxOcqd_bsFKrD3p9chVE` | Inventory, Deals26 |
| DeLand | `1pNF6h9AX5MQsNoT-UxvrAOaT-7lulvGiWd_oTFkqyzM` | Inventory, Deals26 |

### Inventory Tab Layout
- **DeBary startRow:** 20 | **DeLand startRow:** 17
- **Columns:** G=purchase_cost, H=car_name, I=joint_expenses, J=vlad_expenses, K=total (formula)
- **Total row:** Last data row, green background, SUM formulas

### Deals26 Tab Layout
- **startRow:** 2 (both locations)
- **Columns:** A=cost, B=car_desc, C=expenses, D=taxes, E=money, F=owed (FORMULA), G=payments (LEFT EMPTY for manual), H=dealer_fee, I=manny/jesse, J=deal_num, K=gps_sold
- **Column K:** Always red background (indicates deal not registered yet)
- **Cell notes:** C=expense_notes, G=payment_notes
- **Week grouping:** deal_num resets to 1 at start of each week. Thick top border on deal_num=1.
- **Column B:** Car color coding — background matches car color in description

### Apps Script Features
- Car color coding on column B
- Currency formatting ($#,##0) on all numeric columns
- Week separator borders (thick top border when deal_num=1)
- Column F formula (copies from row above — profit/breakeven calculation)
- Column G skip (doesn't write payments=0, leaves empty for manual entry)
- Column K red background (unregistered deal indicator)
- Total row protection with SUM formulas
- Error logging on all Supabase calls
- Multi-location support (DeBary + DeLand spreadsheets)

### Deals26 Auto-Populate (from deal upload)
- **Trigger:** `dealSubmit()` calls `_autopopulateDeals26(record, car)`
- **Fields pulled:** car_desc (inventory_costs.car_name + customer last name), cost, expenses, money (total_collected), dealer_fee ($399), gps_sold, deal_num (auto-incremented)
- **Tax lookup:** Fetches location-specific Pending Sales CSV from GitHub (`PendingSalesDebary.csv` or `PendingSalesDeland.csv`), matches by VIN, pulls salestax + tagfee + titlefee
- **Periodic tax fill:** `_fillMissingTaxes()` runs every 30 min + 30 sec after load. Fetches both CSVs as needed, matches per row location.
- **Deal edit sync:** `dealEditSave()` calls `_updateDeals26FromDeal()` — updates money/gps

### Trade-In Payment Method
- Added to all 6 payment method dropdowns (deal upload, deal edit, deposit forms)
- When "Trade-In" selected: vehicle detail fields expand (year, make, model, color, miles)
- Stored in payments JSON: `{method:'trade_in', amount, trade_year, trade_make, trade_model, trade_color, trade_miles}`
- Purple badge display
- **Auto-creates inventory car:** `_createTradeInCar()` creates inventory + inventory_costs rows

### Inventory Auto-Create (CSV sync → inventory_costs)
- When `syncLocation()` inserts new cars from InventoryMaster CSV
- `_autoCreateInventoryCosts(insertedRows)` creates inventory_costs row with short name, linked via car_id
- Inserts before Total row, bumps Total's sort_order

---

## FEATURES - HOW THEY WORK END TO END

### Inventory Management
1. Dealer system exports CSV files (InventoryMaster.csv per location)
2. GitHub Actions runs `inventory-sync.js` on push or every 2 hours
3. Script parses CSV, upserts to Supabase `inventory` table (dedupe by VIN)
4. Only INSTOCK and REPO status vehicles are imported
5. App loads inventory via `syncFromSupabase()` into `S.inventory`
6. Manager views inventory grid with search, filter by location

### Sheets Tab (Inventory Costs + Deals26)
1. **Overlay:** `#inv-sheets-overlay` — DeBary/DeLand location tabs on top, Inventory/Deals26 big buttons below
2. **Inventory tab:** Card-based layout showing per-car costs. Clickable Joint/Vlad amounts open expense breakdown popups reading from cell notes.
3. **Deals26 tab:** Deal financials with week grouping. Expenses/payments breakdown popups.
4. **Sort:** By `sort_order` column (matches Google Sheet row position)
5. **Two-way sync:** Edits in app push to Google Sheet instantly, edits in Sheet sync to Supabase via reconciler

### Deals
1. Manager taps "Deals" tile on orbit page 2
2. **Step 1:** Select location + search/pick vehicle from inventory
3. **Step 2:** Enter customer name, deal type (finance/cash), GPS serial if finance
4. **Step 3:** Enter payment breakdown - split across cash/card/check/zelle/trade-in with multi-payment rows
5. Deal saved to `deals` table
6. **Auto-populate deals26:** Creates deals26 row with cost/expenses/taxes from inventory_costs + Pending Sales CSV
7. Push notification sent to all managers

### Payments
1. Manager opens Payments tile on orbit page 2
2. Views current week's payments filtered by location
3. Can add payment manually or scan receipt (OCR via Gemini 2.5 Flash)
4. **Vehicle search:** Search inventory + past deals when adding payment, auto-fill customer name
5. Payment saved to `payments` table with `week_start` tag
6. Net Cash = Total Cash - Deal Cash + Net Adjustments
7. **Deposit-deal matching:** VIN → vehicle desc → customer name fuzzy matching for net cash

### E-Sign System
1. **Library:** signature_pad@4.1.7
2. **Flow:** Create request → copy link / SMS / email → customer signs on `sign.html` → polling detects signature → counter-sign pad for seller → completion
3. **Works with:** Deposits, invoices, void/release forms
4. **Supabase table:** `esign_requests`

### Forms System (Deposits / Invoices / Void-Release)
1. **Overlay:** `#forms-overlay` with inner tabs: Deposits · Invoices · Void/Release
2. Each form type has detail view with e-sign integration
3. Void/Release includes middle name field, vehicle search (inventory + deposits + deals)
4. Delete cascades to linked esign_requests

### Payroll & Cash Payouts
1. Payroll view is a full page replacement (hides `#app`, shows as body-level div)
2. Per-employee payroll: days worked, cars, extras, total owed vs paid
3. Cash Payouts: weekly cash payout records per employee per location
4. Manny: $300/car after 5 sales (not $350)

### Push Notifications
- OneSignal SDK, targeting by employee name
- Triggers: new payment posted, new deal created
- All managers receive from both locations

### AI Voice Assistant (Factory AI)
- Owner-only (Vlad/Tommy)
- Claude Haiku via Netlify ai-proxy
- Agentic tools: search deals, payments, customers

---

## CREDENTIALS & ENDPOINTS

### Supabase
- **URL:** `https://hphlouzqlimainczuqyc.supabase.co`
- **Anon Key:** `eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhwaGxvdXpxbGltYWluY3p1cXljIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM3NjY0MTIsImV4cCI6MjA4OTM0MjQxMn0.-nmd36YCd2p_Pyt5VImN7rJk9MCLRdkyv0INmuFwAVo`

### Google Sheets Sync
- **Apps Script URL:** Hardcoded in `sheetsPush` function + `_SHEETS_URL` variable
- **Sync Secret:** `cf-sync-2026`
- **Deploy:** `python scripts/deploy-apps-script.py "description"`
- **OAuth:** `scripts/.google-credentials.json` + `scripts/.google-token.json` (both in .gitignore)

### GitHub
- **Repo:** `varutyunov/carfactory-daily-report`
- **Pages URL:** https://carfactory.work
- **Branches:** `master` (working) + `main` (deployed). Dual push refspecs configured.

### Other Services
- **OneSignal App ID:** `ff6238d8-1a7b-4415-a589-229cd4059233`
- **Google Gemini Key:** Domain-restricted to carfactory.work
- **CarPay:** DeBary Dealer ID 656, DeLand 657
- **Passtime OASIS:** Credentials in GitHub Actions secrets
- **Claude API:** Via Netlify proxy, model `claude-haiku-4-5-20251001`
- **Telegram Bot Chat ID:** `6724715083`

---

## RECENT WORK (April 2026)

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
- **DeLand Google Sheets sync** — full multi-location support for both Inventory and Deals26 tabs
- **DeLand Pending Sales tax lookup** — auto-populate and periodic tax fill use location-specific CSV (PendingSalesDeland.csv vs PendingSalesDebary.csv)
- **DeLand deals26 backfill** — 5 missing deals (Apr 9-16) backfilled with costs, taxes from Pending Sales CSV
- **Column K red background** — deployed to both locations, indicates deal not yet registered
- **Inventory transfer** — 13 Soul grey 69k + 14 Odyssey blue 206k moved from DeBary to DeLand (Supabase + both Google Sheets)
- **Payment edit save button fix** — save button was staying disabled after first successful save, blocking all subsequent edits

### Known Issues / Gotchas
- `deposits` table has NO `payment_method` column — payment method is tracked in the `payments` table instead (via auto-posted deposit payment)
- `deposits` table uses `balance` (NOT `remaining_balance`) for the remaining balance column
- Service worker cache must be bumped (`sw.js`) on every deploy or changes won't show on phones
- `git push` often needs `git fetch origin main && git merge origin/main --no-edit` first (version.json conflicts)
- Google Sheets reconciler uses Sheet as source of truth — Supabase-only changes get overwritten on next sync
- `fixTotalRow` function is hardcoded for DeBary — DeLand Total row must be managed via sync or manual push

---

## RULES & WARNINGS FOR NEXT SESSION

### Critical Rules
1. **NEVER delete working code** — insert new code, never replace blocks with existing functions
2. **Always test on mobile viewport** (375x812) — Vlad only uses iPhone
3. **Always push from main repo** (`/c/Users/Vlad/Desktop/carfactory`), never from a worktree
4. **Bump `sw.js` cache version** on every deploy (currently at v475)
5. **Every modal/overlay MUST have a back/close button**
6. **Never use programmatic scrollTop to verify iOS scroll fixes** — deploy and have Vlad test on phone
7. **Confirm before push** — always give a short summary and wait for approval
8. **New overlay pattern:** hide #app, append to body, position:fixed+overflow-y:auto, .tb header

### Git Deployment
```bash
cd /c/Users/Vlad/Desktop/carfactory
git add <files>
git commit -m "message"
git fetch origin main && git merge origin/main --no-edit && git push
```
Dual push refspecs send to both `master` and `main` branches automatically.
Pre-push hook (`scripts/validate-features.sh`) blocks push if protected features are missing.

### Supabase Helpers
```javascript
sbGet(table, params)     // GET with query string filters
sbPost(table, body)      // INSERT
sbPatch(table, id, body) // UPDATE by id
sbDelete(table, id)      // DELETE by id
sbUpload(path, file)     // Storage upload
sbSignUrl(storagePath)   // Get 7-day signed URL
```

### Key Global Variables
```javascript
me                        // Current user {id, name, username, pin, role, location}
S                         // Core state {employees[], inventory[], assignments[], notifications[]}
_payLocation              // 'DeBary' or 'DeLand'
_payCurrentWeekStart      // Current week being viewed (Date)
_payWeekData[]            // Payment rows for current week
_payBreakdown             // {cash, card, check, other, total}
_dealsData[]              // Deals for current view
_cashPayouts[]            // Cash payouts for current week
_isData[]                 // inventory_costs rows (Sheets tab)
_isLoc                    // 'DeBary' or 'DeLand' (Sheets tab location filter)
_d26Data[]                // deals26 rows (Sheets tab)
```

### Location-Specific Config
| | DeBary | DeLand |
|--|--------|--------|
| Employees | Ricky ($170/day), Scott ($125/day), Manny ($100/day + $300/car after 5), Dennis | Jesse ($100/day) |
| CarPay Dealer ID | 656 | 657 |
| Inventory CSV | InventoryMaster.csv | InventoryMasterDeLand.csv |
| Pending Sales CSV | PendingSalesDebary.csv | PendingSalesDeland.csv |
| Google Sheet ID | `1eUXKqWP_I...` | `1pNF6h9AX...` |
| Inventory startRow | 20 | 17 |
| Deals26 commission col | Manny | Jesse |
