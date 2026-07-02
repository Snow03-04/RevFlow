-- ============================================================================
-- 0015_pnl_transaction_fee_money.sql
-- The P&L "transaction fee" was modelled as a PERCENTAGE of gross revenue.
-- It's actually a fixed MONEY amount charged per order (e.g. €0.30/order), so:
--   * add an `orders` count per day (drives the per-order fee),
--   * flip the default from 0.05 (5%) to 0.30 (money),
--   * convert existing rows — old fractional values are meaningless as money.
-- ============================================================================

-- Per-day order count (Shopify orders that day). Filled on import, editable.
alter table public.pnl_days
  add column if not exists orders integer not null default 0;

-- transaction_fee is now a money amount per order, not a fraction.
alter table public.pnl_settings
  alter column transaction_fee set default 0.30;

-- Existing settings held a percentage (e.g. 0.05) — reset to the money default.
update public.pnl_settings set transaction_fee = 0.30;

-- Per-month overrides also held percentages; clear them so they fall back to
-- the new money default until re-entered.
update public.pnl_month_overrides
  set transaction_fee = null
  where transaction_fee is not null;
