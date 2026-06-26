-- ============================================================================
-- 0006_rls.sql
-- Row Level Security. Every table is owner-scoped: a user can only ever read
-- or write rows where user_id = auth.uid() (profiles keyed on id).
--
-- The service-role key (cron jobs, webhooks) BYPASSES RLS by design, so those
-- server-only paths can write data on a user's behalf without a session.
-- ============================================================================

alter table public.profiles            enable row level security;
alter table public.settings            enable row level security;
alter table public.shopify_connections enable row level security;
alter table public.meta_connections    enable row level security;
alter table public.products            enable row level security;
alter table public.orders              enable row level security;
alter table public.order_line_items    enable row level security;
alter table public.campaigns           enable row level security;
alter table public.daily_metrics       enable row level security;
alter table public.sync_logs           enable row level security;

-- ----------------------------------------------------------------------------
-- profiles (keyed on id == auth.uid())
-- ----------------------------------------------------------------------------
create policy "profiles_select_own" on public.profiles
  for select using (auth.uid() = id);
create policy "profiles_update_own" on public.profiles
  for update using (auth.uid() = id) with check (auth.uid() = id);

-- ----------------------------------------------------------------------------
-- settings (keyed on user_id; users may read + update their own)
-- ----------------------------------------------------------------------------
create policy "settings_select_own" on public.settings
  for select using (auth.uid() = user_id);
create policy "settings_insert_own" on public.settings
  for insert with check (auth.uid() = user_id);
create policy "settings_update_own" on public.settings
  for update using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ----------------------------------------------------------------------------
-- Generic owner-scoped policies for the remaining tables.
-- ----------------------------------------------------------------------------
do $$
declare
  t text;
begin
  foreach t in array array[
    'shopify_connections',
    'meta_connections',
    'products',
    'orders',
    'order_line_items',
    'campaigns',
    'daily_metrics',
    'sync_logs'
  ]
  loop
    execute format(
      'create policy %I on public.%I for select using (auth.uid() = user_id);',
      t || '_select_own', t);
    execute format(
      'create policy %I on public.%I for insert with check (auth.uid() = user_id);',
      t || '_insert_own', t);
    execute format(
      'create policy %I on public.%I for update using (auth.uid() = user_id) with check (auth.uid() = user_id);',
      t || '_update_own', t);
    execute format(
      'create policy %I on public.%I for delete using (auth.uid() = user_id);',
      t || '_delete_own', t);
  end loop;
end;
$$;
