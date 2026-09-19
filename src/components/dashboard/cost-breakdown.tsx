import { formatCurrency } from "@/lib/utils";
import { CountUp } from "@/components/dashboard/count-up";

/**
 * Cost breakdown of supplier, advertising, payment and shipping expenses,
 * with a stacked proportion bar. Kept neutral so the hero KPIs stay the focus.
 */
export function CostBreakdown({
  cogs,
  adSpend,
  paymentFees,
  shippingCost,
  currency,
}: {
  cogs: number;
  adSpend: number;
  paymentFees: number;
  shippingCost: number;
  currency: string;
}) {
  const total = cogs + adSpend + paymentFees + shippingCost;
  const cogsPct = total > 0 ? (cogs / total) * 100 : 0;
  const adsPct = total > 0 ? (adSpend / total) * 100 : 0;
  const feesPct = total > 0 ? (paymentFees / total) * 100 : 0;
  const shippingPct = total > 0 ? (shippingCost / total) * 100 : 0;

  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium text-muted-foreground">
            Custos registados
          </p>
          <CountUp
            value={total}
            format="currency"
            currency={currency}
            className="mt-2 block text-2xl font-semibold leading-none tabular-nums text-foreground"
          />
        </div>
      </div>

      {/* Proportion of the four recorded expense categories. */}
      <div aria-hidden="true" className="mt-4 flex h-1 w-full overflow-hidden rounded-sm bg-muted">
        <div style={{ width: `${cogsPct}%` }} className="bg-sky-500/50" />
        <div style={{ width: `${adsPct}%` }} className="bg-sky-500" />
        <div style={{ width: `${feesPct}%` }} className="bg-slate-400" />
        <div style={{ width: `${shippingPct}%` }} className="bg-indigo-400" />
      </div>

      {/* Line items */}
      <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-4">
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
            <p className="text-xs text-muted-foreground">Publicidade</p>
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
            <p className="text-xs text-muted-foreground">Taxas</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatCurrency(paymentFees, currency)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-indigo-400" />
          <div>
            <p className="text-xs text-muted-foreground">Portes</p>
            <p className="text-sm font-semibold tabular-nums">
              {formatCurrency(shippingCost, currency)}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
