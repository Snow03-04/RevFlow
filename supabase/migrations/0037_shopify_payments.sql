-- Original settlement currencies are retained. Transfers are not expenses.
alter table public.shopify_connections add column if not exists reporting_base_currency text;
update public.shopify_connections s set reporting_base_currency = (
  select o.currency from public.orders o where o.shopify_connection_id = s.id and o.user_id = s.user_id
  and o.currency is not null order by o.processed_at desc limit 1
) where reporting_base_currency is null;
alter table public.settings add column if not exists fx_override_currency text;
update public.settings s set fx_override_currency = (
  select o.currency from public.orders o where o.user_id = s.user_id and o.currency <> s.currency
  order by o.processed_at desc limit 1
) where s.fx_override_currency is null and s.fx_rate_override is not null;

create table if not exists public.shopify_payment_accounts (
  shopify_connection_id uuid primary key references public.shopify_connections(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  client_id text,
  encrypted_secret text,
  snapshot jsonb,
  synced_at timestamptz,
  last_error text,
  refresh_pending boolean not null default false
);
alter table public.shopify_payment_accounts enable row level security;
create policy "Own payment accounts" on public.shopify_payment_accounts
  for all to authenticated using (auth.uid() = user_id)
  with check (auth.uid() = user_id and exists (
    select 1 from public.shopify_connections s
    where s.id = shopify_connection_id and s.user_id = auth.uid()
  ));

alter table public.daily_metrics
  add column if not exists payment_adjustment numeric not null default 0,
  add column if not exists payment_orders_actual integer not null default 0,
  add column if not exists payment_orders_estimated integer not null default 0;
alter table public.pnl_days
  add column if not exists payment_fees numeric,
  add column if not exists payment_adjustment numeric not null default 0;
notify pgrst, 'reload schema';
