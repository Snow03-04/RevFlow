-- Actual Google edits, independent of daily metric refresh timestamps.
create table if not exists public.google_campaign_changes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  campaign_key text not null,
  event_id text not null,
  changed_at timestamp without time zone not null,
  kind text not null check (kind in ('budget', 'status', 'bidding', 'campaign')),
  old_budget numeric,
  new_budget numeric,
  currency text,
  created_at timestamptz not null default now(),
  unique (user_id, campaign_key, event_id)
);
create index if not exists google_campaign_changes_latest
  on public.google_campaign_changes (user_id, campaign_key, changed_at desc);
alter table public.google_campaign_changes enable row level security;
create policy "Read own Google campaign changes"
  on public.google_campaign_changes for select to authenticated
  using (auth.uid() = user_id);
-- Imports use the server's service role. No client-side mutation of history.
grant select on public.google_campaign_changes to authenticated;
grant all on public.google_campaign_changes to service_role;
