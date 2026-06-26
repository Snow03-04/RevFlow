"use server";

import { saveProductCost, recomputeAllMetricsAction } from "@/lib/cogs/actions";

export interface AssistantActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Apply a product-cost change proposed by the assistant — only ever called from
 * the client after the user clicks "Confirmar". Saves the cost and recomputes
 * metrics so the dashboard/P&L reflect it.
 */
export async function applyProductCostAction(
  productId: string,
  cost: number,
): Promise<AssistantActionResult> {
  if (!productId || !Number.isFinite(cost) || cost < 0) {
    return { ok: false, error: "Dados inválidos." };
  }
  const saved = await saveProductCost(productId, cost);
  if (!saved.ok) return { ok: false, error: saved.error };
  await recomputeAllMetricsAction();
  return { ok: true };
}
