-- ============================================================================
-- 0002_connections.sql
-- OAuth connections to Shopify and Meta. Access tokens are stored ENCRYPTED
-- (AES-256-GCM) by the application layer before they ever reach Postgres.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- shopify_connections
-- ----------------------------------------------------------------------------
create table if not exists public.shopify_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  shop_domain       text not null,                 -- e.g. mystore.myshopify.com
  access_token      text not null,                 -- encrypted ciphertext
  scope             text,
  status            text not null default 'active', -- active | revoked | error
  webhook_ids       jsonb not null default '[]'::jsonb,
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  last_sync_error   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, shop_domain)
);

create index if not exists idx_shopify_connections_user on public.shopify_connections (user_id);
create index if not exists idx_shopify_connections_domain on public.shopify_connections (shop_domain);

create trigger trg_shopify_connections_updated_at
  before update on public.shopify_connections
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- meta_connections
-- ----------------------------------------------------------------------------
create table if not exists public.meta_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  access_token      text not null,                 -- encrypted long-lived token
  ad_account_id     text not null,                 -- e.g. act_1234567890
  ad_account_name   text,
  business_id       text,
  account_currency  text,
  token_expires_at  timestamptz,
  status            text not null default 'active', -- active | expired | error
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  last_sync_error   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, ad_account_id)
);

create index if not exists idx_meta_connections_user on public.meta_connections (user_id);

create trigger trg_meta_connections_updated_at
  before update on public.meta_connections
  for each row execute function public.set_updated_at();
