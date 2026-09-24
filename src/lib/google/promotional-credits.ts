export const GOOGLE_INCENTIVE_QUERY = `SELECT applied_incentive.resource_name,
  applied_incentive.incentive_state, applied_incentive.reward_grant_date_time,
  applied_incentive.reward_expiration_date_time, applied_incentive.currency_code,
  applied_incentive.granted_amount_micros, applied_incentive.reward_balance_remaining_micros
  FROM applied_incentive`;

export interface GooglePromotionReconciliation {
  promotionId: string;
  currency: string;
  /** Account-local date confirmed in Billing, not inferred from served cost. */
  exhaustedOn: string;
  /** Unused promotion at the start of exhaustedOn, after billed adjustments. */
  creditAtStartOfDay: number;
  /** Confirmed non-promotional billing credits; never taxes or card payments. */
  adjustments?: Record<string, number>;
}

/** Portable: injected into Ads Scripts without server imports.
 * An unused granted balance proves that eligible advertising is still funded.
 * Do not consume it against served cost: billing can also include overdelivery
 * and invalid-click adjustments, so that would exhaust the credit too early.
 * Google does not supply daily credit allocations here. If the balance is
 * exhausted or a cost day crosses a grant/expiry boundary, require billing
 * reconciliation instead of replacing verified net expenses with guesses.
 */
export function applyGooglePromotions(costs: Record<string, number>, rows: any[], currency: string, now: string,
  reconciliations: GooglePromotionReconciliation[] = [], allowPartial = false) {
  const paid = { ...costs };
  const pending: string[] = [];
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
  const settlements = new Map<string, GooglePromotionReconciliation>();
  for (const r of reconciliations) {
    const p = promotions.find((p) => p.id === r.promotionId);
    if (!p || settlements.has(r.promotionId) || r.currency !== currency
      || !/^\d{4}-\d{2}-\d{2}$/.test(r.exhaustedOn)
      || new Date(r.exhaustedOn + "T00:00:00Z").toISOString().slice(0, 10) !== r.exhaustedOn
      || r.exhaustedOn < p.grantedAt.slice(0, 10) || r.exhaustedOn > p.expiresAt.slice(0, 10)
      || r.exhaustedOn > now.slice(0, 10) || p.remaining !== 0
      || !Number.isFinite(r.creditAtStartOfDay) || r.creditAtStartOfDay < 0 || r.creditAtStartOfDay > p.amount
      || Object.entries(r.adjustments ?? {}).some(([day, amount]) => !/^\d{4}-\d{2}-\d{2}$/.test(day)
        || day < r.exhaustedOn || day > now.slice(0, 10) || !Number.isFinite(amount) || amount < 0)) {
      throw new Error("Reconciliação Google inválida ou crédito alterado. Confirmar na Faturação antes de atualizar despesas.");
    }
    settlements.set(r.promotionId, r);
  }
  costDays: for (const date of Object.keys(costs)) {
    if (!Number.isFinite(costs[date]) || costs[date] < 0) throw new Error("Custo Google inválido.");
    if (!costs[date]) continue;
    const from = `${date} 00:00:00`;
    const until = date === now.slice(0, 10) ? now : `${date} 23:59:59`;
    const applicable = promotions.filter((p) => p.grantedAt <= until && p.expiresAt > from);
    if (!applicable.length) continue;
    if (applicable.some((p) => (p.remaining > 0 || (settlements.has(p.id) && date < settlements.get(p.id)!.exhaustedOn))
      && p.grantedAt <= from && p.expiresAt > until)) {
      paid[date] = 0;
    } else {
      let deductions = 0;
      for (const p of applicable) {
        const settled = settlements.get(p.id);
        if (!settled || date < settled.exhaustedOn) {
          if (allowPartial) {
            // Keep the unknown day out of the paid payload, but do not prevent
            // independent days (before/after this promotion) from importing.
            pending.push(date);
            delete paid[date];
            continue costDays;
          }
          throw new Error(`Crédito Google esgotado ou aplicado apenas em parte do dia ${date}. Confirmar o custo líquido desse dia na Faturação antes de atualizar despesas. ROAS deve continuar a usar o gasto bruto.`);
        }
        // The reconciled allowance stays fixed as today's cost grows. Tomorrow
        // starts with no remaining credit. Re-imports never consume it twice.
        deductions += date === settled.exhaustedOn ? settled.creditAtStartOfDay : 0;
        deductions += settled.adjustments?.[date] ?? 0;
      }
      paid[date] = Math.max(0, costs[date] - deductions);
    }
  }
  return { paid, promotions, pending };
}

export const GOOGLE_PROMOTION_READER = `var applyGooglePromotions = ${applyGooglePromotions.toString()};`;
