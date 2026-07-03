-- ============================================================================
-- 0018_product_costs_history.sql
-- Effective-dated COGS. Before this, product_costs held ONE cost per product,
-- applied to the whole order history — so changing a cost rewrote past profit.
-- Now a product can have several dated costs; each order uses the cost that was
-- in effect on its own date. Costs are also stored in the currency they were
-- entered in (so "12.7 €" stays exactly 12.70 instead of round-tripping through
-- the store's base currency).
-- Additive & non-destructive.
-- ============================================================================

alter table public.product_costs
  add column if not exists effective_from date not null default '2000-01-01',
  add column if not exists currency text;   -- NULL = already in the store base currency

-- Allow multiple dated rows per product: key on (user, product, effective_from).
alter table public.product_costs
  drop constraint if exists product_costs_user_id_shopify_product_id_key;

alter table public.product_costs
  add constraint product_costs_user_product_from_key
  unique (user_id, shopify_product_id, effective_from);

create index if not exists idx_product_costs_user_product
  on public.product_costs (user_id, shopify_product_id, effective_from);
