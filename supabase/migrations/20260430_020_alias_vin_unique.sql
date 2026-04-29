-- Day 10 — enforce one alias per VIN.
--
-- Bug: Vlad reported "Review tab not remembering cars" — Karian Jackson
-- 17 Impala kept showing up for review even after he'd approved a
-- previous payment for the same car. Root cause: payment_deal_aliases
-- accumulated multiple rows for the same VIN pointing at DIFFERENT
-- target deals (real bug — Impala VIN 2G1105S38H9165331 had aliases
-- pointing to BOTH the Impala AND a Jetta). _findDealAlias used
-- order=created_at.desc&limit=1, so the most recent alias won
-- regardless of correctness; if the latest one was wrong, every
-- payment for that VIN went to the wrong deal.
--
-- Fix: VIN should uniquely identify a deal target. This partial unique
-- index enforces it at the database level. The frontend's
-- _upsertDealAlias helper now also DELETEs existing same-VIN rows
-- before insert; this index is a backstop for any code path that
-- bypasses the helper.
--
-- Pre-deploy cleanup (already run live):
--   WITH ranked AS (
--     SELECT id, vin,
--       ROW_NUMBER() OVER (PARTITION BY vin ORDER BY created_at DESC, id DESC) AS rn
--       FROM public.payment_deal_aliases
--      WHERE vin IS NOT NULL AND vin <> ''
--   )
--   DELETE FROM public.payment_deal_aliases
--    WHERE id IN (SELECT id FROM ranked WHERE rn > 1);
-- Removed 6 dupes total: 1 wrong-target (Karian Jackson Impala→Jetta)
-- + 5 same-target dupes (Torres, Ferrer, Perez, Lopez, Borroto).

CREATE UNIQUE INDEX IF NOT EXISTS payment_deal_aliases_vin_unique
  ON public.payment_deal_aliases (vin)
  WHERE vin IS NOT NULL AND vin <> '';

-- Verify:
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND tablename='payment_deal_aliases';
