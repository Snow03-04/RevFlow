-- ============================================================================
-- 0008_trackers.sql
-- Manual-input tools:
--   Tracker 1 — P&L Profit Sheet (daily profit & loss, 12 months + dashboard)
--   Tracker 2 — Daily ROAS Campaign Tracker (48h paired-window scaling)
-- All amounts are stored in the tracker's own configurable currency symbol.
-- ============================================================================

/* ------------------------------------------------------------------ */
/* Tracker 1 — P&L                                                     */
/* ------------------------------------------------------------------ */

create table if not exists public.pnl_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  currency             text not null default '€',          -- € / $ / £
  base_year            integer not null default 2026,
  agency_fee_fb        numeric(6,4) not null default 0.06,  -- 6%
  agency_fee_google    numeric(6,4) not null default 0.10,  -- 10%
  transaction_fee      numeric(6,4) not null default 0.05,  -- 5%
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_pnl_settings_updated_at
  before update on public.pnl_settings
  for each row execute function public.set_updated_at();

-- Per-month editable assumptions (override the global defaults).
create table if not exists public.pnl_month_overrides (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  year                 integer not null,
  month                integer not null check (month between 1 and 12),
  agency_fee_fb        numeric(6,4),
  agency_fee_google    numeric(6,4),
  transaction_fee      numeric(6,4),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, year, month)
);

create trigger trg_pnl_month_overrides_updated_at
  before update on public.pnl_month_overrides
  for each row execute function public.set_updated_at();

-- One editable row per calendar day.
create table if not exists public.pnl_days (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  year                 integer not null,
  month                integer not null check (month between 1 and 12),
  day                  integer not null check (day between 1 and 31),
  gross_revenue        numeric(14,2) not null default 0,
  refunds              numeric(14,2) not null default 0,
  cogs                 numeric(14,2) not null default 0,
  adspend_fb           numeric(14,2) not null default 0,
  adspend_google       numeric(14,2) not null default 0,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (user_id, year, month, day)
);

create index if not exists idx_pnl_days_user_period
  on public.pnl_days (user_id, year, month, day);

create trigger trg_pnl_days_updated_at
  before update on public.pnl_days
  for each row execute function public.set_updated_at();

/* ------------------------------------------------------------------ */
/* Tracker 2 — ROAS                                                    */
/* ------------------------------------------------------------------ */

create table if not exists public.roas_settings (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  currency             text not null default '€',
  roas_scale           numeric(6,2) not null default 2.5,
  roas_maintain        numeric(6,2) not null default 2.0,
  roas_watch           numeric(6,2) not null default 1.5,
  min_margin           numeric(6,4) not null default 0.15,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create trigger trg_roas_settings_updated_at
  before update on public.roas_settings
  for each row execute function public.set_updated_at();

-- One editable row per campaign per day (day 1..31, month-agnostic).
-- Duplicate campaign names within a day are allowed but flagged in the UI.
create table if not exists public.roas_entries (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references auth.users (id) on delete cascade,
  day                  integer not null check (day between 1 and 31),
  position             integer not null default 0,         -- row order within the day
  campaign_name        text not null default '',
  total_spend          numeric(14,2) not null default 0,
  cpc                  numeric(12,4) not null default 0,
  atc                  numeric(12,2) not null default 0,
  pur                  numeric(12,2) not null default 0,
  price                numeric(12,2) not null default 0,
  cog                  numeric(12,2) not null default 0,
  units_sold           numeric(12,2) not null default 0,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists idx_roas_entries_user_day
  on public.roas_entries (user_id, day, position);

create trigger trg_roas_entries_updated_at
  before update on public.roas_entries
  for each row execute function public.set_updated_at();

/* ------------------------------------------------------------------ */
/* RLS — owner-scoped                                                  */
/* ------------------------------------------------------------------ */

alter table public.pnl_settings        enable row level security;
alter table public.pnl_month_overrides enable row level security;
alter table public.pnl_days            enable row level security;
alter table public.roas_settings       enable row level security;
alter table public.roas_entries        enable row level security;

do $$
declare t text;
begin
  foreach t in array array[
    'pnl_settings', 'pnl_month_overrides', 'pnl_days',
    'roas_settings', 'roas_entries'
  ]
  loop
    execute format('create policy %I on public.%I for select using (auth.uid() = user_id);', t || '_sel', t);
    execute format('create policy %I on public.%I for insert with check (auth.uid() = user_id);', t || '_ins', t);
    execute format('create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);', t || '_upd', t);
    execute format('create policy %I on public.%I for delete using (auth.uid() = user_id);', t || '_del', t);
  end loop;
end;
$$;
