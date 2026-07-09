-- ============================================================================
-- 0023_pnl_payment_fee.sql
-- The P&L sheet only modelled a flat per-order transaction fee + (optional)
-- agency fees. Add the Shopify PAYMENT PROCESSING percentage (default 2.5%) so
-- the P&L charges the real Shopify cost — 2.5% of the sale + a fixed fee per
-- order (`transaction_fee`, e.g. €0.30). Stored as a fraction (0.025 = 2.5%).
-- Existing rows get the 2.5% default automatically.
-- ============================================================================

alter table public.pnl_settings
  add column if not exists payment_fee_pct numeric(6,4) not null default 0.025;
