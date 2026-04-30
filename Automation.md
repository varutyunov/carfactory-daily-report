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
| PAY OFF | NETPAYOFF/PTWRITEOFF | ❌ | partial writeoff |
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
