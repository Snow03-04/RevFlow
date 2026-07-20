-- ============================================================================
-- 0027_store_name.sql
-- Store the shop's real Shopify name (Settings → Store details) so the store
-- switcher and connection cards show a human name instead of the myshopify
-- domain. Populated best-effort on the next sync (jobs.ts). Additive; tiny
-- table, so no lock/timeout risk.
-- ============================================================================

alter table public.shopify_connections
  add column if not exists shop_name text;

notify pgrst, 'reload schema';
