-- Stable campaign identity survives renaming and equal names in other accounts.
alter table public.roas_entries add column if not exists campaign_key text;
alter table public.roas_entries add column if not exists attribution_warning text;
create index if not exists roas_entries_campaign_month
  on public.roas_entries (user_id, campaign_key, year, month, day);

alter table public.meta_connections add column if not exists budget_synced_at timestamptz;
alter table public.meta_connections add column if not exists budget_sync_error text;

-- Amounts retain Meta's native minor units; only same-currency changes compare.
create table if not exists public.meta_budget_changes (
  user_id uuid not null references auth.users(id) on delete cascade,
  meta_connection_id uuid not null references public.meta_connections(id) on delete cascade,
  event_id text not null,
  campaign_id text not null,
  object_id text not null,
  changed_at timestamptz not null,
  old_budget numeric not null,
  new_budget numeric not null,
  currency text not null,
  primary key (user_id, meta_connection_id, event_id)
);
create index if not exists meta_budget_changes_campaign_date
  on public.meta_budget_changes (user_id, meta_connection_id, campaign_id, changed_at desc);
alter table public.meta_budget_changes enable row level security;
create policy "Users manage own Meta budget evidence" on public.meta_budget_changes
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.meta_connections c where c.id = meta_connection_id and c.user_id = auth.uid()
  ));
revoke all on public.meta_budget_changes from anon;
grant select, insert, update, delete on public.meta_budget_changes to authenticated, service_role;
notify pgrst, 'reload schema';
