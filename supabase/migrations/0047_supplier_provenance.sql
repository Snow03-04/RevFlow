-- Preserve the exact spreadsheet + tab that supplied an order cost. Legacy
-- history stays unverified until that order is seen in the selected tab again.
alter table public.order_supplier_costs
  add column if not exists source_ref text;

-- Null means this day's cost coverage has not been recomputed yet, not zero.
alter table public.daily_metrics
  add column if not exists supplier_orders_priced integer check (supplier_orders_priced >= 0),
  add column if not exists supplier_orders_unpriced integer check (supplier_orders_unpriced >= 0);

notify pgrst, 'reload schema';
