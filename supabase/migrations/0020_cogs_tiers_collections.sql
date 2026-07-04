-- ============================================================================
-- 0020_cogs_tiers_collections.sql
-- Quantity-tiered COGS + COGS collections.
--
--  * product_cost_tiers      — per-product bundle pricing. Each row is the TOTAL
--                              cost of buying `min_qty` units of ONE product.
--                              (min_qty 1 stays the normal per-unit cost in
--                              product_costs; tiers start at 2.)
--  * cogs_collections        — a named group of products that SHARE one pricing
--                              table. `base_unit_cost` is the per-unit cost for
--                              members (overrides each product's own cost).
--  * cogs_collection_products— membership (a product is in at most one).
--  * cogs_collection_tiers   — the collection's bundle tiers (TOTAL for
--                              `min_qty` combined units across the collection).
--
-- Cost math (per order):
--   cost(Q) with unit cost u and tiers t (asc by min_qty):
--     Q<=0        -> 0
--     no tier<=Q  -> Q * u
--     else t*     -> t*.total + (Q - t*.min_qty) * u   (t* = largest tier <= Q)
-- So buying 5 when the top tier is 4 = total(4) + 1 unit at the base cost.
--
-- Amounts are stored in the currency they were entered in (`currency`); NULL
-- means the store base currency — same convention as product_costs (0018).
-- Additive & non-destructive.
-- ============================================================================

-- Per-product quantity tiers ------------------------------------------------
create table if not exists public.product_cost_tiers (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  shopify_product_id text not null,
  min_qty            integer not null check (min_qty >= 2),
  total_cost         numeric(12,2) not null default 0,   -- TOTAL for min_qty units
  currency           text,                                -- NULL = store base currency
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  unique (user_id, shopify_product_id, min_qty)
);

create index if not exists idx_product_cost_tiers_user_product
  on public.product_cost_tiers (user_id, shopify_product_id);

create trigger trg_product_cost_tiers_updated_at
  before update on public.product_cost_tiers
  for each row execute function public.set_updated_at();

alter table public.product_cost_tiers enable row level security;
create policy "pct_select_own" on public.product_cost_tiers
  for select using (auth.uid() = user_id);
create policy "pct_insert_own" on public.product_cost_tiers
  for insert with check (auth.uid() = user_id);
create policy "pct_update_own" on public.product_cost_tiers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "pct_delete_own" on public.product_cost_tiers
  for delete using (auth.uid() = user_id);

-- Collections ---------------------------------------------------------------
create table if not exists public.cogs_collections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  name           text not null,
  base_unit_cost numeric(12,2) not null default 0,  -- per-unit for members (overrides individual)
  currency       text,                               -- NULL = store base currency
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create index if not exists idx_cogs_collections_user
  on public.cogs_collections (user_id);

create trigger trg_cogs_collections_updated_at
  before update on public.cogs_collections
  for each row execute function public.set_updated_at();

alter table public.cogs_collections enable row level security;
create policy "cc_select_own" on public.cogs_collections
  for select using (auth.uid() = user_id);
create policy "cc_insert_own" on public.cogs_collections
  for insert with check (auth.uid() = user_id);
create policy "cc_update_own" on public.cogs_collections
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cc_delete_own" on public.cogs_collections
  for delete using (auth.uid() = user_id);

-- Collection membership (a product belongs to at most one collection) -------
create table if not exists public.cogs_collection_products (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null references auth.users (id) on delete cascade,
  collection_id      uuid not null references public.cogs_collections (id) on delete cascade,
  shopify_product_id text not null,
  created_at         timestamptz not null default now(),
  unique (user_id, shopify_product_id)
);

create index if not exists idx_ccp_user on public.cogs_collection_products (user_id);
create index if not exists idx_ccp_collection on public.cogs_collection_products (collection_id);

alter table public.cogs_collection_products enable row level security;
create policy "ccp_select_own" on public.cogs_collection_products
  for select using (auth.uid() = user_id);
create policy "ccp_insert_own" on public.cogs_collection_products
  for insert with check (auth.uid() = user_id);
create policy "ccp_update_own" on public.cogs_collection_products
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ccp_delete_own" on public.cogs_collection_products
  for delete using (auth.uid() = user_id);

-- Collection tiers ----------------------------------------------------------
create table if not exists public.cogs_collection_tiers (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  collection_id uuid not null references public.cogs_collections (id) on delete cascade,
  min_qty       integer not null check (min_qty >= 2),
  total_cost    numeric(12,2) not null default 0,   -- TOTAL for min_qty combined units
  currency      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (collection_id, min_qty)
);

create index if not exists idx_cct_collection on public.cogs_collection_tiers (collection_id);

create trigger trg_cogs_collection_tiers_updated_at
  before update on public.cogs_collection_tiers
  for each row execute function public.set_updated_at();

alter table public.cogs_collection_tiers enable row level security;
create policy "cct_select_own" on public.cogs_collection_tiers
  for select using (auth.uid() = user_id);
create policy "cct_insert_own" on public.cogs_collection_tiers
  for insert with check (auth.uid() = user_id);
create policy "cct_update_own" on public.cogs_collection_tiers
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "cct_delete_own" on public.cogs_collection_tiers
  for delete using (auth.uid() = user_id);
