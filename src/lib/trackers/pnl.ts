/**
 * Tracker 1 — P&L Profit Sheet calculations.
 * Pure functions: given the blue inputs + fee assumptions, derive every
 * auto column. Division by zero returns `null` (rendered as "-").
 */

export interface PnlFees {
  feeFb: number; // fraction, e.g. 0.06
  feeGoogle: number; // 0.10
  txFee: number; // 0.05
}

export interface PnlDayInput {
  grossRevenue: number; // B
  refunds: number; // C
  cogs: number; // E
  adspendFb: number; // F
  adspendGoogle: number; // G
}

export interface PnlDayCalc {
  netRevenue: number; // D = B - C
  agencyFeeFb: number; // H = F * feeFb
  agencyFeeGoogle: number; // I = G * feeGoogle
  transactionFee: number; // J = B * txFee
  totalCosts: number; // K = E + F + G + H + I + J
  profit: number; // L = D - K
  marginPct: number | null; // M = L / D
  cogImpactPct: number | null; // N = E / D
  roas: number | null; // O = D / (F + G)
}

export function calcPnlDay(i: PnlDayInput, f: PnlFees): PnlDayCalc {
  const netRevenue = i.grossRevenue - i.refunds;
  const agencyFeeFb = i.adspendFb * f.feeFb;
  const agencyFeeGoogle = i.adspendGoogle * f.feeGoogle;
  const transactionFee = i.grossRevenue * f.txFee;
  const totalCosts =
    i.cogs +
    i.adspendFb +
    i.adspendGoogle +
    agencyFeeFb +
    agencyFeeGoogle +
    transactionFee;
  const profit = netRevenue - totalCosts;
  const adspend = i.adspendFb + i.adspendGoogle;

  return {
    netRevenue,
    agencyFeeFb,
    agencyFeeGoogle,
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
