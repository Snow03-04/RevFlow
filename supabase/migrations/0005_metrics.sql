-- ============================================================================
-- 0005_metrics.sql
-- Pre-aggregated daily P&L per user (fast dashboard reads) + sync audit log.
-- ============================================================================

create table if not exists public.daily_metrics (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  date              date not null,
  -- Revenue
  gross_revenue     numeric(14,2) not null default 0,   -- subtotal of paid orders
  refunds           numeric(14,2) not null default 0,
  discounts         numeric(14,2) not null default 0,
  shipping_revenue  numeric(14,2) not null default 0,   -- shipping charged to customers
  revenue           numeric(14,2) not null default 0,   -- net revenue (gross - refunds)
  -- Costs
  product_cost      numeric(14,2) not null default 0,   -- COGS
  shipping_cost     numeric(14,2) not null default 0,
  payment_fees      numeric(14,2) not null default 0,
  ad_spend          numeric(14,2) not null default 0,
  -- Outcomes
  profit            numeric(14,2) not null default 0,
  profit_margin     numeric(8,4)  not null default 0,    -- profit / revenue (fraction)
  roas              numeric(10,4) not null default 0,    -- meta purchase value / spend
  mer               numeric(10,4) not null default 0,    -- total revenue / total ad spend
  cac               numeric(12,2) not null default 0,    -- ad spend / orders
  -- Volume
  orders_count      integer not null default 0,
  units_sold        integer not null default 0,
  ad_clicks         bigint  not null default 0,          -- Meta link clicks
  aov               numeric(12,2) not null default 0,    -- revenue / orders
  conversion_rate   numeric(8,4)  not null default 0,    -- orders / ad_clicks
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, date)
);

create index if not exists idx_daily_metrics_user_date on public.daily_metrics (user_id, date desc);

create trigger trg_daily_metrics_updated_at
  before update on public.daily_metrics
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- sync_logs — observability for cron / webhook / manual syncs.
-- ----------------------------------------------------------------------------
create table if not exists public.sync_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references auth.users (id) on delete cascade,
  source            text not null,            -- shopify | meta | metrics
  job_type          text not null,            -- orders | products | campaigns | webhook | rollup
  status            text not null,            -- success | error | partial
  records_processed integer not null default 0,
  error             text,
  started_at        timestamptz not null default now(),
  finished_at       timestamptz,
  created_at        timestamptz not null default now()
);

create index if not exists idx_sync_logs_user on public.sync_logs (user_id, created_at desc);
