-- Additive breakdown: existing totals and profit remain valid during rollout.
alter table public.daily_metrics
  add column if not exists eu_order_fees numeric(14,2) not null default 0;
alter table public.pnl_days
  add column if not exists eu_order_fees numeric(14,2) not null default 0;
comment on column public.daily_metrics.eu_order_fees is
  'EU order fees already included in legacy product_cost; subtract this component when displaying merchandise COGS.';
comment on column public.pnl_days.eu_order_fees is
  'EU order fees already included in legacy cogs; not an additional charge. Exclude this component from COGS Impact.';
