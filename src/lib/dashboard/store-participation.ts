import { z } from "zod";

/** Private display preference only; never used to grant access to a store. */
export const participationSchema = z.number().finite().min(0).max(100)
  .refine((value) => Math.abs(value * 100 - Math.round(value * 100)) < 1e-8,
    "Usa no máximo duas casas decimais.");

export function participationKey(storeId: string) {
  return `dashboard_participation_${storeId}`;
}

export const personalRevenueKey = "dashboard_personal_revenue";

export function usesPersonalRevenue(metadata: Record<string, unknown>): boolean {
  return metadata[personalRevenueKey] === true;
}

export function readParticipation(metadata: Record<string, unknown>, storeId: string): number {
  const parsed = participationSchema.safeParse(metadata[participationKey(storeId)]);
  return parsed.success ? parsed.data : 100;
}

export function adSpendParticipationKey(storeId: string) {
  return `dashboard_adspend_participation_${storeId}`;
}

export function expenseParticipationKey(storeId: string) {
  return `dashboard_expense_participation_${storeId}`;
}

/** Missing expense overrides inherit profit; missing ad overrides inherit expenses. */
export function readParticipationOverride(metadata: Record<string, unknown>, key: string): number | null {
  const parsed = participationSchema.safeParse(metadata[key]);
  return parsed.success ? parsed.data : null;
}

export type ParticipationStore = {
  id: string; name: string; percentage: number; expenseOverride: number | null; adSpendOverride: number | null;
};

/** Multiply after FX, before aggregation; selecting one store always shows 100%. */
export function participationRates(
  rates: Map<string, number>, percentages: Map<string, number>, storeId?: string,
): Map<string, number> {
  if (storeId) return rates;
  const adjusted = new Map(rates);
  for (const [id, percentage] of percentages) {
    const parsed = participationSchema.safeParse(percentage);
    adjusted.set(id, (rates.get(id) ?? 1) * (parsed.success ? parsed.data / 100 : 1));
  }
  return adjusted;
}
