-- Evaluate supplier numbers and line-item quantities once per store instead of
-- running a correlated aggregate for every historical order. Preserve the exact
-- eligibility rules and the caller's RLS/subscription checks.
create or replace function public.cogs_quantity_history(p_user_id uuid, p_store_id uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with supplier_numbers as materialized (
    select distinct regexp_replace(s.order_number, '\D', '', 'g') as number
    from public.order_supplier_costs s
    where s.user_id = p_user_id and s.shopify_connection_id = p_store_id and s.cost > 0
  ), store_orders as materialized (
    select o.id, o.order_number, o.processed_at, o.shopify_connection_id,
      o.financial_status, o.test, o.cancelled_at, o.total_refunded,
      regexp_replace(o.order_number, '\D', '', 'g') as normalized_number
    from public.orders o
    where o.user_id = p_user_id and o.shopify_connection_id = p_store_id
      and o.financial_status = 'paid' and not o.test and o.cancelled_at is null
      and coalesce(o.total_refunded, 0) = 0
  ), candidates as materialized (
    select o.id, o.order_number, o.processed_at, o.shopify_connection_id,
      o.financial_status, o.test, o.cancelled_at, o.total_refunded
    from store_orders o join supplier_numbers s on s.number = o.normalized_number
  ), candidate_items as materialized (
    select li.order_id, li.shopify_product_id, li.quantity, li.current_quantity
    from public.order_line_items li
    join candidates o on o.id = li.order_id
    where li.user_id = p_user_id
  ), quantities as (
    select li.order_id from candidate_items li group by li.order_id
    having sum(li.quantity) >= 2
      and bool_and(li.current_quantity is null or li.current_quantity = li.quantity)
  ), eligible as materialized (
    select o.* from candidates o join quantities q on q.order_id = o.id
  )
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from eligible o), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(to_jsonb(li)) from candidate_items li
      join eligible o on o.id = li.order_id), '[]'::jsonb)
  );
$$;

-- CREATE OR REPLACE retains the existing authenticated/service-role grants.
notify pgrst, 'reload schema';
