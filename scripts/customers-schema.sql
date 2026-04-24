-- Customer-deal resolver schema
-- Run in Supabase SQL editor:
--   https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/sql/new

-- ── customers ────────────────────────────────────────────────────────
-- One row per human being. All identifiers that might show up in any
-- payment source (VIN, CarPay account, various name spellings) resolve
-- to this row.
create table if not exists customers (
  id            bigserial primary key,
  name          text not null,              -- canonical display name
  name_aliases  jsonb not null default '[]'::jsonb,  -- ["MILLER, MAHNU", "Mahnu Miller"]
  phone         text,
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists customers_name_lower_idx on customers (lower(name));
create index if not exists customers_aliases_gin on customers using gin (name_aliases);

-- ── deal_links ───────────────────────────────────────────────────────
-- A customer has N deals (sequential or simultaneous). Each deal_link
-- owns its own identifiers — VIN (always unique) and CarPay account
-- (CarPay issues one per car, so also unique per deal). Routes to a
-- specific row in a specific Deals tab at a specific location.
create table if not exists deal_links (
  id              bigserial primary key,
  customer_id     bigint not null references customers(id) on delete cascade,
  location        text not null,              -- 'DeBary' | 'DeLand'
  target_tab      text not null,              -- 'Deals26' | 'Deals25' | 'Deals24'
  target_row      int not null,               -- sheet row number (current)
  deal_num        int,                        -- col J value — stable ID if populated
  vin             text,                       -- unique per car
  carpay_account  text,                       -- unique per car (CarPay issues per vehicle)
  car_desc        text,                       -- snapshot of col B at link time (debug aid)
  active          boolean not null default true,  -- still accepting payments?
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists deal_links_customer_idx on deal_links (customer_id);
create index if not exists deal_links_vin_idx on deal_links (vin) where vin is not null;
create index if not exists deal_links_account_idx on deal_links (carpay_account) where carpay_account is not null;
create index if not exists deal_links_row_idx on deal_links (location, target_tab, target_row);
create unique index if not exists deal_links_vin_unique on deal_links (vin) where vin is not null;
create unique index if not exists deal_links_account_unique on deal_links (carpay_account, location) where carpay_account is not null;
