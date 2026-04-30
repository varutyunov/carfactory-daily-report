-- Day 10 — manual links from sheet deals to CSV accounts.
--
-- Source-of-truth bridge. A deal in Deals26 / Deals25 / Deals24
-- represents one car sold to one customer. That customer has a
-- custaccountno in the dealer system (csv_accounts). This table maps
-- one to the other.
--
-- Most rows can be auto-linked when sold_inv_vin uniquely identifies a
-- csv_accounts.vin (handled by scripts/auto_link_accounts.py). The
-- ambiguous remainder is surfaced for human pick.
--
-- deal_key format: '{tab}:{location}:{row}'
--   Deals26:DeBary:101
--   Deals25:DeLand:303
-- Stable across re-syncs (sheet rows don't change unless deals shift).

CREATE TABLE IF NOT EXISTS public.deal_account_links (
  id              bigserial PRIMARY KEY,
  deal_key        text NOT NULL UNIQUE,
  deal_tab        text NOT NULL CHECK (deal_tab IN ('Deals26','Deals25','Deals24')),
  deal_loc        text NOT NULL CHECK (deal_loc IN ('DeBary','DeLand')),
  deal_row        int  NOT NULL,
  custaccountno   text NOT NULL REFERENCES public.csv_accounts(custaccountno) ON DELETE CASCADE,
  -- Drift-detection snapshot — if car_desc changes (deal got
  -- overwritten / shifted) we surface for re-confirmation.
  car_desc_at_link text,
  vin_at_link     text,
  linked_at       timestamptz default now(),
  linked_by       text,                  -- email or 'auto-vin' / 'auto-name'
  source          text default 'manual', -- 'auto-vin' | 'auto-name' | 'manual'
  notes           text                    -- free-form (e.g. 'cosigner Maria, primary acct John')
);

CREATE INDEX IF NOT EXISTS deal_account_links_acct
  ON public.deal_account_links (custaccountno);
CREATE INDEX IF NOT EXISTS deal_account_links_tab_loc
  ON public.deal_account_links (deal_tab, deal_loc);

-- One acct can map to MULTIPLE deals (customer trades up). One deal
-- maps to exactly ONE acct (the deal_key UNIQUE constraint).
