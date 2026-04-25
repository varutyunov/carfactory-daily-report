-- Audit + history layer (run in Supabase SQL editor)
-- https://supabase.com/dashboard/project/hphlouzqlimainczuqyc/sql/new

-- ─────────────────────────────────────────────────────────────────
-- 1. audit_log — every meaningful write logs here with before/after
-- ─────────────────────────────────────────────────────────────────
create table if not exists audit_log (
  id            bigserial primary key,
  ts            timestamptz not null default now(),
  actor         text,                          -- user name or 'system'/'carpay-sync'
  action        text not null,                 -- 'deal_upload', 'review_approve',
                                               -- 'carpay_auto_post', 'sheet_write',
                                               -- 'ic_create', 'ic_cost_update',
                                               -- 'ic_archive', 'deal_num_resequence',
                                               -- 'row_drift_detected', etc.
  target_type   text not null,                 -- 'deals26_row' / 'inventory_costs' /
                                               -- 'profit26_cell' / 'payment_review' /
                                               -- 'deals' / 'deal_link'
  target_key    text,                          -- location+tab+row OR supabase id OR VIN
  before        jsonb,                         -- snapshot before the write
  after         jsonb,                         -- snapshot after the write
  context       jsonb not null default '{}'::jsonb,  -- review_id, customer, amount, etc
  review_id     bigint references payment_reviews(id) on delete set null,
  success       boolean not null default true,
  error         text
);

create index if not exists audit_log_ts_idx on audit_log (ts desc);
create index if not exists audit_log_action_idx on audit_log (action, ts desc);
create index if not exists audit_log_target_idx on audit_log (target_type, target_key, ts desc);
create index if not exists audit_log_review_idx on audit_log (review_id) where review_id is not null;
create index if not exists audit_log_context_gin on audit_log using gin (context);

-- ─────────────────────────────────────────────────────────────────
-- 2. inventory_costs — preserve sold rows as history, not delete
-- ─────────────────────────────────────────────────────────────────
alter table inventory_costs add column if not exists sold_at timestamptz;
alter table inventory_costs add column if not exists sold_to_deal_id bigint references deals(id) on delete set null;
create index if not exists inventory_costs_sold_at_idx on inventory_costs (sold_at) where sold_at is not null;
create index if not exists inventory_costs_sold_deal_idx on inventory_costs (sold_to_deal_id) where sold_to_deal_id is not null;
