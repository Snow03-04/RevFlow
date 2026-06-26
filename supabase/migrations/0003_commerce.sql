-- ============================================================================
-- 0003_commerce.sql
-- Shopify catalog + orders. Stored at variant granularity so per-product
-- profit can be computed by joining line items to products on variant id.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- products  (one row per variant)
-- ----------------------------------------------------------------------------
create table if not exists public.products (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  shopify_product_id   text not null,
  shopify_variant_id   text not null,
  title                text,
  variant_title        text,
  sku                  text,
  price                numeric(12,2) not null default 0,   -- selling price
  cost                 numeric(12,2),                       -- COGS per unit
  cost_source          text not null default 'shopify',     -- shopify | manual
  image_url            text,
  currency             text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, shopify_variant_id)
);

create index if not exists idx_products_user on public.products (user_id);
create index if not exists idx_products_product_id on public.products (user_id, shopify_product_id);
create index if not exists idx_products_sku on public.products (user_id, sku);

create trigger trg_products_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- orders
-- ----------------------------------------------------------------------------
create table if not exists public.orders (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  shopify_order_id     text not null,
  order_number         text,
  processed_at         timestamptz not null,                -- the "order date"
  currency             text,
  financial_status     text,                                -- paid | refunded | partially_refunded ...
  fulfillment_status   text,
  subtotal_price       numeric(12,2) not null default 0,
  total_price          numeric(12,2) not null default 0,
  total_discounts      numeric(12,2) not null default 0,
  total_tax            numeric(12,2) not null default 0,
  total_shipping       numeric(12,2) not null default 0,    -- shipping charged to customer
  total_refunded       numeric(12,2) not null default 0,
  customer_id          text,
  customer_email       text,
  country              text,
  cancelled_at         timestamptz,
  test                 boolean not null default false,
  raw                  jsonb,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, shopify_order_id)
);

create index if not exists idx_orders_user_date on public.orders (user_id, processed_at desc);
create index if not exists idx_orders_user_country on public.orders (user_id, country);

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- order_line_items
-- ----------------------------------------------------------------------------
create table if not exists public.order_line_items (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  order_id             uuid not null references public.orders (id) on delete cascade,
  shopify_line_item_id text not null,
  shopify_product_id   text,
  shopify_variant_id   text,
  title                text,
  sku                  text,
  quantity             integer not null default 0,
  price                numeric(12,2) not null default 0,    -- unit price
  total_discount       numeric(12,2) not null default 0,
  -- COGS snapshot captured at sync time so historical reports stay stable.
  unit_cost            numeric(12,2),
  created_at           timestamptz not null default now(),
  unique (user_id, shopify_line_item_id)
);

create index if not exists idx_line_items_order on public.order_line_items (order_id);
create index if not exists idx_line_items_variant on public.order_line_items (user_id, shopify_variant_id);
