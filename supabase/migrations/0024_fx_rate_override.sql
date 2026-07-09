-- ============================================================================
-- 0024_fx_rate_override.sql
-- Manual FX override for the store<->display currency pair. All amounts are
-- stored in the store's base currency; the dashboard converts to the display
-- currency with the live ECB rate by default. A HUF store viewed in EUR then
-- differs ~1% from Shopify, which uses its own FX provider. This lets the
-- merchant PIN the exact rate their books use so every figure matches.
--
-- Value = units of the STORE base currency per 1 unit of the DISPLAY currency
-- (e.g. 354 = "1 EUR = 354 HUF"). NULL = use the live rate.
-- (The legacy `fx_rate` column from 0007 was never wired up; kept untouched.)
-- ============================================================================

alter table public.settings
  add column if not exists fx_rate_override numeric(14,6);
