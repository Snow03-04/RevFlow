import { formatCurrency, cn } from "@/lib/utils";
import { CountUp } from "@/components/dashboard/count-up";

/**
 * Cost breakdown of supplier, advertising, payment and shipping expenses,
 * with a stacked proportion bar and a delta vs the previous period.
 * Kept neutral so the hero KPIs (Revenue, Profit) stay the focus. For costs a
 * rise is bad (red) and a fall is good (green) — inverted from revenue.
 */
export function CostBreakdown({
  cogs,
  adSpend,
  prevCogs,
  prevAdSpend,
  paymentFees,
  shippingCost,
  prevPaymentFees,
  prevShippingCost,
  currency,
  periodLabel,
}: {
  cogs: number;
  adSpend: number;
  prevCogs: number;
  prevAdSpend: number;
  paymentFees: number;
  shippingCost: number;
  prevPaymentFees: number;
  prevShippingCost: number;
  currency: string;
  periodLabel: string;
}) {
  const total = cogs + adSpend + paymentFees + shippingCost;
  const prevTotal = prevCogs + prevAdSpend + prevPaymentFees + prevShippingCost;
  const delta =
    prevTotal !== 0 ? ((total - prevTotal) / Math.abs(prevTotal)) * 100 : 0;
  const up = delta >= 0; // rising cost = worse
  const cogsPct = total > 0 ? (cogs / total) * 100 : 0;
  const adsPct = total > 0 ? (adSpend / total) * 100 : 0;
  const feesPct = total > 0 ? (paymentFees / total) * 100 : 0;
  const shippingPct = total > 0 ? (shippingCost / total) * 100 : 0;

  return (
    <div className="rounded-2xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Custos registados
          </p>
          <CountUp
            value={total}
            format="currency"
            currency={currency}
            className="mt-2 block text-2xl font-bold leading-none tabular-nums text-foreground"
          />
          <p className="mt-1 text-xs text-muted-foreground">
            Fornecedor + publicidade + taxas + portes
          </p>
        </div>
        <span
          className={cn(
            "inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
            up
              ? "bg-red-500/15 text-red-400"
              : "bg-emerald-500/15 text-emerald-400",
          )}
        >
          {up ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%{" "}
          <span className="font-normal opacity-70">{periodLabel}</span>
        </span>
      </div>

      {/* Proportion of the four recorded expense categories. */}
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div style={{ width: `${cogsPct}%` }} className="bg-sky-500/50" />
        <div style={{ width: `${adsPct}%` }} className="bg-sky-500" />
        <div style={{ width: `${feesPct}%` }} className="bg-slate-400" />
        <div style={{ width: `${shippingPct}%` }} className="bg-indigo-400" />
      </div>

      {/* Line items */}
      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500/50" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">COGS</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatCurrency(cogs, currency)}{" "}
              <span className="font-normal text-muted-foreground">
                · {cogsPct.toFixed(0)}%
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-sky-500" />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Ad Spend</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatCurrency(adSpend, currency)}{" "}
              <span className="font-normal text-muted-foreground">
                · {adsPct.toFixed(0)}%
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-slate-400" />
          <div>
            <p className="text-xs text-muted-foreground">Taxas de pagamento</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatCurrency(paymentFees, currency)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-400" />
          <div>
            <p className="text-xs text-muted-foreground">Portes adicionais</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatCurrency(shippingCost, currency)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
