export const GOOGLE_INCENTIVE_QUERY = `SELECT applied_incentive.resource_name,
  applied_incentive.incentive_state, applied_incentive.reward_grant_date_time,
  applied_incentive.reward_expiration_date_time, applied_incentive.currency_code,
  applied_incentive.granted_amount_micros, applied_incentive.reward_balance_remaining_micros
  FROM applied_incentive`;

/** Portable: injected into Ads Scripts without server imports.
 * An unused granted balance proves that eligible advertising is still funded.
 * Do not consume it against served cost: billing can also include overdelivery
 * and invalid-click adjustments, so that would exhaust the credit too early.
 * Google does not supply daily credit allocations here. If the balance is
 * exhausted or a cost day crosses a grant/expiry boundary, require billing
 * reconciliation instead of replacing verified net expenses with guesses.
 */
export function applyGooglePromotions(costs: Record<string, number>, rows: any[], currency: string, now: string) {
  const paid = { ...costs };
  const promotions: { id: string; grantedAt: string; expiresAt: string; amount: number; remaining: number }[] = [];
  const seen = new Set<string>();
  for (const row of rows) {
    const p = row.appliedIncentive;
    if (!p) throw new Error("Resposta de créditos Google inválida. Despesas não atualizadas.");
    // Unfulfilled offers do not yet pay for advertising.
    if (!p.rewardGrantDateTime && Number(p.grantedAmountMicros || 0) === 0
      && p.incentiveState && !["UNKNOWN", "UNSPECIFIED"].includes(p.incentiveState)) continue;
    const grantedAt = String(p.rewardGrantDateTime || "").replace("T", " ").slice(0, 19);
    const expiresAt = String(p.rewardExpirationDateTime || "").replace("T", " ").slice(0, 19);
    const amount = Number(p.grantedAmountMicros) / 1e6;
    const remaining = Number(p.rewardBalanceRemainingMicros) / 1e6;
    if (!p.resourceName || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(grantedAt)
      || !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(expiresAt)
      || expiresAt <= grantedAt || !Number.isFinite(amount) || amount <= 0
      || p.rewardBalanceRemainingMicros == null || !Number.isFinite(remaining) || remaining < 0 || remaining > amount
      || p.currencyCode !== currency) throw new Error("Não foi possível confirmar o crédito Google. Despesas não atualizadas.");
    if (seen.has(p.resourceName)) continue;
    seen.add(p.resourceName);
    promotions.push({ id: p.resourceName, grantedAt, expiresAt, amount, remaining });
  }
  for (const date of Object.keys(costs)) {
    if (!Number.isFinite(costs[date]) || costs[date] < 0) throw new Error("Custo Google inválido.");
    if (!costs[date]) continue;
    const from = `${date} 00:00:00`;
    const until = date === now.slice(0, 10) ? now : `${date} 23:59:59`;
    const applicable = promotions.filter((p) => p.grantedAt <= until && p.expiresAt > from);
    if (!applicable.length) continue;
    if (applicable.some((p) => p.remaining > 0 && p.grantedAt <= from && p.expiresAt > until)) {
      paid[date] = 0;
    } else {
      throw new Error(`Crédito Google esgotado ou aplicado apenas em parte do dia ${date}. Confirmar o custo líquido desse dia na Faturação antes de atualizar despesas. ROAS deve continuar a usar o gasto bruto.`);
    }
  }
  return { paid, promotions };
}

export const GOOGLE_PROMOTION_READER = `var applyGooglePromotions = ${applyGooglePromotions.toString()};`;
