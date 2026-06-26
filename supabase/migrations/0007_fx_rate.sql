-- ============================================================================
-- 0007_fx_rate.sql
-- Optional display-currency conversion. All amounts are stored in the store's
-- native currency (as they arrive from Shopify/Meta). `fx_rate` multiplies them
-- at display time so a CZK store can report in EUR, etc. Default 1 = no change.
-- ============================================================================

alter table public.settings
  add column if not exists fx_rate numeric(14,6) not null default 1;
