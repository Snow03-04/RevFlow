-- ============================================================================
-- 0021_order_source.sql
-- Capture each order's traffic origin (landing URL / referrer / sales channel)
-- so the ROAS Tracker can exclude Google-paid sales from a Meta campaign's
-- attributed revenue. These come straight from the Shopify order object and are
-- populated on the next order sync; historical rows stay NULL (treated as
-- "unknown origin" = not excluded).
-- ============================================================================

alter table public.orders
  add column if not exists landing_site  text,
  add column if not exists referring_site text,
  add column if not exists source_name   text;
