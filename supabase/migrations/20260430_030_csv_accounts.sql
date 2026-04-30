-- Day 10 — master account database from CSV.
--
-- The dealer system is the source of truth for who owes what. Every
-- payment in Payments/*.csv is keyed on `custaccountno`. This table
-- mirrors that key plus enriched metadata (lookupname, VIN, year,
-- make, model) joined from SoldInventory + activity rollups.
--
-- Refreshed every cron tick by scripts/sync_csv_accounts.py (see
-- inventory-sync.yml). Idempotent: upsert by custaccountno.
--
-- Usage:
--   - reconcile audits: every CSV txn → join to csv_accounts → join to
--     deal_account_links → know exactly which deal it belongs to.
--   - linking UI: search this table when picking a deal's account.

CREATE TABLE IF NOT EXISTS public.csv_accounts (
  custaccountno      text PRIMARY KEY,
  location           text NOT NULL CHECK (location IN ('DeBary', 'DeLand')),
  lookupname         text,
  -- Joined from SoldInventory by lookupname (best-effort; nullable).
  vin                text,
  stock_no           text,
  year               text,
  make               text,
  model              text,
  color              text,
  saledate           date,
  -- Activity rollups across the entire CSV history (not just 2026):
  first_payment_date date,
  last_payment_date  date,
  payment_count      int default 0,
  total_paid_2026    numeric default 0,
  total_paid_lifetime numeric default 0,
  -- Latest CSV transaction type indicates active status: 'PAYMENT'
  -- (still paying), 'PAY OFF' (closed via payoff), etc.
  latest_txn_type    text,
  is_active          boolean default true,
  synced_at          timestamptz default now()
);

CREATE INDEX IF NOT EXISTS csv_accounts_lookupname
  ON public.csv_accounts (upper(lookupname));
CREATE INDEX IF NOT EXISTS csv_accounts_vin
  ON public.csv_accounts (upper(vin)) WHERE vin IS NOT NULL;
CREATE INDEX IF NOT EXISTS csv_accounts_location
  ON public.csv_accounts (location);
CREATE INDEX IF NOT EXISTS csv_accounts_active
  ON public.csv_accounts (is_active) WHERE is_active = true;
