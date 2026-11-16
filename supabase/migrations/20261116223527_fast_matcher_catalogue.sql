-- Keep the usual catalogue read inside the index. A separate, normally empty
-- branch preserves arbitrarily long product names without indexing them.
create index if not exists idx_products_matcher_cover on public.products (user_id, shopify_product_id, id)
  include (shopify_connection_id, price, cost, handle, title)
  where octet_length(shopify_product_id) + octet_length(coalesce(handle, '')) + octet_length(coalesce(title, '')) <= 1500;
create index if not exists idx_products_matcher_long on public.products (user_id)
  where octet_length(shopify_product_id) + octet_length(coalesce(handle, '')) + octet_length(coalesce(title, '')) > 1500;

create or replace function public.matcher_catalogue(p_user_id uuid)
returns jsonb language sql stable security invoker set search_path = public
set work_mem = '12MB'
as $$
  with inputs as (
    select id, shopify_product_id, shopify_connection_id, handle, title, price, cost from public.products
    where user_id = p_user_id and octet_length(shopify_product_id) + octet_length(coalesce(handle, '')) + octet_length(coalesce(title, '')) <= 1500
    union all
    select id, shopify_product_id, shopify_connection_id, handle, title, price, cost from public.products
    where user_id = p_user_id and octet_length(shopify_product_id) + octet_length(coalesce(handle, '')) + octet_length(coalesce(title, '')) > 1500
    order by shopify_product_id, id
  ), variants as (
    -- UUID text in C collation orders variants like the native UUID. These
    -- minima keep only the first eligible value instead of sorting arrays.
    select p.shopify_product_id,
      min(array[p.id::text, p.shopify_connection_id::text, p.handle, p.title, p.price::text] collate "C") as first_variant,
      min(array[p.id::text, p.handle] collate "C") filter (where nullif(p.handle, '') is not null) as first_handle,
      min(array[p.id::text, p.title] collate "C") filter (where nullif(p.title, '') is not null) as first_title,
      min(array[p.id::text, p.cost::text] collate "C") filter (where p.cost is not null) as first_cost
    from inputs p group by p.shopify_product_id order by p.shopify_product_id
  ), catalogue as (
    select first_variant[1] as first_id, shopify_product_id, first_variant[2] as shopify_connection_id,
      coalesce(first_handle[2], first_variant[3]) as handle,
      coalesce(first_title[2], first_variant[4]) as title,
      first_variant[5]::numeric as price, first_cost[2]::numeric as cost
    from variants
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
