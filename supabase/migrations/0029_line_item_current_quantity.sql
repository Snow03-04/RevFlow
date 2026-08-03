-- ============================================================================
-- 0029_line_item_current_quantity.sql
-- Store each line item's CURRENT quantity (Shopify `current_quantity`), i.e. the
-- ordered quantity minus what was later removed via an order EDIT or refunded.
-- COGS + units sold must be costed on this, not the original `quantity` — a
-- colour swap (remove variant A, add variant B) otherwise double-counts cost.
-- Nullable: old rows fall back to `quantity` until re-synced. Additive, no lock.
-- ============================================================================

alter table public.order_line_items
  add column if not exists current_quantity integer;

notify pgrst, 'reload schema';
