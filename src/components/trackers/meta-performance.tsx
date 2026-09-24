import { money, pct } from "@/lib/trackers/format";
import { metaRoasLabel, metaRoasValue, type MetaSummary } from "@/lib/trackers/meta-presentation";
import { cn } from "@/lib/utils";

export function MetaPerformance({ summary: s, currency, active = true }: { summary: MetaSummary; currency: string; active?: boolean }) {
  const values = [
    ["Impressões", s.impressions.toLocaleString("pt-PT")], ["Cliques", s.clicks.toLocaleString("pt-PT")],
    ["CTR", pct(s.ctr)], ["CPC", money(s.cpc, currency)], ["CPM", money(s.cpm, currency)],
    ["Adições ao carrinho", s.atc.toLocaleString("pt-PT")], ["Custo / compra", money(s.cpa, currency)], [metaRoasLabel(s), metaRoasValue(s)],
  ];
  return <div className="grid grid-cols-2 gap-px overflow-hidden rounded border border-border bg-border sm:grid-cols-4 xl:grid-cols-8">
    {values.map(([label, value]) => <div key={label} className="min-w-0 bg-card px-3 py-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium tabular-nums">{active ? value : "—"}</p></div>)}
  </div>;
}

export function MetaCampaignStatus({ status }: { status?: string | null }) {
  const active = status === "ACTIVE";
  const label = ({ ACTIVE: "Online", PAUSED: "Pausada", ARCHIVED: "Arquivada", DELETED: "Removida", CAMPAIGN_PAUSED: "Pausada", ADSET_PAUSED: "Pausada", IN_PROCESS: "Em análise", WITH_ISSUES: "Com problemas" } as Record<string, string>)[status ?? ""] ?? "Estado por confirmar";
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}><span aria-hidden className={cn("h-1.5 w-1.5 shrink-0 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />{label}</span>;
}
