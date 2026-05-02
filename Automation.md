# Automation — Rules of the Game

This file captures the operating rules for the payment-automation pipeline.
Anything that affects whether a payment gets posted to col G of a Deals tab
vs Profit26 vs nowhere lives here. Updated as new edge cases surface.

---

## 1. Pre-automation cutoff

**Date: 2026-04-09**

Anything entered before this date was hand-keyed by Vlad and is trusted.
The automation verification only checks payments dated on/after this cutoff.
Pre-cutoff col G is left alone, even if it doesn't reconcile to the CSV
exactly — that's just how manual entry happens.

## 2. Profit threshold (col F)

**Col F = "owed". F > 0 means the deal is IN profit.** F ≤ 0 means the
deal is still in pre-profit territory.

The formula lives in the Google Sheet (don't reinvent it). Just read F.

## 3. Where a payment goes

When a CSV payment lands, it should be placed based on the deal's profit
state at the moment the payment came in:

- **Deal F ≤ 0 (pre-profit)** → payment goes to **col G of the Deals tab**
  (Deals26 / Deals25 / Deals24 depending on sale year). Add a dated note
  line `<amount> <car_short> <last_name> <M>/<D>`.
- **Deal F > 0 (in profit)** → payment goes to **Profit26 monthly
  Payments cell** for the **deal's lot** (not the CSV's lot — see rule 5).
- **Threshold-crossing payment** (the one that pushes F from negative to
  positive): can be split — the portion that fills the F=0 gap goes to
  col G, the overflow goes to Profit26. (Latorre case: $250 payment split
  $240 col G + $10 Profit26.)

## 4. Backup in col G is OK when deal is in profit

If a payment is correctly in Profit26 AND also has a dated note in col G
of the deal, that's not a bug. Col G acts as a backup record. As long as
it's hitting Profit26 correctly, the duplicate in col G is fine — leave
it alone.

The bug case is the inverse: payment in Profit26 but deal F ≤ 0 (deal
isn't in profit yet). That's misplaced — needs to be moved to col G.

(Example: Antonio Diaz Escalade row 319 — F=+$607, has 3 April entries
in BOTH col G and Profit26. No fix needed. Vs Adrianna Lopez Accord row
354 — F=−$920, had 2 April entries in Profit26 only — moved to col G.)

## 5. Payment-CSV lot ≠ deal lot ≠ customer's pay lot

A customer's deal can be on one lot's books while they physically pay at
the other lot. The payment CSV files (`Payments/Debary/...` and
`Payments/Deland/...`) are split by **where the customer paid**, not by
where the deal sits.

The deal's location is determined by SoldInventory (`SoldInventoryDeBary.csv`
vs `SoldInventoryDeLand.csv`). Profit posts go to the **deal's** lot.

Examples observed:
- Thompson, Thomas Glenn — pays at DeBary, deal is `12 Sierra` in DeBary
  Deals25. Posts in DeBary Profit26 are correct.
- Customer can have **multiple deals**, one per car, possibly across
  lots. Most-recent SoldInventory `saledate` for that customer name is
  the active deal; older ones are dead/closed.

## 6. Same-name customer disambiguation

When `lookupname` resolves to multiple SoldInventory records (e.g.
"EMERY, ETHAN MICHAEL" appears in both lots), pick the **most recent
saledate**. That's the active deal. The older one is dead/closed and
will not have any post-cutoff CSV activity.

## 7. CSV transaction types — what counts toward col G / Profit

| transtype | reference | Counted? | Notes |
|---|---|---|---|
| PAYMENT | (anything except below) | ✅ | regular recurring payment |
| PAYMENT | OPEN | ❌ | down payment — goes to col E (money), NOT col G |
| PAYMENT | OPEN REFINANCE OPEN | ❌ | refinance opening entry |
| PAYMENT | NETPAYOFF / NETPAYOFF/* | ❌ | system payoff calc, not real payment |
| PAYPICK | CASH / ONLINE / etc | ✅ | pickup payment (deferred down installment) |
| PAYPICK | NETPAYOFF/PTWRITEOFF | ✅ | partial-writeoff cash portion (real cash collected when account was settled). Updated 2026-04-30: previously marked ❌, but the PAYPICK side of a PT-WRITEOFF is the cash that was actually picked up — only the paired `PAY OFF` row is the write-off amount. |
| PAY OFF | NETPAYOFF | ✅ | final balloon payment to close the loan |
| PAY OFF | NETPAYOFF/NOWRITEOFF | ✅ | same — no writeoff applied |
| PAY OFF | NETPAYOFF/WRITEOFF | ❌ | dealer wrote off this amount, not collected |
| PAY OFF | NETPAYOFF/PTWRITEOFF | ✅ | negotiated/early payoff — real cash collected. Updated 2026-04-30: previously marked ❌ "partial writeoff," but Vlad confirmed (Perez Odyssey case) the DMS uses PTWRITEOFF for any payoff that didn't follow the original schedule. Real cash WAS collected. |
| PAYOFF | REFIANCE PAYOFF | ❌ | refinance accounting (no cash) |
| LATEFEE | (any) | ✅ | counts toward total collected, uses `latefee` field |
| DEPOSIT | PAY | ❌ | sale deposit, belongs in col E |
| EARNEDINT | NetPayoff | ❌ | calculated interest, not a payment |

## 8. Apps Script actions — what's available for fixes

Live deployment is at `script.google.com/macros/.../exec`. Redeploy
in one command: `bash scripts/deploy-apps-script.sh` (clasp push +
update existing deployment ID, URL stays stable).

| Action | Inputs | What it does |
|---|---|---|
| `read_row` | tab, location, row | Read one Deals row by sheet row #. Single API call — fast. |
| `find_rows` | tab, location, query | TextFinder substring search across the whole tab. Returns matching rows with full column data. |
| `read_all` | tab, location | Bulk read of all rows in a Deals tab. **Bulk reads since v81 (2026-04-28)** — N×M cell-by-cell calls replaced by 2 range reads (`getValues` + `getNotes`). ~22× faster; Deals25 DeBary now reads in 4s instead of timing out. |
| `read_profit` | location | Read full Profit26 tab (months + items + notes). |
| `profit_append_entry` | month_idx, row_type, amount, description | Add one entry to Payments/Cash Sales/Extras. |
| `profit_remove_entry` | month_idx, row_type, amount, description | Remove one matching entry. Matches by amount + description. |
| `profit_update_entry` | month_idx, row_type, old_amount/desc, new_amount/desc | Edit one entry in place. |
| `deals26_append_payment_direct` | tab, row, amount, note_line, expected_car_desc, last_names | Append to col G formula + note. Drift guard checks `expected_car_desc` against col B; surname guard checks `last_names` are present in the row. |
| `correct_payments` | tab, row, new_total, new_notes, expected_car_desc | Replace col G total + notes. **Fixed v79 (2026-04-28)** — handler moved before the dispatcher's tab-config check, so `body.data.tab` works without needing `body.tab`. Sets formula to flat `=<total>`, so use `deals26_set_row_g` when you need a breakdown formula. |
| `deals26_set_row_g` | tab, row, payments_formula, payment_notes, clear | Atomic set of col G formula + notes. Use for surgical fixes (rebuild a row's formula, replace notes). The right tool for "convert flat $800 to `=500+300` with dated notes". |
| `deals26_get_row_g` | tab, row | Read col G formula + value + note + all-row col data. |
| `deals_lookup_by_lastname` | last_names[], owed_positive_only?, limit? | Cross-tab last-name search across both lots. Used by CarPay/Review when the matcher needs to surface candidates. |

## 9. Standing rules (from earlier)

- **No auto-posting** (set 2026-04-24). Nothing posts to Deals26/Profit26
  without Vlad approving in the Review tab. `_APPROVE_FIRST_MODE = true`.
- **Push from main repo** (`/c/Users/Vlad/Desktop/carfactory`), not from
  worktrees. `git push` updates both `master` and `main` via dual
  refspec.

---

## Other gotchas (learned the hard way)

- **CSV can have duplicate rows for the same payment.** DMS export sometimes
  emits two identical PAYMENT rows for what was actually one transaction.
  Don't trust raw CSV row count — confirm with the customer/operator
  when count looks too high. (Example: Emery 4/10 showed $350 ×2 in CSV,
  was actually only one $350 payment.)
- **Row identifier may be first name, not last name.** Some sheet rows
  use `<year> <model> <first_name>` instead of `<year> <model> <last_name>`
  (e.g. "03 Silverado tan 318k Ethan"). When appending dated note lines,
  the surname check will reject if the note's surname doesn't match the
  row identifier — pass `bypass_surname_check: true` for these.
- **Same person, multiple cars in DeBary alone**: a customer can have
  multiple deals at the same lot (one paid off, one active). Look at all
  their SoldInventory records and identify the active one by sale date
  + payment activity. (Example: Ethan Emery has 3 DeBary cars; only the
  03 Silverado is active.)
- **CSV `lookupname` format is `LASTNAME, FIRSTNAMES`** — for customers
  with multiple given names (e.g. `SANTIAGO, JOSE LUIS BERDECIA GIRALDO`),
  the last name is the part BEFORE the comma (SANTIAGO). The rest are
  first/middle/maternal names. Audit matchers must split on the comma
  first; tokenizing the whole string can lock onto a middle name as a
  pseudo-surname and miss the actual deal.
- **Rare case: DeBary deal with DeLand paperwork.** Sometimes a sale is
  paperwork-processed at the opposite lot. The car ends up in the
  paperwork lot's SoldInventory but the deal lives in the other lot's
  Deals tab. The customer's payment account (custaccountno) lives in the
  paperwork-lot's CSV. Effect: SoldInventory says one lot, Deals tab says
  another. The Deals-tab location is canonical for posting.
  (Example: Justin Garcia 96 Honda Legend — SoldInventoryDeLand has the
  car, but the deal is Deals26 DeBary row 69; he pays through DeLand
  acct 4481.)
- **Misfiled duplicates**: a deal can exist in BOTH lots' tabs — once
  correctly and once as a misfiled duplicate. The duplicate is "dead"
  (never receives posts). Vlad knows which one is real; recognize by
  asking. (Example: Emery's 03 Silverado is active in Deals25 DeBary
  row 254 + duplicate dead in Deals26 DeLand row 45.)
- **CSV can contain phantom PAY OFF entries on long-closed accounts.**
  The DMS export sometimes emits a `PAY OFF NetPayoff` row plus matching
  `LATEFEE NetPayoff` row dated months/years after the account was
  actually paid off. These look real (post-cutoff date, plausible amount)
  but did not reflect a real customer payment. Recognize by: account had
  no recent recurring activity then suddenly a payoff appears. Confirm
  with Vlad before adjusting Profit26 / col G. (Example: Angelina Nieves
  acct 3838 — last real activity 12/25/2025, then a phantom $675.11 PAY
  OFF + $67.51 LATEFEE on 4/24/2026. Account was paid off well before
  April; entries are DMS noise.)
- **Registration fees & similar non-payment charges** can show up in the
  `payments` Supabase table (manually entered, no OCR scan = empty
  `raw_ocr_text`) but never appear in the DMS CSV (DMS doesn't track them).
  These should NOT count toward Profit26 or col G — they're not loan
  payments. Recognize: app entry with empty `raw_ocr_text`, no matching
  CSV row. Confirm with Vlad before removing. (Example: Maxcio Padilla
  Toro 4/7 had two app entries — $240 cash from a receipt OCR (real
  payment) + $75 cash manual no-OCR (registration fee). The $75 was
  posted to Profit26 but should not have been.)
- **`payments` Supabase table is a third source of truth.** Combined
  with CSV, we can distinguish: app entries WITH OCR text (real DMS
  receipts that should also be in CSV) vs app entries WITHOUT OCR
  (manual: registration, deposits, fees). Useful for verifying ambiguous
  cases.
- **Credit card fees can be added to col G entries** but won't appear in
  the CSV. When a customer pays via credit card, Vlad sometimes adds a
  small fee (e.g. $14) to the col G note that isn't reflected in the DMS
  CSV's `totalamt`. Pattern: every credit-card payment for that customer
  shows the same fixed delta. Recognize before flagging "phantom" or
  "amount mismatch". (Example: Hassanin 09 Wrangler row 38 — every CSV
  $350 PAYMENT shows as `364 Wrangler hassanin <date>` in col G; the $14
  is a CC processing fee.)
- **Profit26 entries can intentionally differ from CSV by the threshold
  amount.** When a payment crosses F from negative to positive, the
  threshold portion goes to col G to close F=0, the rest goes to Profit26.
  If automation tracked it that way, a Profit26 entry can be the CSV amount
  *minus* the threshold (e.g. `197 adams 4/24` for a real $200 payment
  because pre-payment F was −$3). Don't "fix" by setting it back to $200 —
  that breaks the post-profit total. Recognize: when col G total is $300
  but Profit26 total is $297, the $3 delta is exactly the pre-payment
  negative F. (Example: Malic Adams Sentra row 47 — pre-4/10 F=−$3, threshold = $3,
  Profit26 entries `100 + 197 = 297` correctly reflect post-profit total.)
- **Profit26 note lines truncate to 26 chars.** `_fitProfitNoteLine`
  shortens long entries (`whitted` → `whitte`, `Challenger` → `Chalnger`,
  etc). Last-name-based audit matching MUST account for this — a
  Profit26 entry for "WHITTED" may show as "whitte". Before flagging an
  audit hit as "missing from Profit26", search the cell note for any
  prefix of the surname, not just the full surname.
- **Surname suffix tokens (Jr / Sr / II / III / IV / 2nd / 3rd) must be
  skipped.** Naive `customer_name.split(' ').pop()` returns "jr" for
  "Kenneth John Goodman jr", which then becomes the row label
  ("03 RSX red 189k Jr") and breaks the surname check on every future
  payment. `_extractSurname()` (added 2026-04-28) drops trailing suffix
  tokens before picking the last word. Used by `_dealReviewPreview` and
  `_autopopulateDeals26`. (Example: Goodman jr 03 RSX DeLand row 64 was
  initially labeled "Jr"; corrected via Sheet update_cell.)
- **`inventory_costs.car_id` cross-links are catastrophic — verify the
  link.** Each IC row's `car_id` is unique-constrained against
  `inventory.id`, but nothing prevents the wrong link. When IC #224
  ("12 Odyssey white 175k", DeBary) was incorrectly linked to
  `car_id=1369` (a DeLand RSX), the matcher used the Odyssey's
  cost/expenses for the RSX deal AND blocked the real RSX IC row
  (#233, `car_id=null`) from ever being linked (unique constraint). The
  resulting deal upload silently fell into `multiple` review mode. Fix:
  re-link both IC rows to their correct inventory ids, then re-run
  `_autopopulateDeals26`.
- **`multiple` review for a brand-new finance deal = wrong path.** Deal
  upload should always land as `deal_pending`. If it lands as
  `multiple` / `no_match`, the down payment was treated as a regular
  payment that the matcher tried to fit into an existing Deals26 row.
  Root cause is usually a broken IC link (see above). The deal record
  exists in Supabase but the Deals26 sheet row was never created. To
  recover: fix the IC link, call `_autopopulateDeals26(deal, car)`
  directly, then mark the misfiled review approved.
- **Voided deals must not regenerate cash-sale reviews.** When the
  user manually deletes a Profit26 cash-sale post, `_sweepUnpostedCashSales`
  detects the gap on the next Review open and re-queues. Mark the deal
  with `voided_at` (and `voided_reason`) to opt it out permanently — the
  sweep filters on `voided_at=is.null` and `_queueCashSaleReview` also
  refuses voided deals as defense-in-depth. (Example: Riel/Encarnacion
  13 Accord deal #64 — kept regenerating cash_sale_pending every ~30
  min; voided 2026-04-28 with reason "Manually deleted from Profit26".)
- **Inventory scan must scope to recent additions.** Bulk-flagging every
  CSV car missing from `inventory_costs` floods the Inventory review tab
  (saw 228 reviews when the user expected 5). The scan now skips cars
  whose `inventory.created_at` is older than 7 days — those are
  pre-existing inventory the user opted not to track. Fresh acquisitions
  added by GitHub Actions or the user still get queued normally.
- **CSV cost vs totalcost.** The dealer CSV exposes `cost` (raw hammer
  price) AND `totalcost` (= cost + buyersfee, the actual amount paid).
  Always prefer `totalcost` so IC col G reflects what was paid, not the
  pre-fee number. Both `parseCSV` (client) and `parseCsv` (server-side
  `inventory-sync.js`) now use the same precedence:
  `totalcost > netcost > cost > askingprice > purchaseprice`.
- **Color aliases for IC name dedup.** `_normalizeIcKey` collapses
  trailing sheet row numbers (`"18 Camry gray 298k 4"` → `"18 Camry
  gray 298k"`) and color synonyms: nardo / charcoal / smoke / anthracite
  → gray; aluminium → aluminum; champagne / cream → beige; pearl /
  off-white → white; burgundy / maroon → red; navy → blue. Without
  these, the same physical car gets queued twice with different color
  words.

## Resolved cases (running log)

| Case | Customer / car | What was wrong | Resolution |
|---|---|---|---|
| 1 | Thompson — 12 Sierra DeBary | Audit linked to old DeLand 03 Sierra | Posts in DeBary Profit26 are correct (in profit) — no fix |
| 2 | Lopez Adrianna — 14 Accord DeBary row 354 | F=−$920, 2 April $250 in Profit26 by mistake | Removed from Profit26, added to col G as dated notes |
| 3 | Diaz Antonio — 09 Escalade DeBary row 319 | F=+$607, 3 April entries in BOTH col G and Profit26 | No fix — col G is backup; Profit26 placement correct |
| 4 | Tyrell Jaran — 14 Fiesta DeBary row 313 | Audit linked to old DeLand 07 Cobalt | Posts in DeBary Profit26 are correct (in profit) — no fix |
| 5 | Emery Ethan — 03 Silverado DeBary row 254 | F=−$373, 3 entries in Profit26 ($1,050) for one $350 actual payment (CSV had dup row) | Removed all 3 from Profit26, added one $350 entry to col G with bypass_surname_check |
| 6 | Davis (Lancer Douglas, Model S Zachariah) | Audit linked $84.62 to wrong Davis | Lancer in profit, Model S not — both correctly placed already. No fix |
| 7 | Whitted Tatum — Challenger DeBary row 244 | Audit linked to wrong Whitted (BMW Thaitianna) | Challenger in profit, both 4/8 + 4/22 already in Profit26 (truncated as `whitte`). No fix |
| 8 | Carrasquillo Oscar — TLX DeBary row 12 | $500 4/25 in DeLand Profit26 (wrong lot + F=−$93). Pre-cutoff col G short by $220. | Removed $500 from DeLand Profit26, added $220 catch-up + $500 split to col G/Profit26 — now F=+$127 in profit |
| 9 | Nieves Angelina — Yukon DeBary row 34 | Audit flagged $742.62 missing from Profit26; turned out to be phantom DMS PAY OFF entry on a long-closed account | DISMISSED — no fix; account already paid off |
| 10a | Garcia Marta — Lancer DeBary row 379 | Audit linked her $500 to wrong (Legend Garcia) deal | NO FIX — her $500 4/18 already in col G of correct deal (Lancer) |
| 10b | Garcia Justin — 96 Honda Legend DeBary row 69 | RARE: DeBary deal but paperwork processed in DeLand (so SoldInventoryDeLand has the car, but deal sits in Deals26 DeBary). $700 April missing from col G | Added `350 4/10` + `350 4/24` to col G row 69. F: −$4,048 → −$3,348 |
| 11 | Ozuna Rafael — 16 Genesis DeBary row 115 | col G total $800 was correct but as flat value with no dated notes. Audit kept flagging due to no dated entries. | Used `deals26_set_row_g` to set formula=`=500+300` + notes=2 dated lines. F unchanged at −$612 |
| 12-14 | Adams (Brittney+Malic), Hassanin | Audit matcher errors / threshold accounting / 4% CC fees | No fixes — all correctly placed. Captured rules in Automation.md (4% CC fee, threshold offset, compound surnames) |
| 15 | Toro Maxcio — 09 VW CC DeBary | $75 4/7 in Profit26 was a registration fee (app-entered, no OCR, no CSV match) | Removed `75 09 Cc silver toro 4/7` from DeBary April Payments; now matches CSV $240 only |
| 16-26 | Phase 5 phantoms (27 total) | Audit's matcher couldn't link due to compound surnames, threshold overflows, split entries, 4% CC fees, separate same-day pairs | All 27 either resolved as real-but-mislinked OR are threshold overflows correctly placed in Profit26. Only fix: removed $75 Toro registration. |
| 27 | Santiago Ruben — 16 Expedition DeLand row 43 | RARE inverse case: DeLand deal but DeBary paperwork (so CSV is in DeBary, paymen post mistakenly went to DeBary Profit26). F=−$469 NOT in profit. | Removed `341 Expedition santia 4/24` from DeBary Profit26, added to col G of DeLand row 43. F: −$469 → −$128 |
| 28 | Gonzalez Paola — 11 Sonata DeBary row 303 | F=+$434 (in profit). 4/9 $300 was in Profit26 + col G. 4/17 $200 missing from Profit26. | Added `200 11 Sonata gonzalez 4/17` to DeBary Profit26 April Payments |
| 29 | Wright Paige — 18 Jetta DeLand row 10 | F=+$60. col G has full $590 4/24, Profit26 has only $60 — looks "missing" but correctly is the threshold overflow. | NO FIX — pre-payment F was −$530, $530 to col G + $60 to Profit26 is correct |
| 30 | Santiago Jose Luis Berdecia Giraldo — 12 Accord cp white DeLand row 54 | Audit's matcher was confused by long compound name (`SANTIAGO, JOSE LUIS BERDECIA GIRALDO` — last name is SANTIAGO, the rest are middle names). Deal exists, col G has `275 santiago 4/24` correctly. | NO FIX — already correctly placed |
| 31 | Phase 6 missing-from-Profit (22 total) | Mostly matcher errors: in-profit deals where the CSV April was in BOTH col G + Profit26 (correct dual-tracking) but audit's matcher linked to wrong deal. F≤0 deals where CSV April was correctly in col G only. | All 22 either resolved as already-correct or false positives. Real fixes: Santiago Ruben (#27), Gonzalez Paola (#28). |
| 27 | Riel/Encarnacion — 13 Accord DeBary deal #64 | `cash_sale_pending` review regenerated every ~30 min after Vlad manually deleted the Profit26 post — `_sweepUnpostedCashSales` saw the gap and re-queued | Voided deal #64 (`voided_at` + `voided_reason="Manually deleted from Profit26"`); patched sweep + `_queueCashSaleReview` to filter `voided_at=is.null`. Will not regenerate. |
| 28 | Rojas/Jasmine — 17 Pilot DeBary Deals25 row 149 | $450 4/28 CarPay payment landed as `no_vehicle` review — CarPay customer record had no vehicle linked, AND Sheet row labeled by first name "Jasmine" not surname | Threshold-crossing post: $450 → col G of Deals25 row 149 with `bypass_surname_check:true` and note `"450 jasmine 4/28"`; pre-payment owed −$150 → post-payment +$300, so $300 overflow → DeBary Profit26 April Payments. Review #1042 approved. |
| 29 | Goodman jr — 03 RSX red 189k DeLand deal #66 | New finance deal landed as `multiple` review (instead of `deal_pending`); only candidate surfaced was an unrelated Lesabre Goodman in DeBary. Root cause: IC #224 (12 Odyssey white 175k DeBary) was incorrectly linked to `car_id=1369` (the RSX in DeLand), blocking IC #233 (the actual RSX cost row) from ever linking | Re-linked IC #224 → inventory #1359 (correct Odyssey); linked IC #233 → inventory #1369 (RSX); ran `_autopopulateDeals26` → Deals26 DeLand row 64 created with money=$2,288, owed=−$843. Review #802 approved. Row label initially built as "Jr" — patched `_extractSurname` to skip Jr/Sr/II/III suffix tokens; sheet cell corrected to "Goodman". |
| 30 | Inventory review tab spam (228 cards when 5 expected) | `_rvForceScan` flagged every CSV car missing from `inventory_costs` — 222 of those were pre-existing inventory Vlad never tracked, plus duplicates from earlier broken-scan runs | Bulk auto_resolved 223 false-positive reviews (kept 5 truly-new); patched scan to require `inventory.created_at` within 7 days; added `_normalizeIcKey` color aliases (nardo/charcoal → gray, etc.) and trailing-row-number stripping; raised review fetch limit 100→300 so all valid Inventory cards are visible. |

---

## Bug fixes shipped Day 8 (2026-04-28)

Five distinct automation bugs identified during the audit walkthrough,
plus tooling improvements. All live on `main` (and Apps Script v79 →
v81).

| # | Bug | What was wrong | Fix |
|---|---|---|---|
| **disp** | `correct_payments` returned "Unknown tab: undefined" | Handler positioned at line 534 of Apps Script, AFTER the dispatcher's tab-config check at line 425 | Handler moved before line 425 (after `deals26_set_row_g`). Deployed v79. |
| **#1** | Wrong-lot routing for cross-lot customers | `_findDealAlias` and `_findCarPayAccountAlias` didn't return `location`; alias direct-write paths used `payload.location` (= where customer paid) for both col G + Profit26 post, but a deal can sit on the opposite lot. | Both helpers now SELECT and return `location`. 4 alias direct-write call sites updated to use `alias.location`. `_appendPaymentToProfit` accepts a `dealLocation` override. |
| **#2** | Stale-alias re-queue dead-end | When `deals26_append_payment_direct` returned `row_drift`/`surname_mismatch`/`empty_row` (v65/v66 guards), the code queued an empty-candidates `payment_reviews` card → user couldn't approve it → payment dead-ended. | Drift errors now deactivate the stale link AND fall through to the standard approve-first / matcher pipeline (which produces real candidates). 2 paths fixed: Stage-2 resolver + CarPay variant. |
| **#3** | Wrong car description on alias post | `noteLine` was built from `payload.vehicle_*` fields, which come from `carpay_customers.vehicle` or receipt OCR. If vehicle metadata was updated for a NEW car but the alias still pointed at the OLD row, the note would say new car's text on old row. | New helper `_paymentNoteLineFromDeal(amount, carDesc, paymentDate)` builds the note from the matched ROW's `car_desc`. 4 alias direct-write call sites switched to use it. |
| **#4** | Matcher dup-check returned input lot, not deal lot | `deals26_append_payment` action returned `location: location` (input/payment lot) on `already_posted` and `possible_duplicate` paths instead of `useLoc` (deal's actual sheet). | Changed to `location: useLoc` on both paths. Cross-lot customers no longer get re-routed to wrong lot's Profit26 on dup-check. Deployed v80. |
| **#5** | Deal-link silent breakage on row drift | When a row in a Deals tab drifts (insert/delete shifts rows), `deal_links.target_row` becomes stale and posts go to the wrong car. | Self-heal: on drift error, call `find_rows` (TextFinder) with the link's `car_desc`. On unique match, update `deal_links.target_row` and retry the post. Wired into Stage-2 resolver + CarPay paths. |
| **#5b** | Alias direct-write had no drift guard at all | `_findDealAlias`-driven posts didn't pass `expected_car_desc`, so silent mis-posts to drifted rows were possible. | Added `expected_car_desc` to all 3 alias-direct-write call sites + same self-heal logic as Bug #5 via `_updatePaymentAliasRow`. |
| **bulk** | `read_all` timed out on Deals25 DeBary | Cell-by-cell `getRange().getValue()` calls = ~5,100 API round-trips for that tab, blowing the URLFetch deadline. | Switched to bulk `getRange(...).getValues()` + `getNotes()` — 2 calls total. Deals25 DeBary now reads in ~4s instead of timing out. Deployed v81. |

## Audit + Reconcile tooling (Day 8)

`scripts/reconcile_payments.py`
- Account-level CSV reconciliation. Compares col G total to CSV total
  per account, post-CUTOFF_DATE only.
- Saledate-chronology pairing for same-name multi-car customers:
  builds `inv_by_full_name` sorted by saledate + `name_acct_pairing`
  sorted by first txn date, pairs them positionally when counts
  match. Helper `acct_for_inv_record(inv_row)`.
- Conservative — only pairs when `len(inv_list) == len(accts)`.

`scripts/audit_april_profit.py` — bidirectional April Profit26 audit
- **FORWARD pass**: every Profit26 line for both lots → must (a)
  match a CSV April transaction and (b) be on a deal with F > 0.
  Buckets: `ok`, `threshold_overflow`, `cc_fee_4pct`, `wrong_lot`,
  `wrong_deal`, `phantom`, `duplicate`, `no_deal`, `ambiguous_deal`.
- **INVERSE pass**: every CSV April transaction → must land in the
  right place (col G or Profit26 by F status). Buckets:
  `ok_in_profit`, `ok_in_col_g`, `ok_in_col_g_backup_only` (F>0 but
  col G has it as backup — Rule 4), `tracked_in_profit_misplaced`
  (F≤0 but found in Profit26), `wrong_lot_post`,
  `missing_from_profit`, `missing_from_col_g` (truly dropped).
- 4% CC fee tolerance on both passes.
- Threshold-overflow detection for in-profit deals.
- Within-account pair-sum (was bug: summed across all accts).
- Truncation tolerance for surname matching (`whitted` ↔ `whitte`).
- Conservative `deal_for_account`: prefers full-lookupname + year/
  model match in inv; falls through to recent-col-G-activity > F>0;
  bucks ambiguous when can't disambiguate.
- `--push` flag: inserts `payment_reviews` rows with
  `reason='csv_reconciliation'` for actionable findings (phantoms,
  wrong_lot, missing_from_profit, missing_from_col_g). Idempotent
  on re-run via (customer, direction) dedup.

## Review UI extension for `csv_reconciliation` (Day 8)

The Review tab (Payments sub-tab) renders a dedicated card type for
`reason='csv_reconciliation'` rows.

Card content:
- **Direction header** with color: Sheet underpaid / Sheet overpaid /
  No SoldInventory match / phantom / wrong-lot.
- **Payment-source tag**: lazy-loaded after render. Cross-checks
  customer + amount against `payments` table (app/scanned receipts)
  and `carpay_payment_postings` (CarPay portal). Tags as `app
  (scanned receipt)`, `CarPay portal`, `app + CarPay`, or `CSV/DMS
  only (no app or CarPay record)`.
- **Diff banner**: sheet $X vs CSV $Y with the Δ in red/yellow.
- **CSV transactions table**: scrollable monospace, shows date /
  type / amount / ref.
- **Sheet payment_notes**: preformatted, scrollable.
- **Fix preview block**: code-styled lines showing EXACTLY what
  Apply Fix will write (e.g., `Append to col G of Deals26 row 12
  [DeBary]: 250 14 Accord lopez 4/9`). Visible before tapping.

Three actions:
- **Dismiss** → `_reviewReject` → status='rejected'. No sheet
  change. Used for non-actionable items.
- **Mark resolved** → `_reviewMarkResolved` → status='resolved'.
  No sheet change. Used when the discrepancy is acceptable as-is
  (post-profit payment in Profit tab not col G, known fee, etc.).
- **Apply fix** → `_csvReconAutoFix` → executes the fix on the
  sheet (with confirm dialog), then marks resolved with
  `resolved_by = userName + ' (auto-fix <kind>)'`.

Apply Fix supported directions:
- `sheet_short` / `missing_from_col_g` → append missing CSV txns
  to col G via `deals26_append_payment_direct`.
- `missing_from_profit` → append to deal's-lot Profit26 April
  Payments via `profit_append_entry`.
- `phantom_in_sheet` → remove via `profit_remove_entry`.
- `wrong_lot` → `profit_remove_entry` on wrong lot, then
  `profit_append_entry` on right lot.

Idempotent: dedup logic (with 4% CC fee tolerance) skips entries
already present in col G / Profit26.

## What new app-created deals look like (Day 4 onward)

Important note for understanding why the audit's findings are almost
all legacy:

When a deal is created via the app's `_autopopulateDeals26` flow
(post 2026-04-09), three linking records get created at the same
time:
1. `deals26` row in Supabase + corresponding sheet row.
2. `deal_links` row keyed by VIN + customer_name + target_tab/row/
   location.
3. `customers` row (canonical record).

For these deals, the CarPay / scanned-payment matcher chain is exact:
CSV `lookupname` or VIN → `customers` → `deal_links` → (tab, row,
lot). No fuzzy matching. No last-name guessing. No multi-deal
disambiguation.

Combined with Bug #5 self-heal, even if a row drifts later, the
system relocates by `car_desc` and updates the link silently. The
chain doesn't break.

The audit findings we've been working through are almost entirely
LEGACY:
- Pre-app deals (no `deal_links` exist; the matcher must fuzzy-match
  by last name + model).
- Customers with multi-car histories spanning the pre/post-app
  boundary (one car was hand-keyed pre-app, the next went through
  the app).
- Aliases learned in the early days before today's bug fixes.

As legacy deals close out and new app-created ones replace them, the
audit queue will dwindle. Going forward the cards Vlad sees will be
limited to:
- Brand-new edge cases (rare).
- Periodic CSV reconciliation drift (rare, and now self-healing).
- Truly dropped DMS payments (rare).

## Future enhancements (in the tank)

Not built yet. Captured here so they don't get lost.

- **Apply Fix preview matches dialog** — the confirm dialog could
  use the same code-styled lines as the card preview for visual
  consistency. Currently dialog is plain text.
- **Manual reassign on csv_reconciliation cards** — when the
  matcher's deal pick is clearly wrong (Vlad eyeballs the card and
  knows it's the wrong car), let Vlad pick the correct deal in the
  Review UI itself instead of having to fix manually outside.
- **Push the ambiguous_deal cases too** — currently only actionable
  buckets push. Ambiguous cases get silently dropped. Push them
  with reason `'audit_ambiguous'` and let Vlad pick the right
  deal. Becomes a manual-assign flow.
- **Card grouping by customer** — collapse same-customer cards
  into one parent (e.g., "Adams" with 2 sub-cards). Reduces visual
  clutter when one customer has multiple findings.
- **Reconcile_payments.py compound-name fix** — currently uses pure
  last-name lookup; should mirror `audit_april_profit.py`'s
  full-name-aware approach.
- **Inverse audit for Cash Sales rows** — currently only Payments
  rows are audited. Cash Sales rows in Profit26 should also
  reconcile against deal-creation events (validating that every
  Cash Sales line corresponds to a real deal close).
- **CarPay cross-check audit** — for each CarPay payment, confirm
  it landed in the right place (col G of right deal OR Profit26 of
  right lot). Flag CarPay-side "ghost" postings that didn't make
  it to the sheet.
- **`payment_deal_aliases` self-heal extension** — Bug #5b only
  covers the alias direct-write path. The alias may also drift
  silently when the matcher creates new aliases pointing at rows
  that later move. A periodic cleanup job that re-validates
  `target_row` against `car_desc` would catch this.
- **May/June+ audit cycles** — current scripts hardcode `CUTOFF_DATE
  = '2026-04-09'` and look at April Profit26 specifically. To audit
  later months, parameterize the cutoff and the target month
  index, then re-run.
- **$3,421 DeBary Profit26 mid-session drop** — Vlad said "I know
  what happened" but never circled back to confirm. Worth checking
  if there's a forensic trail in the audit log / Apps Script
  Stackdriver.

(Will keep extending as we work through the audit list.)

---

## Security model — JWT + RLS (Day 9, 2026-04-29)

After this migration, the Supabase anon key alone gets ZERO data access.
Every authenticated employee carries a 7-day JWT issued by the `auth-login`
edge function. RLS on every public table requires that JWT.

### Auth flow

1. PWA login screen takes `username + pin`.
2. `_acquireAuthJwt(username, pin)` POSTs to `/functions/v1/auth-login`.
3. Edge function calls `verify_employee_pin(p_username, p_pin)` RPC
   (SECURITY DEFINER, bcrypt comparison via pgcrypto `crypt()`).
4. On match, edge function signs a JWT with the project JWT secret
   carrying claims:
   - `aud: 'authenticated'`, `role: 'authenticated'` (PostgREST DB role)
   - `sub`: employee id (string)
   - `exp`: now + 7 days
   - `app_role`: `'employee'` or `'manager'`
   - `is_owner`: true for vlad/tommy
   - `username`, `name`, `emp_location`
5. PWA stores the JWT in `cf_jwt` localStorage. `_sbHeaders()` attaches it
   as `Authorization: Bearer <jwt>` (apikey stays as the project anon key,
   which Supabase always requires alongside the user JWT).
6. On 401 from any Supabase call, `_sbHandleResponse` clears `cf_jwt` and
   `_onAuthExpired()` soft-kicks the user back to the login screen with
   "Session expired — please log in again".

### RLS policies

Default for every public table (28+ tables):
```
CREATE POLICY authenticated_all ON public.<table>
  FOR ALL TO authenticated USING (true) WITH CHECK (true);
```

Special cases:
- `employees`: SELECT for authenticated, but **column grants exclude `pin`
  and `pin_hash`** so they're never returned. INSERT/UPDATE/DELETE only
  for owners (`(auth.jwt()->>'is_owner')::boolean = true`).
- `audit_log`: append-only — SELECT + INSERT for authenticated, no UPDATE
  / DELETE.
- Storage `car-photos` bucket: authenticated only.

### Backend script auth

Python scripts in `scripts/` import `_sb_config` which loads
`SUPABASE_SERVICE_KEY` from env (`scripts/.env` or shell). Service-role
bypasses RLS — required for audit/reconcile/backfill scripts.

The Google Apps Script reads `SUPABASE_SERVICE_KEY` from
`PropertiesService.getScriptProperties()`. Falls back to anon during
transition.

### Adding a new table

1. Add the table normally.
2. Write a migration: `ALTER TABLE public.<name> ENABLE ROW LEVEL SECURITY;
   CREATE POLICY authenticated_all ON public.<name> FOR ALL TO authenticated
   USING (true) WITH CHECK (true);`
3. Apply via Supabase SQL editor or `supabase db push`.

### Where things live

- `supabase/functions/auth-login/index.ts` — edge function
- `supabase/migrations/20260429_010_employees_pin_hash.sql` — pin_hash backfill
- `supabase/migrations/20260429_020_auth_helpers.sql` — RPCs (verify_employee_pin, hash_employee_pin, create_employee, update_employee_pin)
- `supabase/migrations/20260429_030_enable_rls.sql` — RLS rollout
- `index.html` — `_cfJwt`, `_sbHeaders`, `_acquireAuthJwt`, `_onAuthExpired`, updated `doLogin`/`doLogout`/`addEmp`
- `scripts/_sb_config.py` — service-role loader for Python scripts
- `setup-security.md` — runbook for the deploy steps

### Rollback (worst-case)

If the live app breaks for users post-RLS, fastest recovery is to disable
RLS on every public table (anon key works again immediately):
```sql
DO $$ DECLARE r record; BEGIN
  FOR r IN SELECT tablename FROM pg_tables WHERE schemaname='public' LOOP
    EXECUTE format('ALTER TABLE public.%I DISABLE ROW LEVEL SECURITY', r.tablename);
  END LOOP;
END $$;
```
Then diagnose what broke per-table.

---

## The Profit / Payment Architecture (Day 10)

This section defines the canonical model for how payments flow into
profit, where they live, and how we guarantee accuracy. Read this
before adding any audit / reconciliation logic.

### Sources of truth (in priority order)

There are three independent records of what a customer paid:

1. **DMS CSV (`Payments/Debary/*.csv`, `Payments/Deland/*.csv`)** — the
   dealer system's authoritative ledger. Every payment posted to a
   customer account by the office staff appears here. Keyed on
   `custaccountno`. **Source of truth for: amount paid, date paid, type
   (PAYMENT vs LATEFEE vs PAY OFF).** Limitations: down payments and
   refis filed under the same account; OPEN / NETPAYOFF rows are
   accounting artifacts not real cash. Filter rules in §7.

2. **CarPay portal** — recurring online + in-portal card payments.
   Mirror posts a webhook to `payments` table. Has OCR receipt text
   for verification. Same payment also lands in the CSV one DMS
   import cycle later.

3. **App (`payments` Supabase table)** — manual entries by Vlad/Manny
   from in-person cash/card payments not yet in CSV. Has raw OCR text
   when scanned from a receipt; no OCR when manually entered (that's
   the signal it's a registration fee or similar non-loan payment that
   shouldn't hit Profit26).

The CSV is the **gold standard** because the DMS reconciles cash daily.
But it lags real-time by hours-to-days. CarPay/app entries are real-time
but represent a subset of payments.

For audit/reconciliation: trust CSV when it conflicts with sheet.

### The two-cell rule

A payment lands in **one of two places** based on the deal's profit
state at the moment of payment:

1. **`col G` of the deal row (Deals26 / Deals25 / Deals24)** —
   pre-profit ledger. Tracks every dollar received until the deal
   crosses F=0.
2. **`Profit26 -> April -> Payments` cell (deal's lot)** — post-profit
   reporting. The dollars that count toward this month's profit.

Mechanics:
- Sale -> `money` (col E) reflects the down payment.
- Each subsequent payment goes to col G; col G's `=SUM()` formula in
  col F shows `owed` = how far below profit the deal is.
- When col G total exceeds F=0 (i.e. customer overpaid the cost basis),
  the deal is **in profit**. Subsequent payments go to Profit26.
- The **threshold-crossing payment** is the only one that splits:
  the portion that fills the F=0 gap goes to col G, the overflow goes
  to Profit26. Both halves dated the same day.

### Why the sheet can disagree with the CSV

There are real, legitimate reasons the totals differ. **Any
reconciliation tool must understand these or it will produce false
positives:**

- **Threshold splits.** A $400 CSV payment can show as `$240 col G + $160 Profit26`. The CSV total ($400) does NOT equal the Profit26 portion ($160) does NOT equal the col G portion ($240). All three are correct.
- **Backup duals.** For deals already F>0, operators sometimes log a payment in BOTH col G and Profit26. The Profit26 entry is what counts for the month; the col G entry is a redundant ledger note. Don't flag as duplicate if the deal is in profit.
- **CC fees.** For card payments Vlad sometimes adds the processing fee onto the col G line — `$364` for a $350 CSV PAYMENT (4% fee). Profit26 may show the pre-fee $350 or the post-fee $364 depending on how it was entered.
- **Same-day pairs.** PAYMENT + LATEFEE on the same day are one logical payment. The CSV has 2 rows; the sheet has 1 line at the sum.
- **Multi-customer cosigner.** Two account holders can pay against the same deal (Gorski + Silva on the 11 Silverado). Both sets of payments are real; they appear under different surnames in Profit26 attributable to the same deal.
- **Compound surnames.** "DIAZ ORALES, CARLOS" — the surname is the LAST word before the comma in CSV format ("ORALES"), not "DIAZ". Sheet may show either depending on operator preference.
- **F-state at time of payment is NOT F-state now.** A payment correctly placed in col G in February (when F<0) stays in col G even after the deal becomes F>0 in April. The audit cannot retroactively relocate it without historical F data.

### What "in profit" means for the business

Profit26 -> "April" -> "Payments" cell value = total dollars collected
that month from customers whose deal has been paid past cost basis.
That number, plus "Cash Sales" + "Extras", is **the profit for the
month**. Net profit = that minus inventory costs, expenses, taxes
(formulas in the sheet).

This is the number Vlad uses to know the business is profitable. It
must reflect reality. The historical operator workflow — manual entry
into Profit26 — works but is error-prone. Automation's job is to keep
this number **honest** without inflating it.

### How to NOT inflate Profit26

Two patterns inflate profit and should never happen:

1. **Posting the same payment twice** (once in col G, once in Profit26
   for a F<0 deal). Profit26 should never receive entries for deals
   currently F<0, EXCEPT the overflow portion of a threshold-crossing
   payment.
2. **Posting a payment in Profit26 when historically (at time of
   payment) the deal was F<0**. The audit can't easily recover this
   without per-payment F snapshots.

Audit logic must:
- Group CSV -> logical payments (same-day same-acct PAYMENT+LATEFEE).
- For each, locate the deal via `deal_account_links` (custaccountno -> deal).
- Check the deal's CURRENT F to bucket: if F>0 today AND was likely F>0 at payment date, expect Profit26; otherwise expect col G.
- Estimate "F at payment date" by subtracting all later col G entries from current F.
- For each posted entry on the sheet, find the matching CSV txn. If absent, flag for review (don't auto-delete — operator may have a non-CSV cash payment).
- For each CSV txn, find the matching posted entry. If absent, flag. Auto-add ONLY for high-confidence cases with explicit write-locked re-checks.

### Account-link database (`csv_accounts` + `deal_account_links`)

The `csv_accounts` table mirrors every customer in the payments CSV
(932 accounts as of Day 10). `deal_account_links` is the bridge from
sheet deals to those accounts. Once linked, every audit becomes a
deterministic join:

```
CSV txn (custaccountno) -> csv_accounts -> deal_account_links -> deal
```

Auto-link covers ~80% (VIN match + name+year+model). The remaining
~20% surface in chat for human pick. Once a link is set, never re-derive
it with surname guessing.

### Rules for any future audit script

1. **Always lockfile.** `scripts/.audit_2026.lock` prevents two
   `--apply` runs from racing into the sheet (Day 10 lesson).
2. **Pre-add dup safety.** Before adding to col G, check the existing
   col G blob for amount+surname-token within 7 days. Before adding to
   Profit26, check the lot's Profit26 cell for same. Skip if found.
3. **Never trust raw `sort_order` as sheet row.** Supabase
   `deals26.sort_order` is sheet row MINUS 1 (header). For Apps Script
   writes, pass `sort_order + 1`.
4. **Apps Script's `_rewriteNoteLineLastName` will overwrite the
   surname** in note lines you pass to `deals26_append_payment_direct`
   if it doesn't match the row's car_desc surname. Pass an empty
   `last_names` list and `bypass_surname_check: true` to disable.
   Better: build the entire `payment_notes` blob and use
   `correct_payments` instead — it writes the notes literally.
5. **Always show the plan before applying.** Dry-run output is the
   gate; `--apply` writes; `--dedup` is a separate flag for
   destructive deletes.
6. **Validator runs every cron tick** (`scripts/review_revalidate.py`).
   Auto-resolves stale review cards once the underlying issue is
   fixed by another path.

### Data-flow diagram (current state — "in between")

```
DMS CSV ----------------------------------------------+
   |  (every cron, 2hr)                               |
   v                                                  |
sync_csv_accounts.py                                  |
   |                                                  |
   v                                                  |
csv_accounts <-- deal_account_links --> deals26       |
                                        (Supabase)    |
                                                      |
CarPay webhook --> payments (Supabase) <--------------+
                                                      |
App manual entry --> payments (Supabase) <------------+
                                                      |
                                                      v
                                       Profit26 (Sheet)
                                       col G (Sheet)
                                       (mirrored to Supabase)
                                                      |
                                                      v
                                       Audit + reconciliation
                                       (audit_2026.py)
                                                      |
                                                      v
                                       Review queue (UI)
```

### End state (what we're building toward)

- All payments captured in the app + CarPay (no DMS dependency).
- Each deal has its own ledger row in Supabase (`deal_ledgers` table —
  not yet built): cost basis, all payments timestamped, current F,
  threshold-crossed flag, profit-portion, all fees.
- "Deals" sheet stays as a human-readable mirror, regenerated from the
  ledger.
- Profit26 sheet stays as a monthly summary, regenerated from the
  ledgers.
- CSV becomes audit-only: a daily check that the DMS still agrees
  with the app. Discrepancies surface as review cards.

The current "in between" state requires both the sheet and the app to
stay accurate because:
- Vlad still does most posting through the sheet.
- The app's payment flow is incomplete (no built-in profit ledger yet).
- Some deals were entered before the automation existed.

Until the app is the source of truth, **every audit must reconcile
the sheet against the CSV**. Inflation is the bigger sin than
deflation — better to under-count than to over-count and pay tax on
ghost income.

---

## Day 11 — what reconciliation actually requires (2026-04-30)

A long, frustrating day spent trying to bring April Profit26 into
agreement with CSV truth. The architecture from Day 10 (csv_accounts
+ deal_account_links + audit) is sound, but reconciliation is harder
than it looks. Captured below: the bugs hit, the fixes shipped, and
the limits we ran into.

### Filter rules: one canonical source

Every audit / sync script that reads payment CSVs must use the same
filter rules. Created `scripts/_csv_filter.py` as the single source
of truth — `is_real_payment(row)` and `real_amount(row)`. Any new
script reads from there. Inconsistent filters between
`sync_csv_accounts.py` and `audit_2026.py` previously gave different
totals from the same CSV.

### Filter rule corrections discovered today

The §7 table had two errors that produced fake "missing" cases:

| transtype | reference | Original | Corrected | Why |
|---|---|---|---|---|
| PAYPICK | NETPAYOFF/PTWRITEOFF | ❌ | ✅ | The PAYPICK side of a PT-WRITEOFF settlement IS real cash — the dealer collected it. The paired PAY OFF row holds the writeoff amount. |
| PAY OFF | NETPAYOFF/PTWRITEOFF | ❌ | ✅ | Vlad confirmed (Perez Odyssey case): the DMS uses PTWRITEOFF for any payoff that didn't follow the original schedule (negotiated payoff, early-pay adjustment). The customer DID pay the full amount. |

After these fixes, Perez Martinez (acct 4428) showed correct lifetime
$4688 instead of fake $336.

### Conservation rule: best-fit not strict

"Per deal, col G + Profit26 should equal CSV lifetime paid" sounded
right but failed on real cases. Vlad's posting pattern varies:

- **Pattern A (Perez Odyssey style)**: col G holds the full running
  ledger (entire payment received). Profit26 holds a derived
  monthly-profit snapshot (informational). They overlap — adding
  both double-counts.
- **Pattern B (Dinsmore Charger style)**: col G holds only pre-profit
  receipts. Profit26 holds the post-profit overflow. They sum to CSV.
- **Pattern C (Panayotis style)**: incomplete — col G + Profit26 < CSV
  because Vlad never logged Jan/Feb/Mar payments.

Audit logic should compute BOTH `delta_a = col_G - CSV` and
`delta_b = (col_G + Profit26) - CSV` and pick the one with smaller
absolute value. Each finding records `rule_used` so the operator can
see which interpretation was applied.

### CSV lifetime is NOT the right comparison

For the 2026 audit, comparing `CSV lifetime` to current sheet creates
massive false positives: customers like McDonald who paid off
pre-2026 still have $5K+ CSV lifetime, but their 2026 sheet rows are
correctly $0. Filter:
1. Skip deals with NO 2026 CSV activity AND NO 2026 Profit26 entries
   (these are old paid-off; not 2026 audit material).
2. Compare CSV 2026 only.
3. For col G's 2026 contribution: parse dated note lines (e.g.
   "300 Lancer panayotis 4/12") and sum.
4. Fallback: if NO dated col G entries exist but cell value > 0,
   assume the value is 2026 (Vlad sometimes types the amount
   without a date). Only valid when the deal HAS 2026 CSV activity.

### Auto-linking bugs that wasted hours

The auto-linker we built Day 10 has these failure modes:

1. **VIN-multi**: when one CSV VIN appears on multiple custaccountnos
   (refi/rebuy), the script picked the most-recently-active. Wrong
   when the customer has multiple cars on different VINs but DMS
   crossed them. Caught Carter / Toro / Lopez Cruz / Logan Passat —
   all auto-vin links pointing at the wrong customer's car.
2. **auto-name-active**: "single 2026-active candidate per surname"
   linked Bing Challenger to Bing's Tesla account because there was
   only one active Bing in csv_accounts.
3. **Same surname, different car**: Krouse 05 Ranger deal (Vlad
   collected cash, no DMS account) auto-linked to Krouse 14 Equinox
   account. The audit then treated Equinox CSV payments ($200 4/24)
   as Ranger payments. Symptom: rebuild added $200 to Ranger,
   removed the real $208 cash entry as "orphan."

**Defensive auto-link rules** added to `autolink_remaining.py`:
- ONLY link when (a) account has no inv data → can't be disproven,
  OR (b) year + model both match the deal car_desc.
- Reject "single-surname" matches when the account has CLEAR inv
  data that disagrees with the deal (e.g., Bing Challenger linking
  to Bing's Tesla).

### Sheet write hazards

Two Apps Script behaviors that bit us today:

1. **Supabase `deals26.sort_order` is NOT the sheet row.** Sheet row
   = sort_order + 1 (header offset). Passing sort_order directly to
   `deals26_append_payment_direct` writes one row above the intended
   deal. Apps Script's surname matcher catches some but not all,
   producing scattered wrong-row writes. Always pass sort_order + 1.

2. **`deals26_append_payment_direct` rewrites the surname** in the
   note line you pass when the row's car_desc surname doesn't match.
   Mangled "logan" → "silverado", "davis" → "model", etc. Workarounds:
   - Pass empty `last_names` array AND `bypass_surname_check: true`
   - Or skip this action entirely; build the full payment_notes blob
     yourself and write via `correct_payments` (which writes notes
     literally without rewriting).

3. **Race condition: parallel --apply runs corrupt the sheet.** A
   killed-but-not-killed Python process can still be writing while
   a new one starts. Both fire on the same data, both add the same
   entries. Result: 28 duplicates from one race. Fix: lockfile at
   `scripts/.audit_2026.lock`, refused if <30 min old.

### Tools shipped this day (in order)

| Script | Purpose |
|---|---|
| `scripts/_csv_filter.py` | Canonical CSV filter — `is_real_payment` + `real_amount`. Used by all sync/audit scripts. |
| `scripts/sync_csv_accounts.py` | Refresh csv_accounts (now uses canonical filter). |
| `scripts/auto_link_accounts.py` | Auto-link by VIN, year+model, with conservative fallbacks. |
| `scripts/autolink_remaining.py` | Catches deals missed by primary autolink (no-inv accounts). |
| `scripts/audit_2026.py` | Per-deal April reconciliation with corrections. Lockfile-protected. |
| `scripts/audit_per_customer.py` | "Rivera method" — per-customer per-month CSV vs sheet count. |
| `scripts/audit_threshold_aware.py` | Conservation-rule audit: 2026-only, best-fit between col_G and col_G+Profit26. |
| `scripts/rebuild_april_profit.py` | Rebuild April Profit26 from CSV truth (5-phase pairing: exact date, date-fix, undated-fix, cross-lot, add-new). |
| `scripts/rollback_audit_adds.py` | Reverse entries added by an audit_2026 --apply run (reads the log). |
| `scripts/find_duplicates.py` | Detect exact-line duplicates across all sheet cells. |
| `scripts/verify_dupes.py` | Per-customer CSV check — distinguishes real dupes from legitimate recurring same-amount payments. |
| `scripts/dedupe_sheet.py` | Remove one copy of each duplicate via profit_remove_entry / correct_payments. |
| `scripts/fix_misplaced_col_g.py` | Detect col G entries on wrong rows (surname mismatch); move to correct row. |
| `scripts/restore_surnames.py` | Fix surnames mangled by Apps Script's `_rewriteNoteLineLastName`. |
| `scripts/verify_links.py` | Sanity-check existing deal_account_links by year+model match. |

### What we couldn't solve

After all the work, the 2026 audit ends with 281 deals, 30 balanced,
102 OVER ($92k), 149 UNDER ($118k). Vlad's intuition: "There's no
possible way that much money is missing." He's right — most of that
delta is **noise from undated col G entries that the audit can't
classify as 2026 or pre-2026.**

The fundamental limit: col G has historically been used as a running
ledger without consistent dating. Vlad's pattern varies — some entries
are dated, others are just amounts. Without dates, the audit can't
tell 2026 from history. Best-effort = noise.

### What unblocks proper auditing (not yet built)

A `deal_payments` table per Day 10 end-state vision:
```sql
CREATE TABLE deal_payments (
    id BIGSERIAL PRIMARY KEY,
    deal_key TEXT NOT NULL,           -- 'Deals26:DeBary:5'
    custaccountno TEXT,                -- linked CSV account
    payment_date DATE NOT NULL,        -- the actual payment date
    amount NUMERIC NOT NULL,
    source TEXT NOT NULL,              -- 'csv' | 'app' | 'carpay' | 'cash-noncsv'
    csv_paiddate TEXT,                 -- DMS paiddate raw
    csv_transtype TEXT,                -- PAYMENT/LATEFEE/PAY OFF/PAYPICK
    csv_reference TEXT,
    threshold_portion NUMERIC,         -- if split (filling F=0)
    profit_portion NUMERIC,            -- if split (overflow)
    notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

Once every payment has its own row with a date, `deal_key`, and
amount, the audit is a clean SQL join — no surname matching, no
date-guessing on col G entries. `col G` and `Profit26` regenerate
from this table.

Until built, audits remain best-effort against the legacy sheet.

### Standing rules going forward

1. **Don't run --apply twice in parallel.** Always check the
   lockfile or use `scripts/.audit_2026.lock` pattern.
2. **Don't trust "single surname match" for auto-linking.** Require
   year+model agreement OR an account with no inv data (defensible).
3. **Don't add to col G via `deals26_append_payment_direct` blindly.**
   Apps Script will rewrite the surname. Use `correct_payments` with
   the full notes blob you computed, OR pass `bypass_surname_check`
   AND `last_names: []`.
4. **Always pass sort_order + 1 for Deals26 row writes.**
5. **CSV lifetime is the wrong comparison for 2026 audits.** Filter
   to 2026 transactions only.
6. **CSV is gold but not perfect.** PT WRITEOFF labels mean "off
   schedule" not "not collected" — verify with Vlad on suspicious
   accounts before assuming bad data.
7. **The audit produces suspicions, not facts.** Operator review
   per case is required for any historical mismatch. Best-effort.
8. **Inflation is the worse sin** — when a case is genuinely
   ambiguous and both readings are plausible, prefer the one that
   under-counts profit. Better to miss legitimate income than to
   pay tax on phantom income.

### Open questions for the next session

- Which OVER cases (~$92k) are real inflation vs legitimate non-CSV
  cash sales (cars Vlad sold for cash without going through DMS)?
- Which UNDER cases (~$118k) are real backlogged payments vs
  customers whose DMS records aren't accurate?
- Should we backfill col G with CSV truth in bulk, or only for
  specific high-confidence customers (Panayotis-style)?
- Build `deal_payments` table now or keep iterating on the legacy
  sheet?

These are decisions for Vlad after he's had time to think. Today's
audit infrastructure is committed and ready — it produces honest
suspicions; acting on them is operator work.

---

## Day 11 — inventory linking + drift defenses (2026-04-30)

### Audit-created inventory rows MUST carry SoldInventory data

When an audit pass creates new inventory rows for unlinked d26 deals
(d26 rows where `sold_inv_vin=''`), always pre-populate `vin` and
`stock` from SoldInventory CSV. Empty VIN is a UX trap — every picker
in the app uses VIN as the join key, so an empty-VIN inventory row
appears clickable but writes empty string when tapped.

**Matching strategy** (use this in any future audit-created-inventory
script):

1. Build a (year, make, model_lower) index of SoldInventory rows.
2. For each unlinked d26 row, parse year/make/model from `car_desc`.
3. Check candidates by year+make. Apply loose model match:
   - exact match
   - substring either direction ('caravan' in 'grand caravan')
   - BMW series mapping ('328i' → '3-series', '528i' → '5-series')
   - token intersection
4. Dedupe candidates by VIN. Distinct VIN count:
   - 1 → auto-fill (`{vin, stock}`).
   - 2+ → leave empty; the in-app chooser will surface candidates.
   - 0 → leave empty; manual prompt.

The app's `_findSoldInvCandidates` (in `index.html`) is the canonical
client-side implementation of the same logic. Server-side audits that
pre-populate inventory rows must produce the same result so the
"taps to add VIN" affordance only appears for genuinely ambiguous /
unmatchable cases.

### Drift defenses for review reasons

A `payment_reviews.reason` field can drift from a posting reason
(`deal_pending`, `cash_sale_pending`, `cash_sale_correction`) to
`multiple` from some unidentified path. Don't try to find the trigger
— defend in three places:

1. **Preserve in `_reviewRematch`** (client) — never overwrite a
   posting reason.
2. **Dispatch by fingerprint** in `_reviewApprovePending` (client) —
   ignore the reason field; pick the handler from the snapshot
   shape (`snap.ic+inv` → deal_pending, `snap.posted_amount` →
   cash_sale_correction, `deal_id+null payment_id` →
   cash_sale_pending).
3. **Cron restore** in `review_revalidate.py` — flip reason='multiple'
   rows back to their fingerprint reason once per cron pass.

Same fingerprint logic decides Sales-tab vs Inventory-tab membership
(`_reviewIsSales` / `_reviewIsInv`).

### Tax-pull on approval

Don't approve a deal-pending review if `taxes` haven't been pulled
yet — the post lands and Profit26 is short by the tax amount.
`_reviewApprovePending` for `cash_sale_pending` and `deal_pending`
must call `_fetchLatestTaxForVin(vin)` before posting. Banner
(`_checkStaleCsvForReview`) detects stale taxes for in-state
non-voided d26 rows and surfaces a tap-to-fix.

### Profit drift sweep

`scripts/profit_sweep.py` runs every 2 hours (cron `15 12,14,16,18,20,22,0`).
Token-matches Profit26 lines against d26 deals (cash + finance) and
queues `cash_sale_correction` reviews when sheet-vs-d26 differs by
more than $1. Set `row_type` ('cash_sales' or 'payments') on the
review snapshot so the dispatcher knows which sheet section to fix.

### CarPay sync — fail loud, service-role only

`scripts/carpay-sync.js` must:
- Throw on any non-OK HTTP response (don't swallow 401/4xx).
- Use the service-role JWT in `SUPABASE_KEY` (anon is silently
  rejected by RLS).
- Stamp `synced_at` on every row.
- Refuse to wipe Supabase if both DeBary and DeLand CSVs return 0+0.

Verify the GitHub secret is service-role with: `decode the JWT
payload — `role` should be `service_role`.

### Handling deal deletion / void cleanup

Pending `payment_reviews` for a deleted/voided deal become orphans.
`_cleanupReviewsForDeal` runs from `dealDeleteFinal` and
`dealReturnFinal`. `review_revalidate.py` does the same via
`load_deal_ids()` orphan check on every cron pass. Don't leave
orphan reviews.

---

## Day 12 — deal posting, vehicle cascade, note formatting (2026-05-02)

### Deposit handling: deals26.money = full total_collected

**Rule: NEVER subtract deposits from `deals26.money`.**

`_autopopulateDeals26(record, car, icOverride)` sets:
```javascript
var money = parseFloat(record.total_collected) || 0;
```

This is the FULL amount collected for the deal — deposit + day-of-sale
cash + pickup payments. Example: if a customer put down a $1,000
deposit last week and paid $1,000 cash at signing, `total_collected`
is $2,000. `money` = $2,000. The deposit is part of the deal's total
collected, not a deduction.

**Where deposit subtraction DOES apply:** only in payment ROW posting
(lines ~25155–25212 of index.html). When the app creates individual
payment rows for a newly posted deal, it detects prior deposit rows
(`raw_ocr_text` starting with `"Deposit —"`) and subtracts the
deposit amount from the day-of-sale cash row. This prevents
double-posting: the deposit was already recorded as its own payment
row, so the cash row should only reflect the non-deposit portion.

**Anti-pattern (Day 12 lesson):** An earlier attempt subtracted
deposits inside `_autopopulateDeals26` itself — this caused the
Deals26 row's money/owed to be wrong (e.g., Holliday 14 Outlander
Sport showed $1,000 money instead of $2,000, which cascaded into
the breakeven/owed calculation and would have corrupted future profit
tracking). The subtraction was reverted and the deal's data corrected.

### Vehicle cascade on VIN re-link

Two paths cascade vehicle info to payment rows when the linked
vehicle changes:

1. **`dealEditSave`** — when editing a deal's vehicle fields directly
   in the deal detail view, all payment rows with the old VIN are
   patched with the new vehicle year/make/model/color/VIN. The
   `raw_ocr_text` prefix (`"Deal — "` or `"Deposit — "`) is preserved
   and the vehicle description updated.

2. **`d26LinkSelect(vin)`** — when re-linking a deals26 row to a
   different inventory car via the VIN picker. Queries the `inventory`
   table for the new VIN's `name` and `color`, parses year/make/model
   from the name, then patches every payment row that had the OLD VIN:
   - `vehicle_vin`, `vehicle_year`, `vehicle_make`, `vehicle_model`,
     `vehicle_color`
   - `raw_ocr_text` prefix preserved (`"Deal — "` / `"Deposit — "`)
     with updated vehicle description.

Both paths log to console (`cascaded vehicle info to N payment(s)`).
Failure on individual payment updates is caught and logged but doesn't
block the VIN re-link itself.

**Why this matters:** payment rows carry vehicle metadata used by
the matcher, Review UI cards, and the GPS sync bookmarklet. Stale
vehicle info on payments causes mis-routing and confusing displays.
When Jesse accidentally posted a deal under the wrong vehicle (2018
Outlander instead of 2014 Outlander Sport), the cascade ensured that
fixing the VIN on the deals26 row also fixed all associated payment
rows automatically.

### GPS sync: resetting gps_uploaded

The `gps_uploaded` flag on the `deals` table controls whether the
GPS sync bookmarklet (Passtime portal) shows a deal as pending for
serial upload. When vehicle info was wrong at the time of sync (deal
was synced under the wrong car), set `gps_uploaded = false` on the
deal so it reappears in the bookmarklet's pending list for re-sync
with the corrected vehicle info.

Edge function `gps-sync` (`supabase/functions/gps-sync/index.ts`)
returns deals where `gps_uploaded=false AND gps_serial IS NOT NULL
AND voided_at IS NULL`. The `mark_uploaded` action sets
`gps_uploaded=true` after the bookmarklet completes the Passtime
portal entry.

### Payment note formatting

**Dollar signs on amounts.** All payment note builders now prefix
amounts with `$`:

- `_paymentNoteLine(amount, payload)` → `$350 14 Camry blue smith 5/1`
- `_paymentNoteLineFromDeal(amount, carDesc, date)` → same format
- `_paymentDescFromPayload(payload)` → `$350 14 Camry blue smith 5/1`
- `_pfBeBuild` note lines → `$350 description` (or `-$50 description`
  for negatives)

All parsers updated to accept the optional `$` prefix:
```javascript
var m = l.match(/^(-?\$?\d+(?:\.\d+)?)\s+(.+)$/);
```

**Truncation order for 26-char budget.** `_paymentNoteLineFit` fits
note entries into 26 characters. When the line is too long, pieces
drop in this priority order (least important dropped first):

1. Full line: `$350 14 Camry blue smith 5/1`
2. Drop **year** (least important): `$350 Camry blue smith 5/1`
3. Drop **color** (year already gone): `$350 Camry smith 5/1`
4. Shorten **model** to first token: `$350 Cam smith 5/1`
5. Truncate **lastName** to whatever fits (most important — kept
   longest)

**Importance hierarchy: lastName > model > color > year.** The
lastName and model are the most important for identifying which deal
a payment belongs to. Year is least important because it's usually
obvious from context (most deals are for the same-era vehicles).

---

## Day 13 — Account # deterministic linking (2026-05-02)

### Problem

~20% of deals couldn't auto-link to CSV accounts. The fuzzy matching
(VIN → name+year+model) failed on cosigners, name variants, VIN-multi
cases. Manual linking was tedious and the biggest recurring pain point.

### Discovery

Every scanned payment receipt contains `Account # XXXX` in the OCR
text — 100% hit rate across 30 receipts checked. This number is the
DMS `custaccountno`, which is the primary key in `csv_accounts`.

### Solution: parse Account # at scan time

**Changes made (v629):**

1. **Gemini OCR prompt** — added `account_number` field (#10 in the
   extraction list). Instructs Gemini to look for "Account #",
   "Account No", "Acct #" etc.

2. **Regex fallback** — if Gemini misses it, a regex runs on rawText:
   ```javascript
   /(?:Account|Acct)\s*(?:#|No\.?|Number)?\s*[:.]?\s*(\d{3,6})/i
   ```

3. **Hidden form field** — `<input id="pay-scan-acct" type="hidden"/>`
   stores the parsed Account # through the form lifecycle.

4. **Supabase `payments.custaccountno`** — new text column. Every
   payment now stores the Account # from the receipt.

5. **Routing priority in `_appendPaymentToDeals26()`:**
   ```
   custaccountno → deal_account_links lookup → direct write (highest priority)
     ↓ (no link found)
   alias → payment_deal_aliases lookup → direct write
     ↓ (no alias)
   matcher → Apps Script fuzzy match → write or queue Review
   ```

6. **Auto-link creation** — when a payment WITH a custaccountno gets
   matched through alias or matcher, `_autoCreateDealAccountLink()`
   fires and creates the `deal_account_links` row with
   `linked_by: 'auto-ocr-acct'`. Future payments for the same account
   skip fuzzy matching entirely.

### The flow

```
Receipt scan
  → Gemini OCR extracts Account # 4053
  → pay-scan-acct = "4053"
  → payScanSave() stores custaccountno="4053" on payment
  → _appendPaymentToDeals26():
      1. Has custaccountno? → check deal_account_links for 4053
         → FOUND: direct write to deal row (skip everything else)
         → NOT FOUND: fall through
      2. Check payment_deal_aliases (VIN/name match)
         → MATCHED: write + auto-create deal_account_link for 4053
      3. Apps Script fuzzy matcher (last_name + model)
         → MATCHED: write + auto-create deal_account_link for 4053
         → NO MATCH: queue for Review
```

### Self-healing property

The first scanned receipt for any customer permanently establishes the
`deal_account_link`. Even if that first payment routes through the
fuzzy matcher or alias, the link gets created. All subsequent CSV
payments for that custaccountno auto-route through the link — no more
manual linking needed.

### Anti-patterns

- **Do NOT extract Account # from payments that have Deal/Deposit
  prefixes in `raw_ocr_text`.** Those are auto-posted from deal
  approvals, not scanned receipts. The `_profitShouldPropagate()`
  check already filters them out before reaching the acct logic.

- **Do NOT overwrite existing deal_account_links.** The auto-create
  function checks for existing links first. One account → one deal.
  If the customer gets a new car, the link stays with the old deal
  until manually updated (cosigner/trade-in edge case).

## Day 13 (cont.) — CarPay vehicle triangulation (2026-05-02)

### The problem

CarPay customers had no vehicle info in Supabase. The CarPay portal
list page shows name, account, stock #, and VIN last 6 — but not the
actual car. We need the vehicle description on every CarPay customer
record so the app can display it and so payment routing can validate
that a link is correct.

### The triangle

Three independent data sources each know something about the car:

```
        CarPay portal
       (stock_no, vin_last6)
            /         \
           /           \
     DMS CSVs          App data
  (csv_accounts:     (inventory table +
   year/make/model    deals table:
   by custaccountno   vehicle_desc/VIN
   or stock_no)       by stock or VIN)
```

**When two or more sources agree on the vehicle for a given account,
the link is validated.** This is the confirmation mechanism — not just
gap-filling but cross-checking that the account→deal link is right.

### The 6-step resolution chain

CarPay sync (`carpay-sync.js`) resolves vehicle for each customer
using this priority:

1. **csv_accounts by custaccountno** — DMS gold standard, 1:1 with
   customer, never reused. Loads ALL records (active + inactive)
   because a CarPay customer may still be paying after DMS marks
   their deal inactive.

2. **csv_accounts by stock_no** — fallback when account has no
   vehicle data. Active-only map to avoid stale stock_no reuse
   collisions (stock numbers get recycled across deals).

3. **App inventory + deals by stock_no** — the `inventory` table
   (older stock list) and `deals` table (where Manny/Jesse log new
   sales from the app) are merged into one lookup. Deals overwrite
   inventory for same stock since they're newer.

4. **App inventory + deals by VIN last 6** — catches cases where
   CarPay's stock_no doesn't match but the VIN does (stock_no
   mismatches, reassignments).

5. **deal_account_links car_desc** — last resort. Parses the "YY
   Model" prefix from the sheet's car description (e.g.
   "08 Sentra blue 197k Adams" → "08 Sentra"). Less precise
   (no make), but better than nothing.

6. **Give up** — no data anywhere. Customer is brand new or
   ancient/dead. Will auto-resolve once any source picks them up.

### Why each source matters

| Source | Strength | Weakness |
|---|---|---|
| csv_accounts (DMS) | Has year/make/model, keyed by account | Sold Inventory CSV can be stale; new deals may have empty vehicle fields |
| App deals table | Has newest sales immediately (Manny logs them same day) | Only covers deals since the app launched |
| App inventory table | Broad stock coverage | Doesn't include every sold car |
| CarPay portal | Has stock_no + VIN last 6 for every customer | No vehicle description — just identifiers |
| deal_account_links | Has car_desc from sheet | Partial info only ("08 Sentra" not "08 Nissan Sentra") |

### Bugs found and fixed

1. **Preserved vehicle override** — `applyPreserved()` copied stale
   vehicle names from old DB records before resolution ran, and the
   `if (!c.vehicle)` guard skipped the lookup. Wrong vehicles
   persisted forever. **Fix:** csv_accounts always overwrites
   preserved values.

2. **Stock-first lookup + active-only filter** — stock_no gets
   recycled (e.g. stock 25252 = Acevedo's Genesis then Vazquez's
   Sequoia). Old code tried stock_no first from an active-only
   query, so Acevedo got Vazquez's car. **Fix:** account lookup
   first (deterministic, never reused); stock_no as fallback.

3. **Missing deals table** — inventory table didn't have recent
   sales logged through the app. Rembert (17 BMW 3-Series, deal
   logged by Manny Apr 17) was invisible. **Fix:** merged
   inventory + deals into unified lookup.

### Results

| Stage | Resolved | Rate |
|---|---|---|
| csv_accounts only (stock-first, active-only) | 215/261 | 82% |
| Account-first + inactive records | 235/261 | 90% |
| + deal_account_links car_desc | 244/261 | 93% |
| + app inventory by stock + VIN | 252/261 | 97% |
| + app deals table | 260/261 | **99.6%** |

The one unresolved: Perez Vasquez, Marcos — account 2505, stock
22-363, 1,160 days late, last payment due Feb 2023. Ancient dead
account not in any system.

### Anti-patterns

- **Never trust stock_no alone for vehicle lookup.** Stock numbers
  get recycled. Always prefer custaccountno (1:1 with customer).

- **Never filter csv_accounts to active-only for the account map.**
  CarPay customers keep paying after DMS marks them inactive. The
  stock map should be active-only (to avoid reuse collisions), but
  the account map must include everything.

- **Don't skip the deals table.** New sales show up there first —
  days or weeks before they appear in DMS CSV exports or Sold
  Inventory CSVs. The Sold Inventory CSVs can be months stale
  (DeLand was 8 months behind as of May 2026).

- **Preserved vehicle values are not authoritative.** They come from
  prior sync runs and may reflect old bugs. Any resolved value from
  the triangulation chain always overwrites the preserved value.

- **csv_accounts stock lookup must verify the account matches.**
  When `byStock[stock_no]` returns a record with a different
  `custaccountno`, it's someone else's car on a reused stock.
  Skip it and let inventory/deals resolve (they have the right
  answer). Example: Bruten (4579) stock 25200 → csv said Todd's
  F250SD; Santiago (4558) stock 26099 → csv said Spencer's Optima.
  Both wrong. The triangulation caught it — sheet car_desc
  disagreed with the sync vehicle.

- **Use triangulation to validate links, not just fill gaps.**
  When the sync vehicle disagrees with the sheet car_desc from
  `carpay_payment_postings`, the link is wrong. The May 2026
  cross-check caught Bruten and Santiago this way — two bad
  vehicles that would have gone unnoticed without the three-way
  comparison.
