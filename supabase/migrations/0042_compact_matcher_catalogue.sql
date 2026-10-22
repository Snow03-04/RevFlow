-- Reduce variant/order-history downloads without caching financial evidence.
-- Preserve the existing id-ordered first price, first usable title/handle/cost,
-- and first known store. A scalar JSON result is not truncated at 1,000 rows.
create or replace function public.matcher_catalogue(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = public
as $$
  with catalogue as (
    select min(id::text) as first_id, shopify_product_id,
      (array_agg(shopify_connection_id order by id))[1] as shopify_connection_id,
      coalesce((array_agg(handle order by id) filter (where nullif(handle, '') is not null))[1],
        (array_agg(handle order by id))[1]) as handle,
      coalesce((array_agg(title order by id) filter (where nullif(title, '') is not null))[1],
        (array_agg(title order by id))[1]) as title,
      (array_agg(price order by id))[1] as price,
      (array_agg(cost order by id) filter (where cost is not null))[1] as cost
    from public.products where user_id = p_user_id group by shopify_product_id
  ), sold as (
    select min(li.id::text) as first_id, li.shopify_product_id,
      coalesce((array_agg(li.title order by li.id) filter (where nullif(li.title, '') is not null))[1],
        (array_agg(li.title order by li.id))[1]) as title,
      (array_agg(li.price order by li.id))[1] as price,
      jsonb_build_object('shopify_connection_id',
        (array_agg(o.shopify_connection_id order by li.id) filter (where o.shopify_connection_id is not null))[1]) as orders
    from public.order_line_items li
    left join public.orders o on o.id = li.order_id and o.user_id = p_user_id
    where li.user_id = p_user_id and li.shopify_product_id is not null
    group by li.shopify_product_id
  )
  select jsonb_build_object(
    'products', coalesce((select jsonb_agg(to_jsonb(c) - 'first_id' order by first_id) from catalogue c), '[]'::jsonb),
    'lineItems', coalesce((select jsonb_agg(to_jsonb(s) - 'first_id' order by first_id) from sold s), '[]'::jsonb)
  );
$$;

revoke all on function public.matcher_catalogue(uuid) from public, anon;
grant execute on function public.matcher_catalogue(uuid) to authenticated, service_role;
notify pgrst, 'reload schema';
