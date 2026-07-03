import { formatCurrency, formatMultiplier, cn } from "@/lib/utils";
import { CountUp } from "@/components/dashboard/count-up";

const META = "#1877F2";
const GOOGLE = "#4285F4";

/**
 * Cross-platform ad spend: Meta + Google = Total, with a stacked proportion bar
 * and the blended ROAS. Purely presentational — mirrors CostBreakdown's style.
 * A rise in spend is neutral here; we show the total ROAS as the headline signal.
 */
export function AdPlatformBreakdown({
  meta,
  google,
  roasTotal,
  currency,
}: {
  meta: number;
  google: number;
  roasTotal: number;
  currency: string;
}) {
  const total = meta + google;
  const metaPct = total > 0 ? (meta / total) * 100 : 0;
  const googlePct = total > 0 ? (google / total) * 100 : 0;

  return (
    <div className="rounded-2xl border border-border/60 bg-card p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
            Ad Spend · plataformas
          </p>
          <CountUp
            value={total}
            format="currency"
            currency={currency}
            className="mt-2 block text-2xl font-bold leading-none tabular-nums text-foreground"
          />
          <p className="mt-1 text-xs text-muted-foreground">Meta + Google</p>
        </div>
        <div className="text-right">
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
            ROAS total
          </p>
          <p
            className={cn(
              "mt-1 text-lg font-semibold tabular-nums",
              roasTotal >= 1 ? "text-emerald-400" : "text-red-400",
            )}
          >
            {formatMultiplier(roasTotal)}
          </p>
        </div>
      </div>

      {/* Proportion bar */}
      <div className="mt-4 flex h-2 w-full overflow-hidden rounded-full bg-muted">
        <div style={{ width: `${metaPct}%`, backgroundColor: META }} />
        <div style={{ width: `${googlePct}%`, backgroundColor: GOOGLE }} />
      </div>

      {/* Line items */}
      <div className="mt-4 grid grid-cols-2 gap-3">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: META }} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Meta Ads</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatCurrency(meta, currency)}{" "}
              <span className="font-normal text-muted-foreground">
                · {metaPct.toFixed(0)}%
              </span>
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: GOOGLE }} />
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Google Ads</p>
            <p className="truncate text-sm font-semibold tabular-nums">
              {formatCurrency(google, currency)}{" "}
              <span className="font-normal text-muted-foreground">
                · {googlePct.toFixed(0)}%
              </span>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
