-- ============================================================================
-- 0022_manual_entries.sql
-- Manual per-day profit / expense adjustments — extra income or costs that come
-- from OUTSIDE Shopify/Meta (e.g. a side sale, a supplier invoice, a refund
-- handled off-platform). Each entry lands on a specific day and shifts that
-- day's PROFIT: `profit` adds, `expense` subtracts.
--
-- Amounts are stored in the currency they were entered in (`currency`); NULL
-- means the store base currency — same convention as product_costs (0018) and
-- the COGS tiers (0020). The metrics engine folds them into daily_metrics.
-- Additive & non-destructive.
-- ============================================================================

create table if not exists public.manual_entries (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users (id) on delete cascade,
  date       date not null,
  kind       text not null check (kind in ('profit', 'expense')),
  amount     numeric(14,2) not null default 0 check (amount >= 0),
  currency   text,            -- NULL = store base currency; else display currency
  label      text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_manual_entries_user_date
  on public.manual_entries (user_id, date);

create trigger trg_manual_entries_updated_at
  before update on public.manual_entries
  for each row execute function public.set_updated_at();

alter table public.manual_entries enable row level security;
create policy "me_select_own" on public.manual_entries
  for select using (auth.uid() = user_id);
create policy "me_insert_own" on public.manual_entries
  for insert with check (auth.uid() = user_id);
create policy "me_update_own" on public.manual_entries
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "me_delete_own" on public.manual_entries
  for delete using (auth.uid() = user_id);

-- Net manual adjustment folded into each day (store base currency), for audit /
-- display. profit already includes it; this column just exposes the amount.
alter table public.daily_metrics
  add column if not exists manual_adjustment numeric(14,2) not null default 0;
