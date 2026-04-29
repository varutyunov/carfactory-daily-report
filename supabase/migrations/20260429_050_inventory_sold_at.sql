-- Soft-delete for sold cars: keep them in `inventory` for 30 days after they
-- disappear from the dealer master CSV, so staff can still look up VINs,
-- record final payments, or take deposits referencing the just-sold car.
--
-- Behavior change in scripts/inventory-sync.js:
--   • OLD: DELETE FROM inventory WHERE vin NOT IN (csv vins)
--   • NEW: UPDATE inventory SET sold_at = now() WHERE vin NOT IN (csv vins)
--          AND sold_at IS NULL
--          DELETE FROM inventory WHERE sold_at < now() - interval '30 days'
--          UPDATE inventory SET sold_at = NULL WHERE vin IN (csv vins)
--          (the last UPDATE handles re-acquisitions / late corrections)

alter table inventory add column if not exists sold_at timestamptz;

-- Index makes the 30-day cleanup pass cheap.
create index if not exists inventory_sold_at_idx
  on inventory (sold_at)
  where sold_at is not null;

comment on column inventory.sold_at is
  'Set by inventory-sync when a VIN disappears from the dealer master CSV. '
  'Hard-deleted 30 days after this timestamp. Cleared if the VIN reappears in '
  'the CSV (e.g. re-listed after a returned deal).';
