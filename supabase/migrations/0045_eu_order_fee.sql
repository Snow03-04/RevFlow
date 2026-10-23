-- Per-store opt-in. Existing RLS/ownership rules on shopify_connections apply.
-- Backfill of the owner's existing EU stores is an explicit deployment step;
-- new stores start disabled until their owner chooses the setting.
alter table public.shopify_connections
  add column if not exists eu_order_fee_enabled boolean not null default false;
comment on column public.shopify_connections.eu_order_fee_enabled is
  'Adds EUR 2 once per eligible EU-destination order from local date 2026-10-23, including that date. Included in COGS.';
notify pgrst, 'reload schema';
