"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { ymdInTz, lastNDays } from "@/lib/date";
import { fetchSupplierCosts, parseSheetRef } from "@/lib/supplier/sheet";

export interface SupplierActionResult {
  ok: boolean;
  error?: string;
  productsUpdated?: number;
  matchedOrders?: number;
  priceTiers?: { from: string; cost: number }[];
  paidTotal?: number;
  unpaidTotal?: number;
}

/** Save (or clear) the supplier sheet URL after checking it can be read. */
export async function saveSupplierSheetUrl(
  url: string,
): Promise<SupplierActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const trimmed = url.trim();
  if (trimmed && !parseSheetRef(trimmed)) {
    return { ok: false, error: "Isso não parece um link de Google Sheets." };
  }
  if (trimmed) {
    const costs = await fetchSupplierCosts(trimmed);
    if (!costs) {
      return {
        ok: false,
        error:
          "Não consegui ler a sheet. Confirma que está partilhada como 'Qualquer pessoa com o link → Visualizador' e que tem colunas order / cost / states.",
      };
    }
  }

  const { error } = await supabase
    .from("settings")
    .update({ supplier_sheet_url: trimmed || null })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/supplier");
  return { ok: true };
}

const modal = (costs: number[]): number => {
  const freq = new Map<number, number>();
  for (const c of costs) freq.set(c, (freq.get(c) ?? 0) + 1);
  let best = costs[0];
  let bestN = 0;
  for (const [c, n] of freq) if (n > bestN) [best, bestN] = [c, n];
  return best;
};

/** Walk a product's per-day modal cost into effective-dated tiers. The first
 *  tier starts at 2000-01-01 so it also covers any order before the first
 *  observed date; later tiers begin the day the price changed. */
function toTiers(
  dailyModal: Map<string, number>,
): { effective_from: string; cost: number }[] {
  const days = [...dailyModal.keys()].sort();
  const tiers: { effective_from: string; cost: number }[] = [];
  let cur: number | null = null;
  for (const day of days) {
    const c = dailyModal.get(day)!;
    if (cur === null) {
      tiers.push({ effective_from: "2000-01-01", cost: c });
      cur = c;
    } else if (c !== cur) {
      tiers.push({ effective_from: day, cost: c });
      cur = c;
    }
  }
  return tiers;
}

/**
 * Read the supplier sheet, match each order to its Shopify line items, and
 * derive an effective-dated per-product COGS from what the supplier actually
 * charged. Single-item (qty 1) orders give the clean per-unit price; when it
 * changes over time (e.g. 12.70 → 12.50 → 12.00) each change becomes a dated
 * cost, so past profit is never rewritten. Writes rows tagged source='sheet'
 * (replacing previous auto rows, leaving manual costs intact) and recomputes.
 */
export async function applySupplierCosts(): Promise<SupplierActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("supplier_sheet_url, currency, timezone")
    .eq("user_id", user.id)
    .single();
  const url = settings?.supplier_sheet_url;
  if (!url) return { ok: false, error: "Falta o link da sheet nas Settings." };
  const displayCurrency = settings?.currency ?? "EUR";
  const tz = settings?.timezone ?? "UTC";

  const costs = await fetchSupplierCosts(url);
  if (!costs) return { ok: false, error: "Não consegui ler a sheet." };

  // Shopify order numbers are only unique WITHIN a store (#AURELLISVIKTORIE1312
  // and #ELENAEGER1312 both normalise to "1312"), so the sheet must be tied to
  // ONE store. Pick the store whose orders match the sheet best — that's the
  // store the sheet describes — and ignore every other store's orders.
  const { data: orderRows } = await supabase
    .from("orders")
    .select("id, order_number, processed_at, shopify_connection_id")
    .eq("user_id", user.id);

  const hitsByStore = new Map<string, number>();
  for (const o of orderRows ?? []) {
    const num = (o.order_number ?? "").replace(/\D/g, "");
    const sid = o.shopify_connection_id;
    if (num && sid && costs.byOrder.has(num))
      hitsByStore.set(sid, (hitsByStore.get(sid) ?? 0) + 1);
  }
  let sheetStoreId: string | null = null;
  let bestHits = 0;
  for (const [sid, n] of hitsByStore)
    if (n > bestHits) {
      bestHits = n;
      sheetStoreId = sid;
    }
  if (!sheetStoreId) {
    return {
      ok: false,
      error:
        "Nenhuma encomenda da sheet corresponde às tuas encomendas. Confirma que a coluna 'order' tem os números das encomendas do Shopify.",
    };
  }

  const orderByNum = new Map<string, { id: string; ymd: string }>();
  for (const o of orderRows ?? []) {
    if (o.shopify_connection_id !== sheetStoreId) continue; // other store — skip
    const num = (o.order_number ?? "").replace(/\D/g, "");
    if (num)
      orderByNum.set(num, {
        id: o.id,
        ymd: ymdInTz(new Date(o.processed_at), tz),
      });
  }

  // Line items for the orders that appear in the sheet.
  const wanted = [...costs.byOrder.keys()]
    .map((n) => orderByNum.get(n)?.id)
    .filter((id): id is string => !!id);
  const itemsByOrder = new Map<string, { productId: string; qty: number }[]>();
  for (let i = 0; i < wanted.length; i += 200) {
    const chunk = wanted.slice(i, i + 200);
    const { data } = await supabase
      .from("order_line_items")
      .select("order_id, shopify_product_id, quantity")
      .in("order_id", chunk);
    for (const li of data ?? []) {
      if (!li.shopify_product_id) continue;
      const arr = itemsByOrder.get(li.order_id) ?? [];
      arr.push({ productId: li.shopify_product_id, qty: Number(li.quantity) });
      itemsByOrder.set(li.order_id, arr);
    }
  }

  // Single-item orders → per-product (and global) daily cost samples.
  const perProduct = new Map<string, Map<string, number[]>>(); // product -> day -> costs
  const global = new Map<string, number[]>(); // day -> costs
  let matched = 0;
  for (const [num, row] of costs.byOrder) {
    const o = orderByNum.get(num);
    if (!o) continue;
    matched++;
    const items = itemsByOrder.get(o.id) ?? [];
    const totalQty = items.reduce((s, it) => s + it.qty, 0);
    if (items.length === 1 && totalQty === 1) {
      const pid = items[0].productId;
      let day = perProduct.get(pid);
      if (!day) {
        day = new Map<string, number[]>();
        perProduct.set(pid, day);
      }
      const arr = day.get(o.ymd) ?? [];
      arr.push(row.cost);
      day.set(o.ymd, arr);

      const g = global.get(o.ymd) ?? [];
      g.push(row.cost);
      global.set(o.ymd, g);
    }
  }

  // Global fallback timeline (applied to sold products with no single-item data).
  const globalModal = new Map<string, number>();
  for (const [day, cs] of global) globalModal.set(day, modal(cs));
  const globalTiers = toTiers(globalModal);

  // Build the rows to write (source='sheet').
  const rows: {
    user_id: string;
    shopify_product_id: string;
    cost: number;
    currency: string;
    effective_from: string;
    source: string;
  }[] = [];
  const soldProducts = new Set<string>();
  for (const items of itemsByOrder.values())
    for (const it of items) soldProducts.add(it.productId);

  for (const pid of soldProducts) {
    const dayMap = perProduct.get(pid);
    let tiers: { effective_from: string; cost: number }[];
    if (dayMap && dayMap.size > 0) {
      const dm = new Map<string, number>();
      for (const [day, cs] of dayMap) dm.set(day, modal(cs));
      tiers = toTiers(dm);
    } else {
      tiers = globalTiers; // combo-only product → use the global per-unit price
    }
    for (const t of tiers)
      rows.push({
        user_id: user.id,
        shopify_product_id: pid,
        cost: t.cost,
        currency: displayCurrency,
        effective_from: t.effective_from,
        source: "sheet",
      });
  }

  // Replace previous auto rows, keep the user's manual costs.
  await supabase
    .from("product_costs")
    .delete()
    .eq("user_id", user.id)
    .eq("source", "sheet");
  if (rows.length) {
    const { error } = await supabase
      .from("product_costs")
      .upsert(rows, { onConflict: "user_id,shopify_product_id,effective_from" });
    if (error) return { ok: false, error: error.message };
  }

  // Exact per-order costs (captures volume discounts / bundles like 2 pairs = 18).
  // The recompute uses these to override computed COGS for sheet orders. Scoped
  // to the sheet's store, and only for orders that actually exist there, so a
  // colliding order number in another store is never charged this cost.
  await supabase.from("order_supplier_costs").delete().eq("user_id", user.id);
  const oscRows = [...costs.byOrder.values()]
    .filter((r) => orderByNum.has(r.order))
    .map((r) => ({
      user_id: user.id,
      shopify_connection_id: sheetStoreId,
      order_number: r.order,
      cost: r.cost,
      currency: displayCurrency,
      paid: r.paid,
    }));
  for (let i = 0; i < oscRows.length; i += 500) {
    await supabase.from("order_supplier_costs").upsert(oscRows.slice(i, i + 500), {
      onConflict: "user_id,shopify_connection_id,order_number",
    });
  }

  // Recompute so profit/ROAS pick up the new costs.
  try {
    await recomputeDailyMetrics(supabase, user.id, lastNDays(120, tz));
  } catch {
    /* best-effort */
  }

  revalidatePath("/supplier");
  revalidatePath("/costs");
  revalidatePath("/dashboard");
  revalidatePath("/products");

  return {
    ok: true,
    productsUpdated: soldProducts.size,
    matchedOrders: matched,
    priceTiers: globalTiers.map((t) => ({ from: t.effective_from, cost: t.cost })),
    paidTotal: costs.paidTotal,
    unpaidTotal: costs.unpaidTotal,
  };
}

export interface SupplierData {
  url: string | null;
  currency: string;
  paidTotal: number;
  unpaidTotal: number;
  paidCount: number;
  unpaidCount: number;
  unpaidOrders: { order: string; cost: number }[];
}

/** Read-only summary for the Supplier page. */
export async function getSupplierData(): Promise<SupplierData | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("settings")
    .select("supplier_sheet_url, currency")
    .eq("user_id", user.id)
    .single();
  const url = settings?.supplier_sheet_url ?? null;
  const currency = settings?.currency ?? "EUR";
  if (!url) {
    return { url: null, currency, paidTotal: 0, unpaidTotal: 0, paidCount: 0, unpaidCount: 0, unpaidOrders: [] };
  }
  const costs = await fetchSupplierCosts(url);
  if (!costs) {
    return { url, currency, paidTotal: 0, unpaidTotal: 0, paidCount: 0, unpaidCount: 0, unpaidOrders: [] };
  }
  const unpaidOrders = [...costs.byOrder.values()]
    .filter((r) => !r.paid)
    .sort((a, b) => Number(b.order) - Number(a.order))
    .map((r) => ({ order: r.order, cost: r.cost }));
  return {
    url,
    currency,
    paidTotal: costs.paidTotal,
    unpaidTotal: costs.unpaidTotal,
    paidCount: costs.paidCount,
    unpaidCount: costs.unpaidCount,
    unpaidOrders,
  };
}
