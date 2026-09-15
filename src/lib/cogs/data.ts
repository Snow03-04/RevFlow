import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { resolveFx } from "@/lib/fx";
import {
  buildOrderCostConfig,
  type RawCostRows,
  type CostLineItem,
} from "./order-cost";

type DB = SupabaseClient<Database>;
export const supplierOrderKey = (
  storeId: string | null,
  number: string | null,
): string => `${storeId ?? ""}:${(number ?? "").replace(/\D/g, "")}`;

/** Every cost consumer reads the same complete tables and propagates failures.
 * A failed read must never look like zero COGS or a successful reconciliation. */
export async function loadCostData(supabase: DB, userId: string) {
  const [
    productCosts,
    tiers,
    collections,
    collectionProducts,
    collectionTiers,
    supplierRows,
  ] = await Promise.all([
    selectAllByUser<RawCostRows["productCosts"][number]>(
      supabase,
      "product_costs",
      "shopify_product_id,cost,effective_from,currency",
      userId,
    ),
    selectAllByUser<RawCostRows["tiers"][number]>(
      supabase,
      "product_cost_tiers",
      "shopify_product_id,min_qty,total_cost,currency",
      userId,
    ),
    selectAllByUser<RawCostRows["collections"][number]>(
      supabase,
      "cogs_collections",
      "id,base_unit_cost,currency",
      userId,
    ),
    selectAllByUser<RawCostRows["collectionProducts"][number]>(
      supabase,
      "cogs_collection_products",
      "collection_id,shopify_product_id",
      userId,
    ),
    selectAllByUser<RawCostRows["collectionTiers"][number]>(
      supabase,
      "cogs_collection_tiers",
      "collection_id,min_qty,total_cost,currency",
      userId,
    ),
    selectAllByUser<Tables<"order_supplier_costs">>(
      supabase,
      "order_supplier_costs",
      "*",
      userId,
    ),
  ]);
  const raw = {
    productCosts,
    tiers,
    collections,
    collectionProducts,
    collectionTiers,
  };
  const supplierByOrder = new Map(
    supplierRows.map((r) => [
      supplierOrderKey(r.shopify_connection_id, r.order_number),
      { cost: Number(r.cost), currency: r.currency },
    ]),
  );
  const currencies = new Set(
    [
      ...productCosts,
      ...tiers,
      ...collections,
      ...collectionTiers,
      ...supplierRows,
    ].flatMap((r) => (r.currency ? [r.currency.toUpperCase()] : [])),
  );

  async function forStore(
    storeId: string | null,
    items: CostLineItem[],
    settings: Tables<"settings"> | null,
  ) {
    const displayCurrency = settings?.currency ?? "EUR";
    let q = supabase
      .from("orders")
      .select("currency")
      .eq("user_id", userId)
      .not("currency", "is", null);
    q = storeId
      ? q.eq("shopify_connection_id", storeId)
      : q.is("shopify_connection_id", null);
    const { data: lastOrder, error } = await q
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    // No orders means no foreign-currency amount to convert for this store yet.
    const base = lastOrder?.currency ?? displayCurrency;
    const fxContext = {
      storeCurrency: base,
      displayCurrency,
      override: settings?.fx_rate_override,
      required: true,
    };
    const storeToDisplay = await resolveFx(base, displayCurrency, fxContext);
    const currencyToBase = new Map<string, number>([[base.toUpperCase(), 1]]);
    for (const currency of currencies)
      currencyToBase.set(currency, await resolveFx(currency, base, fxContext));
    const variants = await selectAllIn<{
      shopify_variant_id: string;
      cost: number | null;
    }>(
      supabase,
      "products",
      "shopify_variant_id,cost",
      userId,
      "shopify_variant_id",
      items.flatMap((li) =>
        li.shopify_variant_id ? [li.shopify_variant_id] : [],
      ),
    );
    const costByVariant = new Map(
      variants
        .filter((v) => v.cost != null)
        .map((v) => [v.shopify_variant_id, Number(v.cost)]),
    );
    return buildOrderCostConfig(raw, {
      storeToDisplay,
      currencyToBase,
      costByVariant,
      fallbackCostPct: Number(settings?.default_product_cost_pct ?? 30),
    });
  }
  return { raw, supplierRows, supplierByOrder, forStore };
}
