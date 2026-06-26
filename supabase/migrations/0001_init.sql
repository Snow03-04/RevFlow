-- ============================================================================
-- 0001_init.sql
-- Extensions, shared helpers, profiles, per-user settings, auto-provisioning.
-- ============================================================================

create extension if not exists "pgcrypto";   -- gen_random_uuid()

-- ----------------------------------------------------------------------------
-- Shared trigger: keep `updated_at` fresh on every UPDATE.
-- ----------------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ----------------------------------------------------------------------------
-- profiles — app-level data for each authenticated user.
-- The canonical "users" table is Supabase's auth.users; this row extends it.
-- ----------------------------------------------------------------------------
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text,
  full_name   text,
  avatar_url  text,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create trigger trg_profiles_updated_at
  before update on public.profiles
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- settings — per-user cost assumptions used by the profit engine.
-- ----------------------------------------------------------------------------
create table if not exists public.settings (
  user_id                 uuid primary key references auth.users (id) on delete cascade,
  currency                text    not null default 'USD',
  -- Fallback COGS as a % of selling price when a product has no explicit cost.
  default_product_cost_pct numeric(6,2) not null default 30.00,
  -- Flat shipping cost the merchant pays per order.
  default_shipping_cost   numeric(12,2) not null default 0.00,
  -- Payment processor fees: percentage of order total + fixed amount per order.
  payment_fee_pct         numeric(6,3) not null default 2.900,
  payment_fee_fixed       numeric(12,2) not null default 0.30,
  -- IANA timezone used to bucket orders/spend into "days".
  timezone                text    not null default 'UTC',
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);

create trigger trg_settings_updated_at
  before update on public.settings
  for each row execute function public.set_updated_at();

-- ----------------------------------------------------------------------------
-- On signup, create a profile + default settings row automatically.
-- SECURITY DEFINER so it can write to public schema from the auth trigger.
-- ----------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.raw_user_meta_data ->> 'name'),
    new.raw_user_meta_data ->> 'avatar_url'
  )
  on conflict (id) do nothing;

  insert into public.settings (user_id)
  values (new.id)
  on conflict (user_id) do nothing;

  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();
