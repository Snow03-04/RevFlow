import type { MetaSummary } from "@/lib/trackers/meta-presentation";
import { money, mult } from "@/lib/trackers/format";
import { cn } from "@/lib/utils";

export function MetaFinancialValue({ summary: s, currency, field, active = true }: {
  summary: MetaSummary; currency: string; field: "net" | "profit"; active?: boolean;
}) {
  const known = active && (s.complete || s.financialActivity);
  return <span title={!s.complete ? s.reasons.join(" · ") : "Estimativa Shopify após repartição entre campanhas"}
    className={cn("tabular-nums", !known ? "text-muted-foreground" : field === "profit" && (s.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"))}>
    {!active ? "—" : !known ? "Por apurar" : <>{money(s[field], currency)}{!s.complete && <span className="ml-1 text-[10px] font-normal text-muted-foreground">parcial</span>}</>}
  </span>;
}

export function MetaRoasComparison({ summary: s, active = true }: { summary: MetaSummary; active?: boolean }) {
  const known = active && (s.complete || s.financialActivity);
  return <span title="ROAS Shopify estimado / ROAS necessário para cobrir COGS, pagamentos e comissões" className="whitespace-nowrap tabular-nums">
    <span className={cn(known && s.roas != null && s.breakEven != null && (s.roas >= s.breakEven ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400"))}>{mult(known ? s.roas : null)}</span>
    <span className="text-xs text-muted-foreground"> / {mult(known ? s.breakEven : null)}</span>
    {known && !s.complete && <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>}
  </span>;
}
