import "server-only";
import type { Tables } from "@/types/database";
import { resolveFx } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import { participationSchema } from "@/lib/dashboard/store-participation";
import { supplierConnections } from "./connection";
import { fetchSupplierCosts, type SupplierCosts } from "./sheet";

export type PayableStore = Pick<Tables<"shopify_connections">, "id" | "shop_name" | "shop_domain">;
export interface PayablesOptions {
  stores: PayableStore[];
  storeId?: string;
  percentages: Map<string, number>;
  currency: string;
  sheetUrl?: string | null;
  fxOverride?: number | null;
  fxOverrideCurrency?: string | null;
}
export type SupplierPayables =
  | { status: "unassigned" | "not_connected" }
  | { status: "ready"; amount: number; ordersCount: number; unpricedCount: number; storeName: string };

/** Read the sheet's CURRENT unpaid rows. Historical cost rows are retained for
 * COGS even after a supplier clears a tab, so they cannot prove current debt. */
export async function getSupplierPayables(options: PayablesOptions): Promise<SupplierPayables> {
  const connections = supplierConnections(options.sheetUrl);
  if (!connections.length) return { status: "not_connected" };
  const owned = connections.flatMap((connection) => {
    const store = options.stores.find((s) => s.id === connection.storeId);
    return store ? [{ connection, store }] : [];
  });
  if (!owned.length) return { status: "unassigned" };
  const selected = owned.filter(({ store }) => !options.storeId || options.storeId === store.id);
  if (!selected.length) return { status: "not_connected" };
  const results = await Promise.all(selected.map(async ({ connection, store }) => {
    const costs = await fetchSupplierCosts(connection.url);
    if (!costs || costs.errors.length) throw new Error("Não foi possível ler os valores por pagar na sheet.");
    const rate = await resolveFx(costs.currency ?? options.currency, options.currency, {
      displayCurrency: options.currency, override: options.fxOverride,
      overrideCurrency: options.fxOverrideCurrency, required: true,
    });
    return { ...summarizeSupplierPayables(costs, rate,
      options.storeId ? 100 : options.percentages.get(store.id) ?? 100, false),
      storeName: store.shop_name || store.shop_domain };
  }));
  return { status: "ready", amount: round2(results.reduce((total, r) => total + r.amount, 0)),
    ordersCount: results.reduce((total, r) => total + r.ordersCount, 0),
    unpricedCount: results.reduce((total, r) => total + r.unpricedCount, 0),
    storeName: results.map((r) => r.storeName).join(", ") };
}

export function summarizeSupplierPayables(costs: SupplierCosts, rate: number, percentage: number, round = true) {
  if (costs.errors.length || !Number.isFinite(rate) || rate <= 0) throw new Error("Valores do fornecedor inválidos.");
  const parsed = participationSchema.safeParse(percentage);
  const share = (parsed.success ? parsed.data : 100) / 100;
  let total = 0, ordersCount = 0;
  for (const row of costs.byOrder.values()) {
    if (row.paid || share === 0) continue;
    if (!Number.isFinite(row.cost) || row.cost < 0) throw new Error("Custo do fornecedor inválido.");
    total += row.cost;
    ordersCount++;
  }
  return { amount: round ? round2(total * rate * share) : total * rate * share, ordersCount,
    unpricedCount: share === 0 ? 0 : costs.unpricedOrders.length };
}
