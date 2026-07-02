import { ArrowDownRight, ArrowUpRight, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { CountUp } from "@/components/dashboard/count-up";
import { cn, formatPercent, pctChange } from "@/lib/utils";

export type MetricFormat = "currency" | "number" | "percent" | "multiplier";

export function KpiCard({
  label,
  value,
  previous,
  format = "currency",
  currency = "USD",
  invertTrend = false,
  highlight = false,
}: {
  label: string;
  value: number;
  previous?: number;
  format?: MetricFormat;
  currency?: string;
  invertTrend?: boolean;
  highlight?: boolean;
}) {
  const change =
    previous === undefined ? null : pctChange(value, previous);
  const isUp = change !== null && change > 0;
  const isFlat = change === null || Math.abs(change) < 0.0001;
  // A higher value is "good" unless invertTrend (e.g. CPA, ad spend).
  const good = isFlat ? null : invertTrend ? !isUp : isUp;

  return (
    <Card
      className={cn(
        "p-5 transition-colors",
        highlight && "border-primary/30 bg-primary/[0.04]",
      )}
    >
      <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </p>
      <div className="mt-2 flex items-end justify-between gap-2">
        <CountUp
          value={value}
          format={format}
          currency={currency}
          className="text-2xl font-semibold tracking-tight tabular-nums"
        />
        {change !== null && (
          <span
            className={cn(
              "flex items-center gap-0.5 text-xs font-medium",
              good === null && "text-muted-foreground",
              good === true && "text-success",
              good === false && "text-destructive",
            )}
          >
            {isFlat ? (
              <Minus className="h-3 w-3" />
            ) : isUp ? (
              <ArrowUpRight className="h-3 w-3" />
            ) : (
              <ArrowDownRight className="h-3 w-3" />
            )}
            {formatPercent(Math.abs(change))}
          </span>
        )}
      </div>
    </Card>
  );
}
