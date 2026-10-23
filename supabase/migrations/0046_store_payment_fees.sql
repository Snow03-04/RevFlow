-- Per-store reporting policy. Shopify mode uses verified transaction fees;
-- the entered rate is only the fallback while settlement evidence is missing.
alter table public.shopify_connections
  add column if not exists payment_fee_mode text not null default 'inherit'
    check (payment_fee_mode in ('inherit', 'shopify', 'manual')),
  add column if not exists payment_fee_pct numeric
    check (payment_fee_pct between 0 and 1),
  add column if not exists payment_fee_fixed numeric
    check (payment_fee_fixed between 0 and 100),
  add column if not exists payment_fee_currency text
    check (payment_fee_currency ~ '^[A-Z]{3}$');

notify pgrst, 'reload schema';
