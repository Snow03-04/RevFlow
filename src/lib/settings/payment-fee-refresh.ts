import { addDaysYmd } from "@/lib/date";

export type PaymentFeeRefreshStep = { phase: "metrics" | "roas" | "pnl"; from: string; to: string };

/** Keep each server request below the hosting time limit, even with years of history. */
export function paymentFeeRefreshSteps(firstDay: string, today: string): PaymentFeeRefreshStep[] {
  const steps: PaymentFeeRefreshStep[] = [];
  let from = `${firstDay.slice(0, 7)}-01`;
  while (from <= today) {
    const month = from.slice(0, 7);
    const monthEnd = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)), 0)).toISOString().slice(0, 10);
    const to = [addDaysYmd(from, 6), monthEnd, today].sort()[0];
    steps.push({ phase: "metrics", from, to }, { phase: "roas", from, to });
    if (to === monthEnd || to === today) steps.push({ phase: "pnl", from: `${month}-01`, to: `${month}-01` });
    from = addDaysYmd(to, 1);
  }
  return steps;
}
