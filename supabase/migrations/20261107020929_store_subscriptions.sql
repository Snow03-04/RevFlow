begin;

create table public.store_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shopify_connection_id uuid not null references public.shopify_connections(id) on delete cascade,
  name text not null check (length(trim(name)) between 1 and 100),
  amount numeric(12,2) not null default 0 check (amount >= 0 and amount <= 9999999),
  currency text not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  billing_cycle text not null default 'monthly' check (billing_cycle in ('weekly','monthly','quarterly','yearly')),
  status text not null default 'active' check (status in ('active','trial','paused','cancelled')),
  next_due_date date not null check (next_due_date between date '2000-01-01' and date '2200-12-31'),
  anchor_day integer not null check (anchor_day between 1 and 31),
  reminder_days integer not null default 7 check (reminder_days between 0 and 90),
  management_url text not null default '' check (length(management_url) <= 2000 and (management_url = '' or management_url ~ '^https?://')),
  notes text not null default '' check (length(notes) <= 2000),
  read_alert_key text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index store_subscriptions_user_due_idx on public.store_subscriptions(user_id, next_due_date);
create index store_subscriptions_store_idx on public.store_subscriptions(shopify_connection_id);
alter table public.store_subscriptions enable row level security;
create policy subscriptions_read on public.store_subscriptions for select to authenticated
  using ((select auth.uid()) = user_id);
create policy subscriptions_insert on public.store_subscriptions for insert to authenticated
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.shopify_connections s where s.id = shopify_connection_id and s.user_id = (select auth.uid())
  ));
create policy subscriptions_update on public.store_subscriptions for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id and exists (
    select 1 from public.shopify_connections s where s.id = shopify_connection_id and s.user_id = (select auth.uid())
  ));
revoke all on public.store_subscriptions from public, anon, authenticated;
grant select, insert, update on public.store_subscriptions to authenticated;
grant select, insert, update, delete on public.store_subscriptions to service_role;

commit;
