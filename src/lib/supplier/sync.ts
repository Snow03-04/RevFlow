import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import { fetchSupplierCosts, type SupplierCosts } from "./sheet";
import { buildSupplierPlan } from "./plan";
import { supplierConnection, supplierConnectionUrl } from "./connection";

type DB = SupabaseClient<Database>;
const inFlight = new Map<string, Promise<SupplierSyncResult>>();
export interface SupplierSyncResult {
  skipped?: boolean;
  changed?: boolean;
  productsUpdated?: number;
  matchedOrders?: number;
  paidTotal?: number;
  unpaidTotal?: number;
  unknownOrders?: number;
}

/** The same operation backs Apply, routine Shopify refreshes and scheduled sync.
 * Automatic sync requires a saved explicit binding; legacy links stay read-only
 * until Apply confirms the store, even if order numbers happen to overlap. */
export async function syncSupplierCosts(
  db: DB, userId: string,
  options: { storeId?: string; url?: string; automatic?: boolean; costs?: SupplierCosts; refresh?: boolean } = {},
): Promise<SupplierSyncResult> {
  const previous = inFlight.get(userId);
  if (previous) {
    await previous;
    return syncSupplierCosts(db, userId, options);
  }
  const request = runSync(db, userId, options);
  inFlight.set(userId, request);
  try { return await request; }
  finally { if (inFlight.get(userId) === request) inFlight.delete(userId); }
}

async function runSync(db: DB, userId: string, options: {
  storeId?: string; url?: string; automatic?: boolean; costs?: SupplierCosts; refresh?: boolean;
}): Promise<SupplierSyncResult> {
  const { data: settings, error } = await db.from("settings").select("*").eq("user_id", userId).single();
  if (error) throw error;
  const saved = supplierConnection(settings.supplier_sheet_url);
  const connection = supplierConnection(options.url ?? settings.supplier_sheet_url);
  if (!connection) {
    if (options.automatic) return { skipped: true };
    throw new Error("Falta um link válido da sheet.");
  }
  if (options.automatic && (!saved?.storeId || (options.storeId && saved.storeId !== options.storeId)))
    return { skipped: true };
  const storeId = options.storeId ?? saved?.storeId;
  if (!storeId) throw new Error("Seleciona a loja a que pertence este separador da sheet.");
  const { data: store, error: storeError } = await db.from("shopify_connections")
    .select("id").eq("user_id", userId).eq("id", storeId).maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw new Error("A loja selecionada não está disponível nesta conta.");

  const [costs, orders, existingProductCosts, existingExact] = await Promise.all([
    options.costs ?? fetchSupplierCosts(connection.url),
    selectAllByUser<Tables<"orders">>(db, "orders", "id,order_number,processed_at,shopify_connection_id,test,cancelled_at,financial_status,total_refunded,raw,total_price", userId,
      (q) => q.eq("shopify_connection_id", storeId)),
    selectAllByUser<Tables<"product_costs">>(db, "product_costs", "*", userId),
    selectAllByUser<Tables<"order_supplier_costs">>(db, "order_supplier_costs", "*", userId,
      (q) => q.eq("shopify_connection_id", storeId)),
  ]);
  if (!costs) throw new Error("Não consegui ler a sheet. Os custos anteriores foram mantidos.");
  const items = await selectAllIn<Tables<"order_line_items">>(db, "order_line_items",
    "order_id,shopify_product_id,quantity,current_quantity", userId, "order_id", orders.map((o) => o.id));
  const currency = costs.currency ?? settings.currency;
  const summaryByOrder = new Map((costs.summaryRows ?? [])
    .flatMap((row) => row.order ? [[row.order, row] as const] : []));
  // Repair totals previously imported as individual invoices. Only remove the
  // exact misclassified amount; an older genuine quote for that order survives.
  const savedByNumber = new Map(existingExact.map((row) => [row.order_number, row]));
  const invalidExact = existingExact.filter((row) => {
    const summary = summaryByOrder.get(row.order_number);
    if (!summary || row.currency !== currency) return false;
    if (summary.cost === Number(row.cost)) return true;
    // The supplier may revise the batch before this installation is repaired.
    const components = (summary.componentOrders ?? []).map((number) => savedByNumber.get(number));
    if (components.length < 5 || components.some((r) => !r || r.currency !== currency)) return false;
    const cents = components.map((r) => Math.round(Number(r!.cost) * 100));
    const savedCost = Math.round(Number(row.cost) * 100);
    return savedCost === cents.reduce((sum, n) => sum + n, 0) && savedCost > 3 * Math.max(...cents);
  });
  const invalidNumbers = new Set(invalidExact.map((row) => row.order_number));
  // Preserve learned prices as well as invoices when a supplier clears/moves
  // old rows. Only an explicit replacement may revise a confirmed amount.
  const remembered = new Map(existingExact.filter((r) => r.currency === currency && !invalidNumbers.has(r.order_number))
    .map((r) => [r.order_number, { order: r.order_number, cost: Number(r.cost), paid: r.paid }]));
  for (const [number, row] of costs.byOrder) remembered.set(number, row);
  // Validate the current sheet independently; remembered rows must not hide an
  // empty or invalid response from Google.
  if (costs.errors.length) throw new Error(costs.errors.join(" "));
  if (!costs.byOrder.size) throw new Error("A sheet não tem encomendas com custo. Os custos anteriores foram mantidos.");
  const plan = buildSupplierPlan({ ...costs, byOrder: remembered }, orders, items, storeId, settings.timezone);
  const key = (p: { shopify_product_id: string; effective_from: string }) => `${p.shopify_product_id}:${p.effective_from}`;
  const manualKeys = new Set(existingProductCosts.filter((p) => p.source !== "sheet").map(key));
  const rows = plan.productCosts.filter((p) => !manualKeys.has(key(p)))
    .map((p) => ({ ...p, user_id: userId, currency, source: "sheet" }));
  const exact = plan.exact.map((r) => ({ user_id: userId, shopify_connection_id: storeId,
    order_number: r.order, cost: r.cost, currency, paid: r.paid }));
  const existingByNumber = new Map(existingExact.map((r) => [r.order_number, r]));
  const existingByProduct = new Map(existingProductCosts.map((r) => [key(r), r]));
  const exactUpdates = exact.filter((r) => {
    const old = existingByNumber.get(r.order_number);
    return !old || Number(old.cost) !== r.cost || old.currency !== r.currency || old.paid !== r.paid;
  });
  const productUpdates = rows.filter((r) => {
    const old = existingByProduct.get(key(r));
    return !old || Number(old.cost) !== r.cost || old.currency !== r.currency;
  });
  const productIds = new Set(items.flatMap((li) => li.shopify_product_id ? [li.shopify_product_id] : []));
  const wantedKeys = new Set(rows.map(key));
  const obsolete = existingProductCosts.filter((p) => p.source === "sheet" && productIds.has(p.shopify_product_id) && !wantedKeys.has(key(p)));
  // A missing/blank sheet row is not proof that an incurred supplier expense
  // disappeared. Retain the last confirmed exact cost until explicitly replaced.
  const changed = exactUpdates.length > 0 || productUpdates.length > 0 || obsolete.length > 0 || invalidExact.length > 0;
  const mustRefresh = changed || !!saved?.pendingRefresh || !options.automatic;
  async function saveBinding(pending: boolean) {
    const { error } = await db.from("settings").update({ supplier_sheet_url: supplierConnectionUrl(connection!.url, storeId!, pending) }).eq("user_id", userId);
    if (error) throw error;
  }
  if (mustRefresh) await saveBinding(true);
  for (const row of invalidExact) {
    const { error } = await db.from("order_supplier_costs").delete()
      .eq("user_id", userId).eq("shopify_connection_id", storeId)
      .eq("order_number", row.order_number).eq("cost", row.cost).eq("currency", row.currency!);
    if (error) throw error;
  }
  for (let i = 0; i < exactUpdates.length; i += 500) {
    const { error } = await db.from("order_supplier_costs").upsert(exactUpdates.slice(i, i + 500), { onConflict: "user_id,shopify_connection_id,order_number" });
    if (error) throw error;
  }
  for (let i = 0; i < productUpdates.length; i += 500) {
    const { error } = await db.from("product_costs").upsert(productUpdates.slice(i, i + 500), { onConflict: "user_id,shopify_product_id,effective_from" });
    if (error) throw error;
  }
  for (const p of obsolete) {
    const { error } = await db.from("product_costs").delete().eq("user_id", userId)
      .eq("shopify_product_id", p.shopify_product_id).eq("effective_from", p.effective_from).eq("source", "sheet");
    if (error) throw error;
  }
  if (mustRefresh && options.refresh !== false) {
    await refreshCostDependents(db, userId, { storeId });
    await saveBinding(false);
  }
  return { changed, productsUpdated: new Set(rows.map((r) => r.shopify_product_id)).size,
    matchedOrders: plan.exact.filter((r) => costs.byOrder.has(r.order)).length, paidTotal: costs.paidTotal, unpaidTotal: costs.unpaidTotal,
    unknownOrders: plan.unknownOrders.length };
}
