/**
 * Tracker 1 — P&L Profit Sheet calculations.
 * Pure functions: given the blue inputs + fee assumptions, derive every
 * auto column. Division by zero returns `null` (rendered as "-").
 */

export interface PnlFees {
  feeFb: number; // agency fee, fraction — 0 if you don't use an agency
  feeGoogle: number; // agency fee, fraction
  txFee: number; // fixed MONEY per order (Shopify), e.g. 0.30
  paymentPct: number; // Shopify payment % on the sale, fraction — e.g. 0.025
}

export interface PnlDayInput {
  grossRevenue: number; // B
  refunds: number; // C
  cogs: number; // E
  adspendFb: number; // F
  adspendGoogle: number; // G
  orders: number; // number of orders that day (drives the per-order tx fee)
}

export interface PnlDayCalc {
  netRevenue: number; // D = B - C
  agencyFeeFb: number; // H = F * feeFb
  agencyFeeGoogle: number; // I = G * feeGoogle
  paymentFee: number; // Shopify payment fee = B * paymentPct + orders * txFee
  transactionFee: number; // fixed part only (orders * txFee), for reference
  totalCosts: number; // K = E + F + G + H + I + paymentFee
  profit: number; // L = D - K
  marginPct: number | null; // M = L / D
  cogImpactPct: number | null; // N = E / D
  roas: number | null; // O = D / (F + G)
}

export function calcPnlDay(i: PnlDayInput, f: PnlFees): PnlDayCalc {
  const netRevenue = i.grossRevenue - i.refunds;
  const agencyFeeFb = i.adspendFb * f.feeFb;
  const agencyFeeGoogle = i.adspendGoogle * f.feeGoogle;
  const transactionFee = i.orders * f.txFee;
  // Shopify payment fee: a % of the sale + a fixed amount per order.
  const paymentFee = i.grossRevenue * f.paymentPct + transactionFee;
  const totalCosts =
    i.cogs +
    i.adspendFb +
    i.adspendGoogle +
    agencyFeeFb +
    agencyFeeGoogle +
    paymentFee;
  const profit = netRevenue - totalCosts;
  const adspend = i.adspendFb + i.adspendGoogle;

  return {
    netRevenue,
    agencyFeeFb,
    agencyFeeGoogle,
    paymentFee,
    transactionFee,
    totalCosts,
    profit,
    marginPct: netRevenue === 0 ? null : profit / netRevenue,
    cogImpactPct: netRevenue === 0 ? null : i.cogs / netRevenue,
    roas: adspend === 0 ? null : netRevenue / adspend,
  };
}

/** Number of days in a given month/year. */
export function daysInMonth(year: number, month: number): number {
  return new Date(year, month, 0).getDate();
}

export const MONTH_NAMES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

export interface MonthSummary {
  month: number;
  gross: number;
  net: number;
  profit: number;
  adspend: number;
  marginPct: number | null;
  roas: number | null;
}

/** Aggregate a month's day inputs (with its effective fees) into a summary. */
export function summariseMonth(
  month: number,
  rows: PnlDayInput[],
  fees: PnlFees,
): MonthSummary {
  let gross = 0;
  let net = 0;
  let profit = 0;
  let adspend = 0;
  for (const r of rows) {
    const c = calcPnlDay(r, fees);
    gross += r.grossRevenue;
    net += c.netRevenue;
    profit += c.profit;
    adspend += r.adspendFb + r.adspendGoogle;
  }
  return {
    month,
    gross,
    net,
    profit,
    adspend,
    marginPct: net === 0 ? null : profit / net,
    roas: adspend === 0 ? null : net / adspend,
  };
}

/** Conditional colour band for Profit / Margin: green >15%, amber 0–15%, red <0%. */
export function marginBand(marginPct: number | null): "good" | "warn" | "bad" | "none" {
  if (marginPct === null) return "none";
  if (marginPct < 0) return "bad";
  if (marginPct > 0.15) return "good";
  return "warn";
}
