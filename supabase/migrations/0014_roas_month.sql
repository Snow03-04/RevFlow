-- ============================================================================
-- 0012_roas_month.sql
-- Tie ROAS entries to a REAL month/year, not just a bare day (1..31).
--
-- Before this, roas_entries stored only `day`, so "Day 1" of June and "Day 1"
-- of July shared the same rows and their data merged. We add `year` + `month`
-- (mirroring pnl_days) so each entry belongs to one calendar month.
--
-- Existing rows are WIPED (by explicit user decision) and re-imported per month
-- from Meta/Shopify/Custos. A JSON backup was taken beforehand
-- (supabase/backups/roas_entries_<timestamp>.json).
-- ============================================================================

-- 1. Clear existing month-agnostic rows so the NOT NULL columns can be added.
delete from public.roas_entries;

-- 2. Add the calendar period. Table is empty, so NOT NULL is safe without a default.
alter table public.roas_entries
  add column year  integer not null,
  add column month integer not null check (month between 1 and 12);

-- 3. Replace the day-only index with a period-scoped one.
drop index if exists idx_roas_entries_user_day;

create index if not exists idx_roas_entries_user_period
  on public.roas_entries (user_id, year, month, day, position);
