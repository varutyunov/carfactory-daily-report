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
| PAYPICK | NETPAYOFF/PTWRITEOFF | ❌ | writeoff variant |
| PAY OFF | NETPAYOFF | ✅ | final balloon payment to close the loan |
| PAY OFF | NETPAYOFF/NOWRITEOFF | ✅ | same — no writeoff applied |
| PAY OFF | NETPAYOFF/WRITEOFF | ❌ | dealer wrote off this amount, not collected |
| PAY OFF | NETPAYOFF/PTWRITEOFF | ❌ | partial writeoff |
| PAYOFF | REFIANCE PAYOFF | ❌ | refinance accounting (no cash) |
| LATEFEE | (any) | ✅ | counts toward total collected, uses `latefee` field |
| DEPOSIT | PAY | ❌ | sale deposit, belongs in col E |
| EARNEDINT | NetPayoff | ❌ | calculated interest, not a payment |

## 8. Apps Script actions — what's available for fixes

| Action | Inputs | What it does |
|---|---|---|
| `read_row` | tab, location, row | Read one Deals row (used to bypass `read_all` timeout on Deals25 DeBary) |
| `find_rows` | tab, location, query | TextFinder search — returns matching rows with full data |
| `read_all` | tab, location | Bulk read (times out on Deals25 DeBary) |
| `read_profit` | location | Read full Profit26 tab (months + items + notes) |
| `profit_append_entry` | month_idx, row_type, amount, description | Add one entry to Payments/Cash Sales/Extras |
| `profit_remove_entry` | month_idx, row_type, amount, description | Remove one matching entry |
| `profit_update_entry` | month_idx, row_type, old_amount/desc, new_amount/desc | Edit one entry |
| `deals26_append_payment_direct` | tab, row, amount, note_line, expected_car_desc | Append to col G formula + note |
| `correct_payments` | tab, row, new_total, new_notes, expected_car_desc | Replace col G total + notes. **BUGGY**: dispatcher's outer tab-config check runs before this action, so it fails with "Unknown tab: undefined" unless `body.tab` is also passed. Use `deals26_set_row_g` instead. |
| `deals26_set_row_g` | tab, row, payments_formula, payment_notes | Atomic set of col G formula + notes. Use for surgical fixes (rebuild a row's formula, replace notes). The right tool for "convert flat $800 to `=500+300` with dated notes". |

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
| 27 | Riel/Encarnacion — 13 Accord DeBary deal #64 | `cash_sale_pending` review regenerated every ~30 min after Vlad manually deleted the Profit26 post — `_sweepUnpostedCashSales` saw the gap and re-queued | Voided deal #64 (`voided_at` + `voided_reason="Manually deleted from Profit26"`); patched sweep + `_queueCashSaleReview` to filter `voided_at=is.null`. Will not regenerate. |
| 28 | Rojas/Jasmine — 17 Pilot DeBary Deals25 row 149 | $450 4/28 CarPay payment landed as `no_vehicle` review — CarPay customer record had no vehicle linked, AND Sheet row labeled by first name "Jasmine" not surname | Threshold-crossing post: $450 → col G of Deals25 row 149 with `bypass_surname_check:true` and note `"450 jasmine 4/28"`; pre-payment owed −$150 → post-payment +$300, so $300 overflow → DeBary Profit26 April Payments. Review #1042 approved. |
| 29 | Goodman jr — 03 RSX red 189k DeLand deal #66 | New finance deal landed as `multiple` review (instead of `deal_pending`); only candidate surfaced was an unrelated Lesabre Goodman in DeBary. Root cause: IC #224 (12 Odyssey white 175k DeBary) was incorrectly linked to `car_id=1369` (the RSX in DeLand), blocking IC #233 (the actual RSX cost row) from ever linking | Re-linked IC #224 → inventory #1359 (correct Odyssey); linked IC #233 → inventory #1369 (RSX); ran `_autopopulateDeals26` → Deals26 DeLand row 64 created with money=$2,288, owed=−$843. Review #802 approved. Row label initially built as "Jr" — patched `_extractSurname` to skip Jr/Sr/II/III suffix tokens; sheet cell corrected to "Goodman". |
| 30 | Inventory review tab spam (228 cards when 5 expected) | `_rvForceScan` flagged every CSV car missing from `inventory_costs` — 222 of those were pre-existing inventory Vlad never tracked, plus duplicates from earlier broken-scan runs | Bulk auto_resolved 223 false-positive reviews (kept 5 truly-new); patched scan to require `inventory.created_at` within 7 days; added `_normalizeIcKey` color aliases (nardo/charcoal → gray, etc.) and trailing-row-number stripping; raised review fetch limit 100→300 so all valid Inventory cards are visible. |

(Will keep extending as we work through the audit list.)
