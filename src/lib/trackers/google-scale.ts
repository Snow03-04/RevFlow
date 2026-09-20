import type { DateRange } from "@/types";
import type { TrackerOrderSales } from "./sales";
import type { PnlFees } from "./pnl";

export type ScaleLevel = "review" | "scale" | "ready" | null;
export type ScaleMetric = { roas: number | null; level: ScaleLevel };
export type GoogleScaleSignal = {
  range: DateRange; coverage: number; grossSpend: number | null;
  google: ScaleMetric; shopify: ScaleMetric; breakEven: number | null;
  shopifyRevenue: number | null; googleRevenue: number;
  scope: string | null; shared: boolean; reason: string | null;
};

export function lastFiveCompleteDays(today: string): DateRange {
  const shift = (n: number) => new Date(Date.parse(`${today}T12:00:00Z`) + n * 86400000).toISOString().slice(0, 10);
  return { from: shift(-5), to: shift(-1) };
}

export function scaleLevel(roas: number | null, breakEven: number | null, eligible = true): ScaleLevel {
  if (!eligible || roas == null || breakEven == null || !Number.isFinite(roas) || !Number.isFinite(breakEven) || roas <= breakEven) return null;
  return roas > 3 ? "ready" : roas > 2 ? "scale" : "review";
}

/** Full product revenue is a scope comparison, never added to attributed P&L totals. */
export function calculateGoogleScale(opts: {
  range: DateRange; status?: string | null; storeId: string | null; rate: number;
  facts: { date: string; grossSpend: number | null; conversionValue: number }[];
  orders: TrackerOrderSales[]; productIds: string[] | null; scope: string | null; shared: boolean;
  fees: (date: string) => PnlFees;
}): GoogleScaleSignal {
  const facts = opts.facts.filter((f) => f.date >= opts.range.from && f.date <= opts.range.to);
  const coverage = new Set(facts.map((f) => f.date)).size;
  const grossSpend = facts.length && facts.every((f) => f.grossSpend != null) ? facts.reduce((s, f) => s + f.grossSpend!, 0) : null;
  const googleRevenue = facts.reduce((s, f) => s + f.conversionValue, 0);
  const products = new Set(opts.productIds ?? []);
  let net = 0, costs = 0, payments = 0;
  for (const order of opts.orders) {
    if (!opts.storeId || order.storeId !== opts.storeId || order.date < opts.range.from || order.date > opts.range.to) continue;
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
  const googleRoas = grossSpend && grossSpend > 0 ? googleRevenue / grossSpend : null;
  const shopifyRoas = opts.productIds != null && grossSpend && grossSpend > 0 ? net / grossSpend : null;
  const eligible = coverage === 5 && opts.status?.toUpperCase() === "ENABLED";
  const reason = coverage < 5 ? `A aguardar 5 dias completos (${coverage}/5)`
    : grossSpend == null ? "Gasto bruto por importar"
    : grossSpend <= 0 ? "Sem gasto nos últimos 5 dias"
    : opts.productIds == null ? "Associar produtos/coleção Shopify para calcular o equilíbrio"
    : breakEven == null ? "Margem Shopify insuficiente para calcular o equilíbrio"
    : !eligible ? "Campanha inativa ou estado por confirmar" : null;
  return { range: opts.range, coverage, grossSpend, googleRevenue, shopifyRevenue: opts.productIds == null ? null : net,
    breakEven, scope: opts.scope, shared: opts.shared, reason,
    google: { roas: googleRoas, level: scaleLevel(googleRoas, breakEven, eligible) },
    shopify: { roas: shopifyRoas, level: scaleLevel(shopifyRoas, breakEven, eligible) } };
}
