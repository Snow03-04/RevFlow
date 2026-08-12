-- ============================================================================
-- 0031_order_supplier_costs.sql
-- Exact supplier cost per order, taken straight from the supplier sheet. The
-- recompute uses this as the order's total product cost when present, so volume
-- discounts / bundles (e.g. 2 pairs = 18, 3 = 27) match reality exactly instead
-- of being approximated by the per-product COGS. Orders NOT in the sheet fall
-- back to the derived per-product costs.
-- ============================================================================

create table if not exists public.order_supplier_costs (
  user_id      uuid not null references auth.users (id) on delete cascade,
  order_number text not null,               -- digits-only Shopify order number
  cost         numeric(12,2) not null,
  currency     text,                         -- currency the cost is stored in
  paid         boolean not null default false,
  updated_at   timestamptz not null default now(),
  primary key (user_id, order_number)
);

alter table public.order_supplier_costs enable row level security;
create policy "osc_sel" on public.order_supplier_costs
  for select using (auth.uid() = user_id);
create policy "osc_ins" on public.order_supplier_costs
  for insert with check (auth.uid() = user_id);
create policy "osc_upd" on public.order_supplier_costs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "osc_del" on public.order_supplier_costs
  for delete using (auth.uid() = user_id);

notify pgrst, 'reload schema';
