-- ============================================================================
-- 0032_supplier_costs_per_store.sql
-- Scope supplier costs to the store they belong to. Shopify order numbers are
-- only unique WITHIN a store (#AURELLISVIKTORIE1312 and #ELENAEGER1312 both
-- normalise to "1312"), so keying supplier costs by order number alone applied
-- one store's sheet costs to another store's orders.
--
-- The primary key becomes (user_id, shopify_connection_id, order_number).
-- Existing rows are dropped: they are re-created on the next "Aplicar custos",
-- now correctly attributed.
-- ============================================================================

delete from public.order_supplier_costs;

alter table public.order_supplier_costs
  add column if not exists shopify_connection_id uuid
  references public.shopify_connections (id) on delete cascade;

alter table public.order_supplier_costs
  drop constraint if exists order_supplier_costs_pkey;

alter table public.order_supplier_costs
  alter column shopify_connection_id set not null;

alter table public.order_supplier_costs
  add primary key (user_id, shopify_connection_id, order_number);

notify pgrst, 'reload schema';
