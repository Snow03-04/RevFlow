import { lineItemCost, tieredCost, type CostTier } from "@/lib/profit";
import { euOrderFee, euOrderFeeEur, sheetIncludedEuFee } from "./eu-order-fee";
import type { SupplierFamilyGroup } from "@/lib/supplier/family-quotes";

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
  | "eu_order_fee" // one dated EUR fee per eligible order; inside a sheet total, else added
  | "sheet" // exact supplier cost for the whole order
  | "collection" // priced with its COGS collection's tiers
  | "tier" // product's own quantity tier
  | "manual" // effective-dated manual/derived product cost
  | "supplier_quote" // estimate learned from a dated supplier unit quote
  | "supplier_bundle" // estimate learned for this quantity / product combination
  | "supplier_family" // dated bundle estimate for independently verified product types
  | "variant" // Shopify per-variant cost
  | "snapshot" // unit cost captured on the order line
  | "percent"; // % of selling price fallback

export const COST_SOURCE_LABEL: Record<CostSource, string> = {
  eu_order_fee: "Taxa UE por encomenda",
  sheet: "Sheet do fornecedor",
  collection: "Coleção (escalões)",
  tier: "Escalão de quantidade",
  manual: "Custo do produto (datado)",
  supplier_quote: "Estimativa pelo preço do fornecedor",
  supplier_bundle: "Estimativa por quantidade do fornecedor",
  supplier_family: "Estimativa por grupo do fornecedor",
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
  note?: string;
  /**
   * For a line priced as a GROUP (a COGS collection covers several products at
   * once), the products it covered and their quantities. Lets a caller spread
   * the group's cost back over its products — which is how the ROAS tracker
   * derives a per-product realised COGS from an order that was priced by
   * collection tiers.
   */
  members?: { productId: string; qty: number }[];
}

export interface OrderCostResult {
  euOrderFee?: number; // included in cost (and in a sheet total), never in computed merchandise cost
  /** Final cost in the store's BASE currency (sheet override applied). */
  cost: number;
  /** What the per-product rules alone produced, before any sheet override. */
  computedCost: number;
  units: number;
  /** "sheet" when the supplier sheet set the price for the whole order. */
  source: "sheet" | "computed";
  lines: OrderCostLine[];
}

export interface SupplierQuantityQuote {
  cost: number; // total for the quoted quantity, in base currency
  quantity: number;
  orderNumber: string;
  pendingLowerQuote?: string;
}

export interface OrderCostConfig {
  destinationCountry?: string | null;
  euOrderFeeRate?: number; // EUR to this store's base; zero when disabled
  fallbackCostPct: number;
  /** Effective-dated product cost (base currency) for a product on a day. */
  manualCostFor: (productId: string, ymd: string) => number | undefined;
  manualCostSourceFor?: (productId: string, ymd: string) => string | undefined;
  costByVariant: Map<string, number>;
  productTiers: Map<string, CostTier[]>;
  collectionByProduct: Map<string, string>;
  collectionInfo: Map<string, { baseUnit: number; tiers: CostTier[] }>;
  /** Collection a product outside every collection belongs to by its title
   * (see collection-match.ts); only used when it has no cost of its own. */
  autoCollectionFor?: (productId: string | undefined, title: string | null) => string | undefined;
  /** Items per variant ("2 kpl" = 2), so a pack counts fully in a collection. */
  packByVariant?: Map<string, number>;
  /** Exact cost for THIS order from the supplier sheet, if it has one. */
  supplierCost?: { cost: number; currency: string | null };
  /** base→display rate, to convert a display-currency sheet cost back to base. */
  storeToDisplay: number;
  /** Convert the currency actually stored on the row, including older costs. */
  currencyToBase?: Map<string, number>;
  supplierBasketQuoteFor?: (items: CostLineItem[], ymd: string) => SupplierQuantityQuote | undefined;
  supplierProductQuoteFor?: (productId: string, quantity: number, ymd: string) => SupplierQuantityQuote | undefined;
  supplierUnitQuoteFor?: (productId: string, ymd: string) => SupplierQuantityQuote | undefined;
  supplierFamilyGroupsFor?: (items: CostLineItem[], ymd: string) => SupplierFamilyGroup[];
}

/** Raw cost tables, as stored (amounts in the DISPLAY currency when tagged). */
export interface RawCostRows {
  productCosts: {
    shopify_product_id: string;
    cost: number;
    effective_from: string;
    currency: string | null;
    source?: string;
  }[];
  tiers: {
    shopify_product_id: string;
    min_qty: number;
    total_cost: number;
    currency: string | null;
  }[];
  collections: {
    id: string;
    base_unit_cost: number;
    currency: string | null;
  }[];
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
    currencyToBase?: Map<string, number>;
  },
): Omit<OrderCostConfig, "supplierCost"> {
  const { storeToDisplay } = opts;
  const toBase = (amount: number, currency: string | null): number =>
    costInBase(amount, currency, opts);

  // productId -> dated costs (ascending by effective_from), in base currency.
  const manualByProduct = new Map<
    string,
    { from: string; costBase: number; source?: string }[]
  >();
  for (const m of raw.productCosts) {
    const list = manualByProduct.get(m.shopify_product_id) ?? [];
    list.push({
      from: m.effective_from,
      costBase: toBase(Number(m.cost), m.currency),
      source: m.source,
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

  function manualCostSourceFor(productId: string, ymd: string): string | undefined {
    let source: string | undefined;
    for (const entry of manualByProduct.get(productId) ?? []) {
      if (entry.from > ymd) break;
      source = entry.source;
    }
    return source;
  }

  return {
    fallbackCostPct: opts.fallbackCostPct,
    manualCostFor,
    manualCostSourceFor,
    costByVariant: opts.costByVariant,
    productTiers,
    collectionByProduct,
    collectionInfo,
    storeToDisplay,
    currencyToBase: opts.currencyToBase,
  };
}

export function costOrder(
  items: CostLineItem[],
  ymd: string,
  cfg: OrderCostConfig,
): OrderCostResult {
  const collectionQty = new Map<
    string,
    { qty: number; members: Map<string, number>; auto: Set<string> }
  >();
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

    const manualCost = pid ? cfg.manualCostFor(pid, ymd) : undefined;
    const variantCost = li.shopify_variant_id
      ? cfg.costByVariant.get(li.shopify_variant_id)
      : undefined;
    const tiers = pid ? cfg.productTiers.get(pid) : undefined;

    // A collection member? Defer — priced once on the combined quantity. A
    // product in no collection joins the one its title points to, unless it
    // has a cost of its own (one learned from a single-item sheet order is
    // just an estimate, so the collection's bundle prices beat it).
    let cid = pid ? cfg.collectionByProduct.get(pid) : undefined;
    const auto =
      !cid &&
      !tiers?.length &&
      variantCost == null &&
      (manualCost == null || cfg.manualCostSourceFor?.(pid!, ymd) === "sheet");
    if (auto) cid = cfg.autoCollectionFor?.(pid, title);
    if (cid && cfg.collectionInfo.has(cid)) {
      const agg = collectionQty.get(cid) ?? {
        qty: 0,
        members: new Map<string, number>(),
        auto: new Set<string>(),
      };
      const items =
        qty *
        (li.shopify_variant_id
          ? (cfg.packByVariant?.get(li.shopify_variant_id) ?? 1)
          : 1);
      agg.qty += items;
      if (pid) {
        agg.members.set(pid, (agg.members.get(pid) ?? 0) + items);
        if (auto) agg.auto.add(title ?? pid);
      }
      collectionQty.set(cid, agg);
      continue;
    }

    // Has quantity tiers? Accumulate and price on the total below.
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
        ? cfg.manualCostSourceFor?.(pid!, ymd) === "sheet" ? "supplier_quote" : "manual"
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
  for (const [cid, { qty, members, auto }] of collectionQty) {
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
      members: [...members].map(([productId, q]) => ({ productId, qty: q })),
      ...(auto.size
        ? { note: `Pelo nome, sem estar na coleção: ${[...auto].join(", ")}.` }
        : {}),
    });
  }

  // Reuse the total for the same basket first, then product quantity quotes.
  // A manual unit price that matches supplier evidence is still a UNIT price:
  // it must not disable a proven quantity discount. Different manual prices
  // and explicit product/collection tiers retain priority.
  const canEstimate = (line: OrderCostLine) => {
    if (["tier", "collection"].includes(line.source)) return false;
    if (line.source !== "manual") return true;
    const unit = line.productId ? cfg.supplierUnitQuoteFor?.(line.productId, ymd) : undefined;
    return unit != null && line.unitCost != null && Math.abs(unit.cost - line.unitCost) < 0.00001;
  };
  function applyQuote(targets: OrderCostLine[], quote: SupplierQuantityQuote, total: number) {
    const weight = targets.reduce((sum, line) => sum + line.lineCost, 0);
    const quantity = targets.reduce((sum, line) => sum + line.qty, 0);
    for (const line of targets) {
      line.lineCost = total * (weight > 0 ? line.lineCost / weight : line.qty / quantity);
      line.unitCost = null;
      line.source = "supplier_bundle";
      line.note = `Referência: #${quote.orderNumber.replace(/\D/g, "")} (${quote.quantity} unidades).` +
        (quantity > quote.quantity ? " Unidades adicionais estimadas ao custo unitário." : "") +
        (quote.pendingLowerQuote ? ` Preço inferior em #${quote.pendingLowerQuote.replace(/\D/g, "")} aguarda repetição noutra encomenda equivalente.` : "");
    }
  }
  const basketQuote = units > 1 && lines.every(canEstimate)
    ? cfg.supplierBasketQuoteFor?.(items, ymd) : undefined;
  if (basketQuote) applyQuote(lines, basketQuote, basketQuote.cost);
  else {
    const familyPriced = new Set<OrderCostLine>();
    const eligibleItems = items.filter(item => lines.some(line => line.productId === item.shopify_product_id && canEstimate(line)));
    for (const family of cfg.supplierFamilyGroupsFor?.(eligibleItems, ymd) ?? []) {
      const targets = lines.filter(line => line.productId && family.productIds.includes(line.productId));
      if (!targets.length || !targets.every(canEstimate)) continue;
      const quantity = targets.reduce((n, line) => n + line.qty, 0);
      // Existing specific unit prices stay authoritative. Family unit prices
      // fill only missing costs; quantity estimates combine designs/AfterSell lines.
      if (quantity === 1 && targets.some(line => line.source !== "percent")) continue;
      const familyItems = eligibleItems.filter(item => item.shopify_product_id && family.productIds.includes(item.shopify_product_id));
      const exact = quantity > 1 ? cfg.supplierBasketQuoteFor?.(familyItems, ymd) : undefined;
      if (exact) applyQuote(targets, exact, exact.cost);
      else {
        const total = family.quote.cost + (quantity - family.quote.quantity) * family.unitCost;
        applyQuote(targets, family.quote, total);
        for (const line of targets) {
          line.source = "supplier_family";
          line.note = `Grupo: ${family.phrase}. ${line.note}`;
        }
      }
      targets.forEach(line => familyPriced.add(line));
    }
    const byProduct = new Map<string, OrderCostLine[]>();
    for (const line of lines) if (line.productId && !familyPriced.has(line)) {
      const group = byProduct.get(line.productId) ?? [];
      group.push(line);
      byProduct.set(line.productId, group);
    }
    for (const [pid, group] of byProduct) {
      if (!group.every(canEstimate)) continue;
      const quantity = group.reduce((sum, line) => sum + line.qty, 0);
      if (quantity < 2) continue;
      const quote = cfg.supplierProductQuoteFor?.(pid, quantity, ymd);
      if (!quote) continue;
      const base = group.reduce((sum, line) => sum + line.lineCost, 0);
      applyQuote(group, quote, quote.cost + (quantity - quote.quantity) * base / quantity);
    }
  }
  computedCost = lines.reduce((sum, line) => sum + line.lineCost, 0);

  // Once per order, never per unit. The supplier already charges it inside the
  // sheet total, so a sheet order splits its total; otherwise it is added on top.
  const fee = euOrderFee(ymd, cfg.destinationCountry, cfg.euOrderFeeRate);
  // The supplier sheet's exact cost wins — it already bakes in volume discounts
  // and cross-product bundles, so it is what the merchant actually paid.
  const sheetCost = cfg.supplierCost
    ? costInBase(cfg.supplierCost.cost, cfg.supplierCost.currency, cfg) : undefined;
  const feePart = sheetCost == null ? fee : sheetIncludedEuFee(sheetCost, fee);
  if (feePart > 0) lines.push({ productId: null, qty: 1, unitCost: feePart, lineCost: feePart, source: "eu_order_fee",
    title: `Taxa UE (${euOrderFeeEur(ymd)} € por encomenda${sheetCost == null ? "" : ", incluída na sheet"})` });
  const extra = feePart > 0 ? { euOrderFee: feePart } : {};

  if (sheetCost != null)
    return { cost: sheetCost, computedCost, units, source: "sheet", lines, ...extra };

  return { cost: computedCost + fee, computedCost, units, source: "computed", lines, ...extra };
}

export function costInBase(
  amount: number,
  currency: string | null,
  cfg: { storeToDisplay: number; currencyToBase?: Map<string, number> },
): number {
  if (!currency) return amount;
  if (cfg.currencyToBase) {
    const rate = cfg.currencyToBase.get(currency.toUpperCase());
    if (rate == null || !Number.isFinite(rate) || rate <= 0)
      throw new Error(`Câmbio indisponível para COGS em ${currency}.`);
    return amount * rate;
  }
  return cfg.storeToDisplay > 0 ? amount / cfg.storeToDisplay : amount;
}

/** Allocate the FINAL order cost to its original lines, conserving zero sheet
 * overrides, bundle prices and lines without product ids. Shared by Products
 * and ROAS so the allocation cannot invent or drop part of an order's COGS. */
export function allocateOrderCost(
  items: CostLineItem[],
  priced: OrderCostResult,
): number[] {
  const byProduct = new Map<string | null, number>();
  for (const line of priced.lines) {
    // The order fee follows the merchandise allocation; it is not a product.
    if (line.source === "eu_order_fee") continue;
    if (line.members?.length) {
      for (const m of line.members)
        byProduct.set(
          m.productId,
          (byProduct.get(m.productId) ?? 0) +
            (line.lineCost * m.qty) / line.qty,
        );
    } else
      byProduct.set(
        line.productId,
        (byProduct.get(line.productId) ?? 0) + line.lineCost,
      );
  }
  const quantities = items.map((li) =>
    Math.max(0, Number(li.current_quantity ?? li.quantity)),
  );
  const byProductQty = new Map<string | null, number>();
  items.forEach((li, i) =>
    byProductQty.set(
      li.shopify_product_id,
      (byProductQty.get(li.shopify_product_id) ?? 0) + quantities[i],
    ),
  );
  const weights = items.map((li, i) => {
    const qty = byProductQty.get(li.shopify_product_id) ?? 0;
    return qty > 0
      ? ((byProduct.get(li.shopify_product_id) ?? 0) * quantities[i]) / qty
      : 0;
  });
  const totalWeight = weights.reduce((a, b) => a + b, 0);
  // A supplier cost can remain after every item was refunded. Preserve that
  // expense and attribute it using the original quantities in that case.
  const fallback = quantities.some((q) => q > 0)
    ? quantities
    : items.map((li) => Math.max(0, Number(li.quantity)));
  const totalQty = fallback.reduce((a, b) => a + b, 0);
  return items.map((_, i) =>
    totalWeight > 0
      ? (priced.cost * weights[i]) / totalWeight
      : totalQty > 0
        ? (priced.cost * fallback[i]) / totalQty
        : 0,
  );
}
