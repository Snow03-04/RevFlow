import { lineItemCost, tieredCost, type CostTier } from "@/lib/profit";

/**
 * Costing one order — the SINGLE source of truth for how COGS is derived.
 *
 * Both the daily-metrics recompute (which feeds the dashboard) and the COGS
 * audit screen call this, so what the audit shows is literally what the
 * dashboard counted. It also reports WHY each line was priced the way it was,
 * which is what makes the audit worth reading.
 */

export interface CostLineItem {
  shopify_product_id: string | null;
  shopify_variant_id: string | null;
  quantity: number;
  current_quantity: number | null;
  price: number;
  unit_cost: number | null;
  title?: string | null;
}

/** How a line's unit cost was decided, most to least specific. */
export type CostSource =
  | "sheet" // exact supplier cost for the whole order
  | "collection" // priced with its COGS collection's tiers
  | "tier" // product's own quantity tier
  | "manual" // effective-dated manual/derived product cost
  | "variant" // Shopify per-variant cost
  | "snapshot" // unit cost captured on the order line
  | "percent"; // % of selling price fallback

export const COST_SOURCE_LABEL: Record<CostSource, string> = {
  sheet: "Sheet do fornecedor",
  collection: "Coleção (escalões)",
  tier: "Escalão de quantidade",
  manual: "Custo do produto (datado)",
  variant: "Custo da variante (Shopify)",
  snapshot: "Custo guardado na encomenda",
  percent: "% do preço de venda",
};

export interface OrderCostLine {
  productId: string | null;
  title: string | null;
  qty: number;
  unitCost: number | null; // base currency, null when priced as a group
  lineCost: number; // base currency
  source: CostSource;
}

export interface OrderCostResult {
  /** Final cost in the store's BASE currency (sheet override applied). */
  cost: number;
  /** What the per-product rules alone produced, before any sheet override. */
  computedCost: number;
  units: number;
  /** "sheet" when the supplier sheet set the price for the whole order. */
  source: "sheet" | "computed";
  lines: OrderCostLine[];
}

export interface OrderCostConfig {
  fallbackCostPct: number;
  /** Effective-dated product cost (base currency) for a product on a day. */
  manualCostFor: (productId: string, ymd: string) => number | undefined;
  costByVariant: Map<string, number>;
  productTiers: Map<string, CostTier[]>;
  collectionByProduct: Map<string, string>;
  collectionInfo: Map<string, { baseUnit: number; tiers: CostTier[] }>;
  /** Exact cost for THIS order from the supplier sheet, if it has one. */
  supplierCost?: { cost: number; currency: string | null };
  /** base→display rate, to convert a display-currency sheet cost back to base. */
  storeToDisplay: number;
}

/** Raw cost tables, as stored (amounts in the DISPLAY currency when tagged). */
export interface RawCostRows {
  productCosts: {
    shopify_product_id: string;
    cost: number;
    effective_from: string;
    currency: string | null;
  }[];
  tiers: {
    shopify_product_id: string;
    min_qty: number;
    total_cost: number;
    currency: string | null;
  }[];
  collections: { id: string; base_unit_cost: number; currency: string | null }[];
  collectionProducts: { collection_id: string; shopify_product_id: string }[];
  collectionTiers: {
    collection_id: string;
    min_qty: number;
    total_cost: number;
    currency: string | null;
  }[];
}

/**
 * Turn the raw cost tables into the lookups `costOrder` needs, converting
 * display-currency amounts into the store's BASE currency with that store's
 * rate. Shared so the recompute and the audit build costs identically.
 */
export function buildOrderCostConfig(
  raw: RawCostRows,
  opts: {
    storeToDisplay: number;
    fallbackCostPct: number;
    costByVariant: Map<string, number>;
  },
): Omit<OrderCostConfig, "supplierCost"> {
  const { storeToDisplay } = opts;
  const toBase = (amount: number, currency: string | null): number =>
    currency == null || storeToDisplay <= 0 ? amount : amount / storeToDisplay;

  // productId -> dated costs (ascending by effective_from), in base currency.
  const manualByProduct = new Map<string, { from: string; costBase: number }[]>();
  for (const m of raw.productCosts) {
    const list = manualByProduct.get(m.shopify_product_id) ?? [];
    list.push({
      from: m.effective_from,
      costBase: toBase(Number(m.cost), m.currency),
    });
    manualByProduct.set(m.shopify_product_id, list);
  }
  for (const list of manualByProduct.values())
    list.sort((a, b) => a.from.localeCompare(b.from));

  const productTiers = new Map<string, CostTier[]>();
  for (const t of raw.tiers) {
    const list = productTiers.get(t.shopify_product_id) ?? [];
    list.push({
      minQty: t.min_qty,
      total: toBase(Number(t.total_cost), t.currency),
    });
    productTiers.set(t.shopify_product_id, list);
  }

  const collectionInfo = new Map<
    string,
    { baseUnit: number; tiers: CostTier[] }
  >();
  for (const c of raw.collections)
    collectionInfo.set(c.id, {
      baseUnit: toBase(Number(c.base_unit_cost), c.currency),
      tiers: [],
    });
  for (const t of raw.collectionTiers) {
    const info = collectionInfo.get(t.collection_id);
    if (info)
      info.tiers.push({
        minQty: t.min_qty,
        total: toBase(Number(t.total_cost), t.currency),
      });
  }

  const collectionByProduct = new Map<string, string>();
  for (const cp of raw.collectionProducts)
    collectionByProduct.set(cp.shopify_product_id, cp.collection_id);

  /** Manual cost (base) in effect for a product on a given local day. */
  function manualCostFor(productId: string, ymd: string): number | undefined {
    const list = manualByProduct.get(productId);
    if (!list) return undefined;
    let chosen: number | undefined;
    for (const e of list) {
      if (e.from <= ymd) chosen = e.costBase;
      else break; // sorted ascending
    }
    return chosen;
  }

  return {
    fallbackCostPct: opts.fallbackCostPct,
    manualCostFor,
    costByVariant: opts.costByVariant,
    productTiers,
    collectionByProduct,
    collectionInfo,
    storeToDisplay,
  };
}

export function costOrder(
  items: CostLineItem[],
  ymd: string,
  cfg: OrderCostConfig,
): OrderCostResult {
  const collectionQty = new Map<string, number>();
  const tieredProdQty = new Map<
    string,
    { qty: number; unit: number; title: string | null }
  >();
  const lines: OrderCostLine[] = [];
  let computedCost = 0;
  let units = 0;

  for (const li of items) {
    // Cost on the CURRENT quantity (after order edits / refunds), falling back
    // to the ordered quantity for rows synced before current_quantity existed.
    const qty = Number(li.current_quantity ?? li.quantity);
    if (qty <= 0) continue; // fully removed/refunded line — no cost, no units
    units += qty;
    const pid = li.shopify_product_id ?? undefined;
    const title = li.title ?? null;

    // A collection member? Defer — priced once on the combined quantity.
    const cid = pid ? cfg.collectionByProduct.get(pid) : undefined;
    if (cid) {
      collectionQty.set(cid, (collectionQty.get(cid) ?? 0) + qty);
      continue;
    }

    const manualCost = pid ? cfg.manualCostFor(pid, ymd) : undefined;
    const variantCost = li.shopify_variant_id
      ? cfg.costByVariant.get(li.shopify_variant_id)
      : undefined;

    // Has quantity tiers? Accumulate and price on the total below.
    const tiers = pid ? cfg.productTiers.get(pid) : undefined;
    if (tiers && tiers.length > 0 && pid) {
      const unit =
        manualCost ??
        variantCost ??
        (li.unit_cost != null
          ? Number(li.unit_cost)
          : Number(li.price) * (cfg.fallbackCostPct / 100));
      const agg = tieredProdQty.get(pid);
      if (agg) agg.qty += qty;
      else tieredProdQty.set(pid, { qty, unit, title });
      continue;
    }

    const unitCost = manualCost ?? variantCost ?? li.unit_cost;
    const lineCost = lineItemCost(
      qty,
      Number(li.price),
      unitCost,
      cfg.fallbackCostPct,
    );
    const source: CostSource =
      manualCost != null
        ? "manual"
        : variantCost != null
          ? "variant"
          : li.unit_cost != null
            ? "snapshot"
            : "percent";
    computedCost += lineCost;
    lines.push({
      productId: pid ?? null,
      title,
      qty,
      unitCost: unitCost != null ? Number(unitCost) : null,
      lineCost,
      source,
    });
  }

  // Tiered single products, priced on their per-order quantity.
  for (const [pid, { qty, unit, title }] of tieredProdQty) {
    const lineCost = tieredCost(qty, unit, cfg.productTiers.get(pid)!);
    computedCost += lineCost;
    lines.push({
      productId: pid,
      title,
      qty,
      unitCost: null,
      lineCost,
      source: "tier",
    });
  }

  // Collections, priced on the combined quantity across their products.
  for (const [cid, qty] of collectionQty) {
    const info = cfg.collectionInfo.get(cid);
    if (!info) continue;
    const lineCost = tieredCost(qty, info.baseUnit, info.tiers);
    computedCost += lineCost;
    lines.push({
      productId: null,
      title: "Coleção",
      qty,
      unitCost: null,
      lineCost,
      source: "collection",
    });
  }

  // The supplier sheet's exact cost wins — it already bakes in volume discounts
  // and cross-product bundles, so it is what the merchant actually paid.
  if (cfg.supplierCost) {
    const sc = cfg.supplierCost;
    const cost =
      sc.currency == null || cfg.storeToDisplay <= 0
        ? sc.cost
        : sc.cost / cfg.storeToDisplay;
    return { cost, computedCost, units, source: "sheet", lines };
  }

  return { cost: computedCost, computedCost, units, source: "computed", lines };
}
