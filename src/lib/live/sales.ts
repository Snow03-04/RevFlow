import type { SalesReport } from "@/lib/shopify/sales-report";
export type GlobeSales = {
  day: string; at: number; currency: string; timeZone: string; unavailable: string[];
  daily: Record<string, Record<string, { amount: number; n: number }>>;
};
export function globeSales(report: SalesReport, day: string): GlobeSales {
  const daily: GlobeSales["daily"] = {};
  for (const value of report.days) (daily[value.date] ??= {})[value.storeId] = { amount: value.revenue, n: value.orders };
  return { day, at: report.at, currency: report.currency, timeZone: report.timeZone, unavailable: report.unavailable, daily };
}

/** Analytics owns totals; realtime order arrivals remain independent and cannot double count them. */
export function liveSalesTotals(byStore: Record<string, { rev: number; n: number }>, sales: GlobeSales | null, day: string, keys: string[]) {
  const result = Object.fromEntries(Object.entries(byStore).map(([id, value]) => [id, { ...value }]));
  if (sales?.day === day) for (const [id, value] of Object.entries(sales.daily[day] ?? {})) {
    result[id] = { rev: value.amount, n: value.n };
  }
  return { byStore: result, revenue: keys.reduce((sum, id) => sum + (result[id]?.rev ?? 0), 0), orders: keys.reduce((sum, id) => sum + (result[id]?.n ?? 0), 0) };
}

export function globeRevenueParts(amount: number, currency: string) {
  const digits = new Intl.NumberFormat("pt-PT", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const minor = Math.round(Math.abs(amount) * 10 ** digits);
  return { whole: Math.floor(minor / 10 ** digits), fraction: digits ? "," + String(minor % 10 ** digits).padStart(digits, "0") : "", sign: amount < 0 ? "−" : "" };
}
