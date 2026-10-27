import "server-only";
import { ORDER_EVIDENCE_COLUMNS } from "@/lib/shopify/order-evidence";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser, selectAllIn } from "@/lib/supabase/paginate";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import { resolveFx } from "@/lib/fx";
import { fetchSupplierCosts, parseSheetRef, type SupplierCosts } from "./sheet";
import { buildSupplierPlan } from "./plan";
import { supplierConnection, supplierConnections, upsertSupplierConnection } from "./connection";

type DB = SupabaseClient<Database>;
type ProductCost = Tables<"product_costs">;
const ORDER_COLUMNS = `id,order_number,processed_at,shopify_connection_id,country,test,cancelled_at,financial_status,total_refunded,total_price,${ORDER_EVIDENCE_COLUMNS}`;
const inFlight = new Map<string, Promise<unknown>>();
export interface SupplierSyncResult {
  skipped?: boolean;
  changed?: boolean;
  refreshed?: boolean;
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
  return exclusive(userId, () => runSync(db, userId, options));
}

/** One supplier write per user at a time: a sync and a re-learn must not interleave. */
async function exclusive<T>(userId: string, run: () => Promise<T>): Promise<T> {
  const previous = inFlight.get(userId);
  if (previous) {
    await previous;
    return exclusive(userId, run);
  }
  const request = run();
  inFlight.set(userId, request);
  try { return await request; }
  finally { if (inFlight.get(userId) === request) inFlight.delete(userId); }
}

/** Re-learn a store's sheet prices from its saved invoices, without reading the
 * sheet. The EU fee inside those totals depends on the store setting, so changing
 * it must not leave learned prices that count the fee twice or drop it. */
export function relearnSupplierPrices(db: DB, userId: string, storeId: string): Promise<boolean> {
  return exclusive(userId, async () => {
    const [{ data: settings, error }, { data: store, error: storeError }, invoices] = await Promise.all([
      db.from("settings").select("*").eq("user_id", userId).single(),
      db.from("shopify_connections").select("reporting_base_currency,eu_order_fee_enabled")
        .eq("user_id", userId).eq("id", storeId).maybeSingle(),
      selectAllByUser<Tables<"order_supplier_costs">>(db, "order_supplier_costs", "*", userId,
        (q) => q.eq("shopify_connection_id", storeId)),
    ]);
    if (error) throw error;
    if (storeError) throw storeError;
    if (!store || !invoices.length) return false;
    // Like a sync, learn only from invoices in the sheet's latest currency.
    const latest = invoices.reduce((a, b) => (b.updated_at > a.updated_at ? b : a));
    const currency = latest.currency ?? settings.currency;
    const byOrder = new Map(invoices.filter((r) => r.currency === currency)
      .map((r) => [r.order_number, { order: r.order_number, cost: Number(r.cost), paid: r.paid }]));
    const [orders, existing] = await Promise.all([
      selectAllByUser<Tables<"orders">>(db, "orders", ORDER_COLUMNS, userId, (q) => q.eq("shopify_connection_id", storeId)),
      selectAllByUser<ProductCost>(db, "product_costs", "*", userId),
    ]);
    const items = await selectAllIn<Tables<"order_line_items">>(db, "order_line_items",
      "order_id,shopify_product_id,quantity,current_quantity", userId, "order_id", orders.map((o) => o.id));
    const plan = buildSupplierPlan({ byOrder, currency, errors: [], paidTotal: 0, unpaidTotal: 0, paidCount: 0, unpaidCount: 0,
      unpricedOrders: [] }, orders, items, storeId, settings.timezone, await euFeeRate(store, currency, settings));
    const { productUpdates, obsolete } = learnedPriceChanges(userId, currency, plan.productCosts, existing, items);
    await saveLearnedPrices(db, userId, productUpdates, obsolete);
    return productUpdates.length > 0 || obsolete.length > 0;
  });
}

/** EUR to the sheet currency for the EU fee inside its totals; 0 when disabled. */
async function euFeeRate(store: Pick<Tables<"shopify_connections">, "reporting_base_currency" | "eu_order_fee_enabled">,
  currency: string, settings: Tables<"settings">): Promise<number> {
  return store.eu_order_fee_enabled ? resolveFx("EUR", currency, {
    storeCurrency: store.reporting_base_currency ?? currency, displayCurrency: settings.currency,
    overrideCurrency: settings.fx_override_currency, override: settings.fx_rate_override, required: true,
  }) : 0;
}

const priceKey = (p: { shopify_product_id: string; effective_from: string }) => `${p.shopify_product_id}:${p.effective_from}`;

/** Sheet prices to save and to delete so this store's learned prices match the
 * plan. A manual price for the same product and day always wins. */
function learnedPriceChanges(userId: string, currency: string,
  planned: { shopify_product_id: string; effective_from: string; cost: number }[],
  existing: ProductCost[], items: { shopify_product_id: string | null }[]) {
  const manualKeys = new Set(existing.filter((p) => p.source !== "sheet").map(priceKey));
  const rows = planned.filter((p) => !manualKeys.has(priceKey(p)))
    .map((p) => ({ ...p, user_id: userId, currency, source: "sheet" }));
  const existingByKey = new Map(existing.map((r) => [priceKey(r), r]));
  const productUpdates = rows.filter((r) => {
    const old = existingByKey.get(priceKey(r));
    return !old || Number(old.cost) !== r.cost || old.currency !== r.currency;
  });
  const productIds = new Set(items.flatMap((li) => li.shopify_product_id ? [li.shopify_product_id] : []));
  const wantedKeys = new Set(rows.map(priceKey));
  const obsolete = existing.filter((p) => p.source === "sheet" && productIds.has(p.shopify_product_id) && !wantedKeys.has(priceKey(p)));
  return { rows, productUpdates, obsolete };
}

async function saveLearnedPrices(db: DB, userId: string,
  updates: ReturnType<typeof learnedPriceChanges>["productUpdates"], obsolete: ProductCost[]) {
  for (let i = 0; i < updates.length; i += 500) {
    const { error } = await db.from("product_costs").upsert(updates.slice(i, i + 500), { onConflict: "user_id,shopify_product_id,effective_from" });
    if (error) throw error;
  }
  for (const p of obsolete) {
    const { error } = await db.from("product_costs").delete().eq("user_id", userId)
      .eq("shopify_product_id", p.shopify_product_id).eq("effective_from", p.effective_from).eq("source", "sheet");
    if (error) throw error;
  }
}

async function runSync(db: DB, userId: string, options: {
  storeId?: string; url?: string; automatic?: boolean; costs?: SupplierCosts; refresh?: boolean;
}): Promise<SupplierSyncResult> {
  const { data: settings, error } = await db.from("settings").select("*").eq("user_id", userId).single();
  if (error) throw error;
  const saved = supplierConnection(settings.supplier_sheet_url, options.storeId);
  const legacy = supplierConnection(settings.supplier_sheet_url);
  const connection = options.url ? supplierConnection(options.url) : saved ??
    (!options.automatic && !legacy?.storeId ? legacy : null);
  if (!connection) {
    if (options.automatic) return { skipped: true };
    throw new Error("Falta um link válido da sheet.");
  }
  if (options.automatic && (!saved?.storeId || (options.storeId && saved.storeId !== options.storeId)))
    return { skipped: true };
  const storeId = options.storeId ?? saved?.storeId;
  if (!storeId) throw new Error("Seleciona a loja a que pertence este separador da sheet.");
  const { data: store, error: storeError } = await db.from("shopify_connections")
    .select("id,reporting_base_currency,eu_order_fee_enabled").eq("user_id", userId).eq("id", storeId).maybeSingle();
  if (storeError) throw storeError;
  if (!store) throw new Error("A loja selecionada não está disponível nesta conta.");

  const [costs, orders, existingProductCosts, existingExact] = await Promise.all([
    options.costs ?? fetchSupplierCosts(connection.url),
    selectAllByUser<Tables<"orders">>(db, "orders", ORDER_COLUMNS, userId,
      (q) => q.eq("shopify_connection_id", storeId)),
    selectAllByUser<ProductCost>(db, "product_costs", "*", userId),
    selectAllByUser<Tables<"order_supplier_costs">>(db, "order_supplier_costs", "*", userId,
      (q) => q.eq("shopify_connection_id", storeId)),
  ]);
  if (!costs) throw new Error("Não consegui ler a sheet. Os custos anteriores foram mantidos.");
  const ref = parseSheetRef(connection.url)!;
  const sourceRef = `${ref.id}:${ref.gid}`;
  // A matching order number cannot identify a store. Never silently move a tab
  // to another store, or combine an old tab's invoices with a replacement tab.
  const assigned = supplierConnections(settings.supplier_sheet_url)
    .find((c) => c.url === connection.url && c.storeId && c.storeId !== storeId);
  if (assigned) throw new Error("Este separador já está associado a outra loja. Confirma o separador do fornecedor.");
  if (existingExact.length && ((!saved?.storeId || saved.url !== connection.url) ||
    existingExact.some((r) => r.source_ref && r.source_ref !== sourceRef))) {
    throw new Error("Esta loja tem custos de outro separador ou sem origem confirmada. É necessário rever esse histórico antes de trocar a ligação; os custos foram mantidos.");
  }
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
  // Sheet totals of eligible EU orders include the fee; learn prices without it.
  const plan = buildSupplierPlan({ ...costs, byOrder: remembered }, orders, items, storeId, settings.timezone,
    await euFeeRate(store, currency, settings));
  const { rows, productUpdates, obsolete } = learnedPriceChanges(userId, currency, plan.productCosts, existingProductCosts, items);
  const exact = plan.exact.map((r) => ({ user_id: userId, shopify_connection_id: storeId,
    order_number: r.order, cost: r.cost, currency, paid: r.paid,
    source_ref: costs.byOrder.has(r.order) ? sourceRef : savedByNumber.get(r.order)?.source_ref ?? null }));
  const existingByNumber = new Map(existingExact.map((r) => [r.order_number, r]));
  const exactUpdates = exact.filter((r) => {
    const old = existingByNumber.get(r.order_number);
    return !old || Number(old.cost) !== r.cost || old.currency !== r.currency || old.paid !== r.paid || (old.source_ref ?? null) !== r.source_ref;
  });
  // A missing/blank sheet row is not proof that an incurred supplier expense
  // disappeared. Retain the last confirmed exact cost until explicitly replaced.
  // Adding provenance to an unchanged historical invoice does not change any
  // financial amount. Avoid a full history recalculation just to stamp origin.
  const changed = exactUpdates.some((r) => {
    const old = existingByNumber.get(r.order_number);
    return !old || Number(old.cost) !== r.cost || old.currency !== r.currency || old.paid !== r.paid;
  }) || productUpdates.length > 0 || obsolete.length > 0 || invalidExact.length > 0;
  const mustRefresh = changed || !!saved?.pendingRefresh || !options.automatic;
  async function saveBinding(pending: boolean) {
    // Refresh the settings before merging: another store may have synced since
    // this request started. Compare-and-swap prevents losing that association.
    for (let attempt = 0; attempt < 3; attempt++) {
      const { data: latest, error: readError } = await db.from("settings").select("supplier_sheet_url").eq("user_id", userId).single();
      if (readError) throw readError;
      const value = upsertSupplierConnection(latest.supplier_sheet_url, connection!.url, storeId!, pending);
      let query = db.from("settings").update({ supplier_sheet_url: value }).eq("user_id", userId);
      query = latest.supplier_sheet_url == null ? query.is("supplier_sheet_url", null) : query.eq("supplier_sheet_url", latest.supplier_sheet_url);
      const { data: changed, error } = await query.select("user_id");
      if (error) throw error;
      if (changed?.length) return;
    }
    throw new Error("As ligações foram alteradas durante a sincronização. Tenta novamente.");
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
  await saveLearnedPrices(db, userId, productUpdates, obsolete);
  if (mustRefresh && options.refresh !== false) {
    await refreshCostDependents(db, userId, { storeId });
    await saveBinding(false);
  }
  return { changed, refreshed: mustRefresh && options.refresh !== false, productsUpdated: new Set(rows.map((r) => r.shopify_product_id)).size,
    matchedOrders: plan.exact.filter((r) => costs.byOrder.has(r.order)).length, paidTotal: costs.paidTotal, unpaidTotal: costs.unpaidTotal,
    unknownOrders: plan.unknownOrders.length };
}
