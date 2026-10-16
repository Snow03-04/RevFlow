-- Read-only projections: keep complete ledgers in storage while sending only
-- the evidence needed for this accounting window. Both functions obey RLS.
create or replace function public.financial_payment_snapshots(
  p_user_id uuid, p_from timestamptz, p_to timestamptz, p_store_id uuid default null
) returns table (shopify_connection_id uuid, snapshot jsonb)
language sql stable security invoker set search_path = public
as $$
  with relevant_orders as materialized (
    select o.shopify_connection_id, o.shopify_order_id::text as order_id
    from public.orders o
    where o.user_id = p_user_id and o.processed_at >= p_from and o.processed_at < p_to
      and (p_store_id is null or o.shopify_connection_id = p_store_id)
  )
  select a.shopify_connection_id, jsonb_build_object(
    'version', a.snapshot->'version', 'payouts', '[]'::jsonb, 'balances', '[]'::jsonb,
    'transactions', coalesce((
      select jsonb_agg(t.value)
      from jsonb_array_elements(a.snapshot->'transactions') t
      where (
        t.value->>'type' in ('charge', 'refund') and exists (
          select 1 from relevant_orders o where o.shopify_connection_id = a.shopify_connection_id
            and o.order_id = t.value->>'orderId'
        )
      ) or (
        t.value->>'type' in ('dispute', 'adjustment', 'credit', 'debit')
        and (t.value->>'processedAt')::timestamptz >= p_from
        and (t.value->>'processedAt')::timestamptz < p_to
      )
    ), '[]'::jsonb),
    'orders', coalesce((
      select jsonb_object_agg(c.key, c.value) from jsonb_each(a.snapshot->'orders') c
      where exists (select 1 from relevant_orders o
        where o.shopify_connection_id = a.shopify_connection_id and o.order_id = c.key)
    ), '{}'::jsonb)
  )
  from public.shopify_payment_accounts a
  where a.user_id = p_user_id and (p_store_id is null or a.shopify_connection_id = p_store_id)
    and a.snapshot->>'version' = '1'
    and jsonb_typeof(a.snapshot->'transactions') = 'array'
    and jsonb_typeof(a.snapshot->'payouts') = 'array'
    and jsonb_typeof(a.snapshot->'balances') = 'array';
$$;

create or replace function public.cogs_quantity_history(p_user_id uuid, p_store_id uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with eligible as materialized (
    select o.id, o.order_number, o.processed_at, o.shopify_connection_id,
      o.financial_status, o.test, o.cancelled_at, o.total_refunded
    from public.orders o
    where o.user_id = p_user_id and o.shopify_connection_id = p_store_id
      and o.financial_status = 'paid' and not o.test and o.cancelled_at is null
      and coalesce(o.total_refunded, 0) = 0
      and exists (select 1 from public.order_supplier_costs s
        where s.user_id = p_user_id and s.shopify_connection_id = p_store_id and s.cost > 0
          and regexp_replace(s.order_number, '\D', '', 'g') = regexp_replace(o.order_number, '\D', '', 'g'))
      and exists (select 1 from public.order_line_items li
        where li.user_id = p_user_id and li.order_id = o.id
        group by li.order_id having sum(li.quantity) >= 2
          and bool_and(li.current_quantity is null or li.current_quantity = li.quantity))
  )
  select jsonb_build_object(
    'orders', coalesce((select jsonb_agg(to_jsonb(o)) from eligible o), '[]'::jsonb),
    'items', coalesce((select jsonb_agg(jsonb_build_object(
      'order_id', li.order_id, 'shopify_product_id', li.shopify_product_id,
      'quantity', li.quantity, 'current_quantity', li.current_quantity
    )) from public.order_line_items li where li.user_id = p_user_id
      and exists (select 1 from eligible o where o.id = li.order_id)), '[]'::jsonb)
  );
$$;

revoke all on function public.financial_payment_snapshots(uuid, timestamptz, timestamptz, uuid) from public, anon;
revoke all on function public.cogs_quantity_history(uuid, uuid) from public, anon;
grant execute on function public.financial_payment_snapshots(uuid, timestamptz, timestamptz, uuid) to authenticated, service_role;
grant execute on function public.cogs_quantity_history(uuid, uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
