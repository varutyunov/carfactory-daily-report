-- profit_postings: structured ledger for every Profit26 line.
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/sql/new
--
-- Replaces freeform-text matching for idempotency. Every time the app
-- writes a line into Profit26 (Cash Sales, Payments, Extras), it also
-- inserts a row here keyed on the originating record. Then auto-stale,
-- duplicate detection, and reconciliation become structured queries.
--
-- Source key: (source, source_id, source_sub) is the natural key.
--   source       = 'deal' | 'payment' | 'cash_payout' | 'manual'
--   source_id    = primary id in that table (deals.id, payments.id, …)
--   source_sub   = optional discriminator (e.g. 'principal' vs 'late_fee')
--
-- A row with voided_at IS NULL is "live". When a posting is removed or
-- replaced we set voided_at + voided_reason and (for replacement) point
-- replaces_id at the new row, preserving full history.

create table if not exists profit_postings (
  id            bigserial primary key,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  -- Where it lives in the Profit26 sheet
  location      text not null,                -- 'DeBary' | 'DeLand'
  month_idx     int  not null,                -- 0..11
  row_type      text not null,                -- 'cash_sales' | 'payments' | 'extras'

  -- Where it came from
  source        text not null,                -- 'deal' | 'payment' | 'cash_payout' | 'manual'
  source_id     bigint,                       -- id in originating table
  source_sub    text,                         -- optional discriminator

  -- The post itself
  amount        numeric(10,2) not null,       -- whole-dollar values still stored as numeric
  description   text not null,                -- the note line (unprefixed)
  vin           text,                         -- duplicated from source for fast lookup

  -- Lifecycle
  posted_at     timestamptz not null default now(),
  voided_at     timestamptz,
  voided_reason text,
  replaces_id   bigint references profit_postings(id) on delete set null,

  -- Free-form context (deal_id, payment timestamps, etc.) for forensics
  context       jsonb not null default '{}'::jsonb
);

-- Active idempotency key — only one live posting per source identity.
create unique index if not exists profit_postings_source_unique
  on profit_postings (source, source_id, coalesce(source_sub,''))
  where voided_at is null;

-- Lookup indexes
create index if not exists profit_postings_loc_month_type_idx
  on profit_postings (location, month_idx, row_type)
  where voided_at is null;

create index if not exists profit_postings_vin_idx
  on profit_postings (vin)
  where voided_at is null and vin is not null;

create index if not exists profit_postings_amount_idx
  on profit_postings (amount, location, month_idx, row_type)
  where voided_at is null;

-- updated_at trigger
create or replace function _set_profit_postings_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists profit_postings_updated_at on profit_postings;
create trigger profit_postings_updated_at
  before update on profit_postings
  for each row
  execute function _set_profit_postings_updated_at();

-- Enable RLS but allow all (matches existing tables in this project)
alter table profit_postings enable row level security;

drop policy if exists "profit_postings all" on profit_postings;
create policy "profit_postings all" on profit_postings
  for all
  using (true)
  with check (true);
