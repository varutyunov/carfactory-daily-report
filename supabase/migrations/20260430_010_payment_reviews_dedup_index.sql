-- Day 10 — prevent duplicate pending reviews at the DB level.
--
-- Background: the client-side dedup in audit_april_profit.py was
-- matching only on `reason='csv_reconciliation'`, but the same
-- (customer, direction) issue also gets inserted by the live payment
-- processing flow with reason='multiple' / 'no_match'. Result: the
-- queue accumulated 2-3x the same logical card with different reasons.
--
-- This partial unique index makes the database itself reject
-- duplicates, regardless of which code path is inserting. Matched on:
--   upper(trim(customer_name))   — case + whitespace insensitive
--   snapshot->>'direction'        — the underlying issue type
-- Only enforced for pending rows (resolved/rejected don't count).
--
-- The audit script's push_review handler now treats 23505
-- unique_violation as a skipped insert rather than an error.

CREATE UNIQUE INDEX IF NOT EXISTS payment_reviews_pending_unique_dir
  ON public.payment_reviews (
    upper(trim(customer_name)),
    (snapshot->>'direction')
  )
  WHERE status = 'pending'
    AND (snapshot->>'direction') IS NOT NULL;

-- Verify:
-- SELECT indexname FROM pg_indexes
--  WHERE schemaname='public' AND tablename='payment_reviews'
--    AND indexname='payment_reviews_pending_unique_dir';
