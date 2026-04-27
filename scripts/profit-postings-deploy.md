# Deploy: profit_postings ledger

Replaces freeform-text matching (`_findCashSaleMatchLoose`) with a
structured Supabase ledger keyed on `(source, source_id, source_sub)`.
Once deployed, every new Profit26 post writes a ledger row, and review
auto-stale uses ledger-first lookup with the loose matcher as fallback
during the transition.

## 1. Run the schema migration

Open the Supabase SQL editor:
https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/sql/new

Paste and run `scripts/profit-postings-schema.sql`. Verify with:

```sql
select count(*) from profit_postings;            -- should return 0
\d profit_postings                                -- shows columns
select indexname from pg_indexes where tablename='profit_postings';
```

Expected indexes:
- `profit_postings_pkey`
- `profit_postings_source_unique`
- `profit_postings_loc_month_type_idx`
- `profit_postings_vin_idx`
- `profit_postings_amount_idx`

## 2. Deploy index.html

The new helpers (`cfPostProfit`, `cfVoidProfitPosting`, `cfFindPosting`)
ship with index.html. Push from `/c/Users/Vlad/Desktop/carfactory` so
both `master` and `main` get the update (per CLAUDE.md).

The SW cache version is bumped so clients pick up the new code on next
load.

## 3. (Optional) Backfill from existing Profit26 notes

In the browser console on https://carfactory.work:

```js
await _cfBackfillProfitPostings();
```

This scans the Supabase `profit` mirror and creates `manual`-source
ledger rows for every existing line so historical data is queryable. It
is idempotent — safe to re-run.

## 4. Verify

After at least one new payment posts, check:

```sql
select * from profit_postings order by id desc limit 5;
```

You should see a row with `source='payment'`, the originating
`payments.id`, the live amount, and the description that landed in the
sheet.

## Rollback

The new code paths fall back to the existing loose matcher when the
ledger has no row for a given source. If anything misbehaves, drop the
table:

```sql
drop table profit_postings cascade;
```

…and the app continues to work via the legacy text-matching path with
no further action needed.
