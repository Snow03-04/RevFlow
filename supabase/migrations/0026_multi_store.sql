-- ============================================================================
-- 0026_multi_store.sql
-- Multi-store support. Every sales row (orders, products) and the daily P&L
-- rollup (daily_metrics) gains a `shopify_connection_id` so the dashboard can
-- show ONE store at a time OR all stores combined (summed on read). Ad accounts
-- (Meta / Google) gain an OPTIONAL link to a store so their spend can be
-- attributed per store from the Connections page.
--
-- Backfill assigns every pre-existing row to each user's OLDEST Shopify
-- connection — there is a single store per account today, so this is exact.
-- Additive & non-destructive, except swapping daily_metrics' uniqueness to add
-- the store dimension (one row per store/day instead of one per day).
-- ============================================================================

-- 1. Store dimension on the source rows + the rollup. Deleting a store removes
--    its sales/metrics (cascade), matching how a disconnect already works.
alter table public.orders
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete cascade;

alter table public.products
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete cascade;

alter table public.daily_metrics
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete cascade;

-- 2. Ad-account -> store mapping (nullable: an unmapped account contributes to
--    no store until assigned). on delete set null so removing a store doesn't
--    delete the ad account, just detaches it.
alter table public.meta_connections
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete set null;

alter table public.google_connections
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete set null;

-- 3. Backfill: each user's OLDEST Shopify connection is their single store today.
with primary_store as (
  select distinct on (user_id) user_id, id
  from public.shopify_connections
  order by user_id, created_at
)
update public.orders o set shopify_connection_id = ps.id
  from primary_store ps
 where ps.user_id = o.user_id and o.shopify_connection_id is null;

with primary_store as (
  select distinct on (user_id) user_id, id
  from public.shopify_connections
  order by user_id, created_at
)
update public.products p set shopify_connection_id = ps.id
  from primary_store ps
 where ps.user_id = p.user_id and p.shopify_connection_id is null;

with primary_store as (
  select distinct on (user_id) user_id, id
  from public.shopify_connections
  order by user_id, created_at
)
update public.daily_metrics d set shopify_connection_id = ps.id
  from primary_store ps
 where ps.user_id = d.user_id and d.shopify_connection_id is null;

with primary_store as (
  select distinct on (user_id) user_id, id
  from public.shopify_connections
  order by user_id, created_at
)
update public.meta_connections m set shopify_connection_id = ps.id
  from primary_store ps
 where ps.user_id = m.user_id and m.shopify_connection_id is null;

with primary_store as (
  select distinct on (user_id) user_id, id
  from public.shopify_connections
  order by user_id, created_at
)
update public.google_connections g set shopify_connection_id = ps.id
  from primary_store ps
 where ps.user_id = g.user_id and g.shopify_connection_id is null;

-- 4. daily_metrics is now per store/day. Swap the (user_id, date) uniqueness for
--    (user_id, shopify_connection_id, date). The app only ever upserts rows that
--    carry a store id, so ON CONFLICT can rely on this index.
alter table public.daily_metrics
  drop constraint if exists daily_metrics_user_id_date_key;

create unique index if not exists daily_metrics_user_store_date_key
  on public.daily_metrics (user_id, shopify_connection_id, date);

create index if not exists idx_daily_metrics_user_store_date
  on public.daily_metrics (user_id, shopify_connection_id, date desc);

-- 5. Fast per-store order scans for the metrics recompute.
create index if not exists idx_orders_user_store_processed
  on public.orders (user_id, shopify_connection_id, processed_at);
