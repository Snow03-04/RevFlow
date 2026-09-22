import type { DateRange } from "@/types";
import type { TrackerOrderSales } from "./sales";
import type { PnlFees } from "./pnl";

export type ScaleLevel = "review" | "scale" | "ready" | "kill" | null;
export type ScaleMetric = { roas: number | null; level: ScaleLevel };
export type GoogleScaleSignal = {
  range: DateRange | null; coverage: number; expectedDays: number; grossSpend: number | null;
  google: ScaleMetric; shopify: ScaleMetric; breakEven: number | null;
  shopifyRevenue: number | null; googleRevenue: number; googleConversions: number | null; costPerConversion: number | null;
  scope: string | null; shared: boolean; reason: string | null;
};

export function lastFiveCompleteDays(today: string): DateRange {
  const shift = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { from: shift(-5), to: shift(-1) };
}

/** Daily imports cannot separate performance before and after an edit on the same day. */
export function googleRangeSinceChange(lastChangedAt: string | null | undefined, to: string): DateRange | null {
  if (!lastChangedAt) return null;
  const from = new Date(Date.parse(`${lastChangedAt.slice(0, 10)}T12:00:00Z`) + 86400000).toISOString().slice(0, 10);
  return from <= to ? { from, to } : null;
}

/** Weight each campaign by its own spend since its latest change. */
export function summariseGoogleSignalRoas(signals: (GoogleScaleSignal | undefined)[]): number | null {
  if (!signals.length || signals.some((s) => !s?.range || s.coverage !== s.expectedDays || s.grossSpend == null)) return null;
  const spend = signals.reduce((sum, s) => sum + s!.grossSpend!, 0);
  return spend > 0 ? signals.reduce((sum, s) => sum + s!.googleRevenue, 0) / spend : null;
}

export function scaleLevel(roas: number | null, breakEven: number | null, eligible = true, killEligible = false): ScaleLevel {
  if (!eligible || roas == null || breakEven == null || !Number.isFinite(roas) || !Number.isFinite(breakEven)) return null;
  if (roas < breakEven) return killEligible ? "kill" : null;
  if (roas === breakEven) return null;
  return roas > 3 ? "ready" : roas > 2 ? "scale" : "review";
}

/** Full product revenue is a scope comparison, never added to attributed P&L totals. */
export function calculateGoogleScale(opts: {
  range: DateRange; status?: string | null; storeId: string | null; rate: number;
  lastChangedAt?: string | null;
  facts: { date: string; grossSpend: number | null; conversionValue: number; conversions: number }[];
  orders: TrackerOrderSales[]; productIds: string[] | null; scope: string | null; shared: boolean;
  fees: (date: string) => PnlFees;
}): GoogleScaleSignal {
  const range = googleRangeSinceChange(opts.lastChangedAt, opts.range.to);
  const expectedDays = range ? Math.round((Date.parse(range.to) - Date.parse(range.from)) / 86400000) + 1 : 0;
  const facts = range ? opts.facts.filter((f) => f.date >= range.from && f.date <= range.to) : [];
  const coverage = new Set(facts.map((f) => f.date)).size;
  const grossSpend = facts.length && facts.every((f) => f.grossSpend != null) ? facts.reduce((s, f) => s + f.grossSpend!, 0) : null;
  const googleRevenue = facts.reduce((s, f) => s + f.conversionValue, 0);
  const conversions = facts.reduce((s, f) => s + f.conversions, 0);
  const products = new Set(opts.productIds ?? []);
  let net = 0, costs = 0, payments = 0;
  for (const order of opts.orders) {
    if (!range || !opts.storeId || order.storeId !== opts.storeId || order.date < range.from || order.date > range.to) continue;
    const totalWeight = order.items.reduce((s, i) => s + i.weight, 0);
    const totalUnits = order.items.reduce((s, i) => s + i.units, 0);
    const matching = order.items.filter((i) => i.productId && products.has(i.productId));
    if (!matching.length) continue;
    const fraction = totalWeight > 0 ? matching.reduce((s, i) => s + i.weight, 0) / totalWeight
      : totalUnits > 0 ? matching.reduce((s, i) => s + i.units, 0) / totalUnits : matching.length / order.items.length;
    const revenue = (order.grossRevenue - order.refunds) * fraction * opts.rate;
    const fees = opts.fees(order.date);
    net += revenue;
    costs += matching.reduce((s, i) => s + i.cost, 0) * opts.rate;
    payments += order.grossRevenue * fraction * opts.rate * fees.paymentPct + fraction * fees.txFee;
  }
  const contribution = net - costs - payments;
  const agencyRate = grossSpend && grossSpend > 0
    ? facts.reduce((s, f) => s + (f.grossSpend ?? 0) * opts.fees(f.date).feeGoogle, 0) / grossSpend : 0;
  // Break-even is before promotional credits, so a temporary credit cannot trigger scale.
  const breakEven = opts.productIds != null && net > 0 && contribution > 0 ? net * (1 + agencyRate) / contribution : null;
  const complete = expectedDays > 0 && coverage === expectedDays;
  const costPerConversion = complete && grossSpend != null && conversions > 0 ? grossSpend / conversions : null;
  const googleRoas = complete && grossSpend && grossSpend > 0 ? googleRevenue / grossSpend : null;
  const shopifyRoas = complete && opts.productIds != null && grossSpend && grossSpend > 0 ? net / grossSpend : null;
  const eligible = complete && expectedDays >= 5 && opts.status?.toUpperCase() === "ENABLED";
  const reason = !opts.lastChangedAt ? "Sem alteração importada para calcular o ROAS"
    : !range ? "A aguardar o primeiro dia completo após a última alteração"
    : !complete ? `Dados incompletos desde a última alteração (${coverage}/${expectedDays} dias)`
    : grossSpend == null ? "Gasto bruto por importar"
    : grossSpend <= 0 ? "Sem gasto desde a última alteração"
    : expectedDays < 5 ? `Scale/Kill/discale aguarda 5 dias completos após a última alteração (${expectedDays}/5)`
    : opts.productIds == null ? "Associar produtos/coleção Shopify para calcular o equilíbrio"
    : breakEven == null ? "Margem Shopify insuficiente para calcular o equilíbrio"
    : !eligible ? "Campanha inativa ou estado por confirmar" : null;
  return { range, coverage, expectedDays, grossSpend, googleRevenue, shopifyRevenue: opts.productIds == null ? null : net,
    breakEven, googleConversions: complete ? conversions : null, costPerConversion, scope: opts.scope, shared: opts.shared, reason,
    google: { roas: googleRoas, level: scaleLevel(googleRoas, breakEven, eligible, eligible) },
    shopify: { roas: shopifyRoas, level: scaleLevel(shopifyRoas, breakEven, eligible, eligible) } };
}
