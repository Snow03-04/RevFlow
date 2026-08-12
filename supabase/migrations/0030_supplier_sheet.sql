-- ============================================================================
-- 0029_supplier_sheet.sql
-- Supplier cost sheet: a Google Sheet (order_number -> cost, paid state) that
-- RevFlow reads to (a) show what's paid / still owed to the supplier and (b)
-- auto-derive each product's effective-dated COGS from what the supplier
-- actually charged per order.
--
-- - settings.supplier_sheet_url: the sheet link the user pastes once.
-- - product_costs.source: 'manual' (typed by the user) vs 'sheet' (auto-derived
--   from the supplier sheet) so a re-apply can replace only the auto rows and
--   leave the user's manual costs untouched.
-- Additive; tiny, no lock/timeout risk.
-- ============================================================================

alter table public.settings
  add column if not exists supplier_sheet_url text;

alter table public.product_costs
  add column if not exists source text not null default 'manual';

notify pgrst, 'reload schema';
