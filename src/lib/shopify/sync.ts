import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/types/database";
import { shopifyPaginate, shopifyGet } from "@/lib/shopify/client";
import { selectAllByUser } from "@/lib/supabase/paginate";

type DB = SupabaseClient<Database>;

export interface ShopifyCtx {
  supabase: DB;
  userId: string;
  shop: string;
  token: string; // already decrypted
}

/* ------------------------------------------------------------------ */
/* Products + cost                                                     */
/* ------------------------------------------------------------------ */

export async function syncShopifyProducts(ctx: ShopifyCtx): Promise<number> {
  const { supabase, userId, shop, token } = ctx;

  type Row = TablesInsert<"products"> & { _inv: number | null };
  const rows: Row[] = [];
  const seenVariants = new Set<string>();

  // Shopify's product list defaults to active products only — iterate every
  // status so drafts and archived products are imported too.
  for (const status of ["active", "draft", "archived"] as const) {
    for await (const products of shopifyPaginate<any>(
      shop,
      token,
      "products",
      "products",
      { limit: 250, published_status: "any", status },
    )) {
      for (const p of products) {
        const image = p.image?.src ?? p.images?.[0]?.src ?? null;
        for (const v of p.variants ?? []) {
          const variantId = String(v.id);
          if (seenVariants.has(variantId)) continue;
          seenVariants.add(variantId);
          rows.push({
            user_id: userId,
            shopify_product_id: String(p.id),
            shopify_variant_id: variantId,
            title: p.title ?? null,
            variant_title: v.title === "Default Title" ? null : v.title,
            sku: v.sku || null,
            price: Number(v.price ?? 0),
            image_url: image,
            currency: null,
            cost_source: "shopify",
            handle: p.handle ?? null,
            _inv: v.inventory_item_id ?? null,
          });
        }
      }
    }
  }

  // Look up unit cost from inventory items (batched, 100 ids per call).
  const invIds = [
    ...new Set(rows.map((r) => r._inv).filter((x): x is number => x != null)),
  ];
  const costByInv = new Map<number, number>();
  for (let i = 0; i < invIds.length; i += 100) {
    const ids = invIds.slice(i, i + 100).join(",");
    try {
      const { data } = await shopifyGet<{ inventory_items: any[] }>(
        shop,
        token,
        "inventory_items",
        { ids, limit: 100 },
      );
      for (const item of data.inventory_items ?? []) {
        if (item.cost != null) costByInv.set(item.id, Number(item.cost));
      }
    } catch {
      // Non-fatal: a failed cost batch must not block the product import.
    }
  }

  // Preserve any manual cost overrides the merchant has set.
  const existing = await selectAllByUser<{
    shopify_variant_id: string;
    cost: number | null;
    cost_source: string;
  }>(supabase, "products", "shopify_variant_id, cost, cost_source", userId);
  const manual = new Map(
    existing
      .filter((e) => e.cost_source === "manual")
      .map((e) => [e.shopify_variant_id, Number(e.cost)]),
  );

  const upserts: TablesInsert<"products">[] = rows.map((r) => {
    const { _inv, ...rest } = r;
    const manualCost = manual.get(r.shopify_variant_id);
    return {
      ...rest,
      cost: manualCost ?? (_inv != null ? costByInv.get(_inv) ?? null : null),
      cost_source: manualCost != null ? "manual" : "shopify",
    };
  });

  for (let i = 0; i < upserts.length; i += 500) {
    const batch = upserts.slice(i, i + 500);
    let { error } = await supabase
      .from("products")
      .upsert(batch, { onConflict: "user_id,shopify_variant_id" });
    // Gracefully handle migration 0011 (handle column) not being applied yet.
    if (error && /handle/i.test(error.message)) {
      const stripped = batch.map((r) => {
        const copy = { ...r };
        delete copy.handle;
        return copy;
      });
      ({ error } = await supabase
        .from("products")
        .upsert(stripped, { onConflict: "user_id,shopify_variant_id" }));
    }
    if (error) throw error;
  }

  return upserts.length;
}

/* ------------------------------------------------------------------ */
/* Orders + line items                                                 */
/* ------------------------------------------------------------------ */

function refundTotal(order: any): number {
  let total = 0;
  for (const r of order.refunds ?? []) {
    const txns = r.transactions ?? [];
    if (txns.length) {
      for (const t of txns) {
        if (t.kind === "refund" && (t.status === "success" || !t.status)) {
          total += Number(t.amount ?? 0);
        }
      }
    } else {
      for (const li of r.refund_line_items ?? []) {
        total += Number(li.subtotal ?? li.subtotal_set?.shop_money?.amount ?? 0);
      }
      for (const adj of r.order_adjustments ?? []) {
        total += Math.abs(Number(adj.amount ?? 0));
      }
    }
  }
  return total;
}

function mapOrder(userId: string, o: any): TablesInsert<"orders"> {
  const country =
    o.shipping_address?.country_code ??
    o.billing_address?.country_code ??
    o.customer?.default_address?.country_code ??
    null;
  return {
    user_id: userId,
    shopify_order_id: String(o.id),
    order_number: o.name ?? (o.order_number ? `#${o.order_number}` : null),
    processed_at: o.processed_at ?? o.created_at,
    currency: o.currency ?? null,
    financial_status: o.financial_status ?? null,
    fulfillment_status: o.fulfillment_status ?? null,
    subtotal_price: Number(o.subtotal_price ?? 0),
    total_price: Number(o.total_price ?? 0),
    total_discounts: Number(o.total_discounts ?? 0),
    total_tax: Number(o.total_tax ?? 0),
    total_shipping: Number(o.total_shipping_price_set?.shop_money?.amount ?? 0),
    total_refunded: refundTotal(o),
    customer_id: o.customer?.id ? String(o.customer.id) : null,
    customer_email: o.email ?? o.customer?.email ?? null,
    country,
    cancelled_at: o.cancelled_at ?? null,
    test: Boolean(o.test),
  };
}

/** Upsert a single order + its line items. Returns the affected local date(s). */
export async function upsertOrder(
  ctx: Pick<ShopifyCtx, "supabase" | "userId">,
  o: any,
  costByVariant: Map<string, number>,
): Promise<void> {
  const { supabase, userId } = ctx;

  const { data: orderRow, error } = await supabase
    .from("orders")
    .upsert(mapOrder(userId, o), { onConflict: "user_id,shopify_order_id" })
    .select("id")
    .single();
  if (error) throw error;

  const lineItems: TablesInsert<"order_line_items">[] = (o.line_items ?? []).map(
    (li: any) => ({
      user_id: userId,
      order_id: orderRow.id,
      shopify_line_item_id: String(li.id),
      shopify_product_id: li.product_id ? String(li.product_id) : null,
      shopify_variant_id: li.variant_id ? String(li.variant_id) : null,
      title: li.title ?? null,
      sku: li.sku || null,
      quantity: Number(li.quantity ?? 0),
      price: Number(li.price ?? 0),
      total_discount: Number(li.total_discount ?? 0),
      unit_cost: li.variant_id
        ? costByVariant.get(String(li.variant_id)) ?? null
        : null,
    }),
  );

  if (lineItems.length) {
    const { error: liErr } = await supabase
      .from("order_line_items")
      .upsert(lineItems, { onConflict: "user_id,shopify_line_item_id" });
    if (liErr) throw liErr;
  }
}

export async function buildVariantCostMap(
  supabase: DB,
  userId: string,
): Promise<Map<string, number>> {
  const data = await selectAllByUser<{
    shopify_variant_id: string;
    cost: number | null;
  }>(supabase, "products", "shopify_variant_id, cost", userId, (q) =>
    q.not("cost", "is", null),
  );
  return new Map(data.map((p) => [p.shopify_variant_id, Number(p.cost)]));
}

async function variantCostMap(ctx: ShopifyCtx): Promise<Map<string, number>> {
  return buildVariantCostMap(ctx.supabase, ctx.userId);
}

export async function syncShopifyOrders(
  ctx: ShopifyCtx,
  sinceISO?: string,
): Promise<number> {
  const { shop, token } = ctx;
  const costByVariant = await variantCostMap(ctx);

  const query: Record<string, string | number> = {
    status: "any",
    limit: 250,
  };
  if (sinceISO) query.updated_at_min = sinceISO;

  let count = 0;
  for await (const orders of shopifyPaginate<any>(
    shop,
    token,
    "orders",
    "orders",
    query,
  )) {
    for (const o of orders) {
      await upsertOrder(ctx, o, costByVariant);
      count++;
    }
  }
  return count;
}
