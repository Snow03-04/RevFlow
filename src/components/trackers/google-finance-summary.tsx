import { ChevronDown } from "lucide-react";
import type { summariseCollection } from "@/lib/trackers/google-collections";
import { money, mult, num } from "@/lib/trackers/format";
import { cn } from "@/lib/utils";
import { GooglePerformance, googleAdMoney } from "./google-performance";

export function GoogleFinanceSummary({ summary: s, currency, label, googleRoas, salesComplete = true, missingCollections = [] }: {
  summary: ReturnType<typeof summariseCollection>; currency: string; label: string; googleRoas: number | null;
  salesComplete?: boolean; missingCollections?: string[];
}) {
  const metrics = [
    { label: "Gasto bruto", value: googleAdMoney(s.adCoverage, "grossSpend", currency), note: "Antes do crédito Google", color: "" },
    { label: salesComplete ? "Faturação dos artigos" : "Faturação identificada · parcial", value: money(s.revenue, currency), note: "Produtos da coleção · todos os canais", color: "" },
    { label: s.complete ? "Lucro" : "Lucro identificado · parcial", value: money(s.profit, currency), note: "Faturação − COGS − anúncios Google", color: s.profit == null ? "" : s.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400" },
    { label: "ROAS Google", value: mult(googleRoas), note: "Dias completos desde a última alteração", color: "" },
  ];
  return <section aria-label="Resumo Google" className="space-y-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">{metrics.map((metric) => <div key={metric.label} className="min-w-0 bg-card p-4 sm:p-5">
      <p className="text-xs font-medium text-muted-foreground">{metric.label}</p><p className={cn("mt-2 text-xl font-semibold tracking-tight tabular-nums xl:text-2xl", metric.color)}>{metric.value}</p><p className="mt-2 text-[11px] text-muted-foreground">{metric.note}</p>
    </div>)}</div>
    <div className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>{num(s.units)} artigos{!salesComplete ? " identificados · parcial" : " vendidos"}</span><span>{num(s.orders)} encomendas</span><span>COGS {money(s.cogs, currency)}</span></div>
    <details className="group rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden"><ChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />Tráfego e detalhes financeiros<span className="ml-auto text-right">{num(s.clicks)} cliques · CPC {googleAdMoney(s.adCoverage, "cpc", currency)}</span></summary>
      <div className="space-y-3 border-t border-border/60 p-4"><GooglePerformance metrics={s} currency={currency} googleRoasSinceChange={googleRoas} />
        {missingCollections.length > 0 && <p className="text-xs text-muted-foreground">Totais parciais: falta confirmar os produtos de {missingCollections.join(", ")}.</p>}
        {s.reasons.length > 0 && <p className="text-xs leading-relaxed text-muted-foreground">{s.reasons.join(". ")}.</p>}
        <p className="text-xs leading-relaxed text-muted-foreground">Os valores financeiros seguem o período selecionado. O ROAS Google combina os intervalos desde a última alteração de cada campanha, ponderados pelo gasto. Sem cobertura completa, fica por apurar.</p>
      </div>
    </details>
  </section>;
}
