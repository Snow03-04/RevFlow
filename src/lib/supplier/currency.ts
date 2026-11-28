import "server-only";
import { resolveFx, type FxContext } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import type { SupplierCosts, SupplierRow } from "./sheet";

export function supplierRowCurrency(row: SupplierRow, costs: SupplierCosts, fallback: string): string {
  return row.currency ?? costs.currency ?? fallback;
}

/** Resolve every source currency before aggregating; unavailable FX is an error. */
export async function supplierRates(costs: SupplierCosts, target: string, context: FxContext = {}) {
  if (costs.errors.length) throw new Error(costs.errors.join(" "));
  const currencies = new Set([...costs.byOrder.values()].map(row => supplierRowCurrency(row, costs, target)));
  return new Map(await Promise.all([...currencies].map(async currency =>
    [currency, await resolveFx(currency, target, { ...context, required: true })] as const)));
}

export function supplierRowRate(row: SupplierRow, costs: SupplierCosts, target: string, rates: Map<string, number>) {
  const rate = rates.get(supplierRowCurrency(row, costs, target));
  if (rate == null || !Number.isFinite(rate) || rate <= 0) throw new Error("Câmbio do fornecedor indisponível.");
  return rate;
}

export function supplierTotals(costs: SupplierCosts, target: string, rates: Map<string, number>) {
  let paidTotal = 0, unpaidTotal = 0;
  for (const row of costs.byOrder.values()) {
    const value = row.cost * supplierRowRate(row, costs, target, rates);
    if (row.paid) paidTotal += value;
    else unpaidTotal += value;
  }
  return { paidTotal: round2(paidTotal), unpaidTotal: round2(unpaidTotal) };
}
