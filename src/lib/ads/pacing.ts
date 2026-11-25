export type PacingTotal = { status: "ready" | "pending" | "empty"; spent: number; forecast: number; firstDayExtra: number; updatedAt: string | null };
export type PacingReport = { day: string; currency: string; timeZone: string; total: PacingTotal; full: PacingTotal; stores: Record<string, PacingTotal> };
export type PacingAccount = { storeId: string | null; spent: number; forecast: number | null; firstDayExtra: number; observedAt: string };

/** Amounts are already converted to display currency. Apply the same share to
 * both sides of the ratio. One missing account must never look like zero spend. */
export function sumPacing(accounts: PacingAccount[], percentages = new Map<string, number>(), storeId?: string): PacingTotal {
  const result: PacingTotal = { status: "empty", spent: 0, forecast: 0, firstDayExtra: 0, updatedAt: null };
  for (const account of accounts) {
    if (storeId && account.storeId !== storeId) continue;
    const share = storeId || !account.storeId ? 1 : Math.min(100, Math.max(0, percentages.get(account.storeId) ?? 100)) / 100;
    if (!share) continue;
    const valid = account.forecast != null && Number.isFinite(account.forecast) && account.forecast >= 0
      && Number.isFinite(account.spent) && account.spent >= 0;
    if (!valid) result.status = "pending";
    else {
      if (result.status === "empty") result.status = "ready";
      result.spent += account.spent * share;
      result.forecast += account.forecast! * share;
      result.firstDayExtra += account.firstDayExtra * share;
    }
    if (Number.isFinite(Date.parse(account.observedAt)) && (!result.updatedAt || account.observedAt < result.updatedAt)) result.updatedAt = account.observedAt;
  }
  for (const key of ["spent", "forecast", "firstDayExtra"] as const) result[key] = Math.round(result[key] * 100) / 100;
  return result;
}

/** Clamp only the fill. Keep the real spending amount when it exceeds forecast. */
export function pacingFraction(total: PacingTotal): number | null {
  if (total.status !== "ready" || total.forecast <= 0) return null;
  return Math.max(0, Math.min(1, total.spent / total.forecast));
}
