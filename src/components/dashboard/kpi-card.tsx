import { Card } from "@/components/ui/card";
import { CountUp } from "@/components/dashboard/count-up";
import { cn } from "@/lib/utils";

export type MetricFormat = "currency" | "number" | "percent" | "multiplier";

export function KpiCard({
  label,
  value,
  format = "currency",
  currency = "USD",
  highlight = false,
  description,
  compact = false,
}: {
  label: string;
  value: number | null;
  format?: MetricFormat;
  currency?: string;
  highlight?: boolean;
  description?: string;
  compact?: boolean;
}) {
  return (
    <Card
      className={cn(
        "p-5 transition-colors",
        compact && "rounded-none border-0 p-4 shadow-none",
        highlight && "border-primary/30 bg-primary/[0.04]",
      )}
    >
      <p className={cn("text-xs font-medium text-muted-foreground", !compact && "uppercase tracking-wider")}>
        {label}
      </p>
      <div className={cn("mt-2 flex gap-2", compact ? "flex-wrap items-baseline" : "items-end justify-between")}>
        {value == null ? <span className="text-2xl font-semibold">—</span> : <CountUp
          value={value}
          format={format}
          currency={currency}
          className={cn("font-semibold tracking-tight tabular-nums", compact ? "text-xl" : "text-2xl")}
        />}
      </div>
      {description && <p className="mt-2 text-xs text-muted-foreground">{description}</p>}
    </Card>
  );
}
