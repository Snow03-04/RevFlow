-- ============================================================================
-- 0016_google_ads.sql
-- Google Ads integration — mirrors the Meta pattern (0002 meta_connections +
-- 0004 campaigns). Additive & non-destructive: adds two new tables and two
-- split columns on daily_metrics so ad spend can be seen per-platform AND
-- combined. Real Google Ads API auth comes later; for now the app seeds mock
-- data through a server action.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- google_connections  (mirror of meta_connections)
-- ----------------------------------------------------------------------------
create table if not exists public.google_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  access_token      text not null,                  -- encrypted (or 'mock')
  customer_id       text not null,                  -- e.g. 123-456-7890
  customer_name     text,
  account_currency  text,
  token_expires_at  timestamptz,
  status            text not null default 'active', -- active | expired | error
  connected_at      timestamptz not null default now(),
  last_synced_at    timestamptz,
  last_sync_error   text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, customer_id)
);

create index if not exists idx_google_connections_user
  on public.google_connections (user_id);

create trigger trg_google_connections_updated_at
  before update on public.google_connections
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- google_campaigns  (mirror of campaigns — one row per campaign per real day)
-- ----------------------------------------------------------------------------
create table if not exists public.google_campaigns (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  google_connection_id  uuid references public.google_connections (id) on delete cascade,
  campaign_id           text not null,
  campaign_name         text,
  status                text,
  date                  date not null,
  spend                 numeric(14,2) not null default 0,
  impressions           bigint not null default 0,
  clicks                bigint not null default 0,
  reach                 bigint not null default 0,
  cpm                   numeric(12,4) not null default 0,
  cpc                   numeric(12,4) not null default 0,
  ctr                   numeric(8,4)  not null default 0,   -- percentage
  purchases             numeric(12,2) not null default 0,   -- conversions
  purchase_value        numeric(14,2) not null default 0,   -- conversion value
  atc                   numeric(12,2) not null default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, campaign_id, date)
);

create index if not exists idx_google_campaigns_user_date
  on public.google_campaigns (user_id, date desc);
create index if not exists idx_google_campaigns_campaign
  on public.google_campaigns (user_id, campaign_id);

create trigger trg_google_campaigns_updated_at
  before update on public.google_campaigns
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- daily_metrics — per-platform ad spend split (ad_spend stays the TOTAL).
-- ----------------------------------------------------------------------------
alter table public.daily_metrics
  add column if not exists ad_spend_meta   numeric(14,2) not null default 0,
  add column if not exists ad_spend_google numeric(14,2) not null default 0;

-- ----------------------------------------------------------------------------
-- RLS — owner-scoped, mirroring the other tables.
-- ----------------------------------------------------------------------------
alter table public.google_connections enable row level security;
alter table public.google_campaigns   enable row level security;

do $$
declare t text;
begin
  foreach t in array array['google_connections', 'google_campaigns']
  loop
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id);', t || '_sel', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id);', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_upd', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id);', t || '_del', t);
  end loop;
end;
$$;
