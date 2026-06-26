-- ============================================================================
-- 0004_ads.sql
-- Meta Ads campaign metrics, stored as a daily history (one row per
-- campaign per day) so trends and comparisons are exact.
-- ============================================================================

create table if not exists public.campaigns (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  meta_connection_id   uuid references public.meta_connections (id) on delete cascade,
  campaign_id          text not null,
  campaign_name        text,
  status               text,
  date                 date not null,
  spend                numeric(14,2) not null default 0,
  impressions         bigint not null default 0,
  clicks              bigint not null default 0,
  reach               bigint not null default 0,
  cpm                 numeric(12,4) not null default 0,
  cpc                 numeric(12,4) not null default 0,
  ctr                 numeric(8,4)  not null default 0,   -- percentage
  purchases           numeric(12,2) not null default 0,   -- conversions
  purchase_value      numeric(14,2) not null default 0,   -- Meta-attributed revenue
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, campaign_id, date)
);

create index if not exists idx_campaigns_user_date on public.campaigns (user_id, date desc);
create index if not exists idx_campaigns_campaign on public.campaigns (user_id, campaign_id);

create trigger trg_campaigns_updated_at
  before update on public.campaigns
  for each row execute function public.set_updated_at();
