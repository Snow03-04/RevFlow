-- Billed-cost reports are separate from hourly served-cost imports.
create table if not exists public.google_billing_reports (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  shopify_connection_id uuid not null references public.shopify_connections(id) on delete cascade,
  customer_id text not null check (customer_id ~ '^[0-9]{10}$'),
  date date not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  served_cost numeric not null check (served_cost >= 0),
  billed_cost numeric not null check (billed_cost >= 0 and billed_cost <= served_cost),
  imported_at timestamptz not null default now(),
  unique (user_id, shopify_connection_id, customer_id, date)
);
alter table public.google_billing_reports enable row level security;
create policy "Read own Google billing reports" on public.google_billing_reports
  for select to authenticated using (auth.uid() = user_id);
grant select on public.google_billing_reports to authenticated;
grant all on public.google_billing_reports to service_role;
