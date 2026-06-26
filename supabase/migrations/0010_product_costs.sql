-- ============================================================================
-- 0010_product_costs.sql
-- Manual COGS per product, keyed by Shopify product id. Independent of the
-- products catalog, so a cost can be set for ANY product that was sold —
-- even products that are no longer in (or were never synced to) the catalog.
-- Stored in the store's base currency.
-- ============================================================================

create table if not exists public.product_costs (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  shopify_product_id text not null,
  cost               numeric(12,2) not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, shopify_product_id)
);

create index if not exists idx_product_costs_user
  on public.product_costs (user_id);

create trigger trg_product_costs_updated_at
  before update on public.product_costs
  for each row execute function public.set_updated_at();

alter table public.product_costs enable row level security;

create policy "product_costs_select_own" on public.product_costs
  for select using (auth.uid() = user_id);
create policy "product_costs_insert_own" on public.product_costs
  for insert with check (auth.uid() = user_id);
create policy "product_costs_update_own" on public.product_costs
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "product_costs_delete_own" on public.product_costs
  for delete using (auth.uid() = user_id);
