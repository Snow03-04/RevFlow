import { Flame, TrendingUp, TrendingDown, Search, History } from "lucide-react";
import type { GoogleScaleSignal, ScaleLevel } from "@/lib/trackers/google-scale";
import type { CampaignChange } from "@/lib/google/change-history";
import { changeDateLabel } from "@/lib/google/change-events";
import { money, mult } from "@/lib/trackers/format";
import { cn } from "@/lib/utils";

export function ScaleBadge({ level }: { level: ScaleLevel }) {
  if (!level) return null;
  const Icon = level === "kill" ? TrendingDown : level === "ready" ? Flame : level === "scale" ? TrendingUp : Search;
  return <span className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-semibold",
    level === "kill" ? "border-red-500/30 bg-red-500/10 text-red-400" : level === "ready" ? "scale-fire border-orange-400/60 bg-orange-500/15 text-orange-300" : level === "scale" ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400" : "border-sky-500/30 bg-sky-500/10 text-sky-400")}>
    <Icon aria-hidden className="h-3 w-3" />{level === "kill" ? "Kill/discale" : level === "ready" ? "Scale pronto" : level === "scale" ? "Scale" : "Analisar scale"}
  </span>;
}

export function GoogleCampaignSignals({ signal, changes, today, currency, expanded = false }: {
  signal?: GoogleScaleSignal; changes: CampaignChange[]; today: string; currency: string; expanded?: boolean;
}) {
  const sorted = [...changes].sort((a, b) => b.changed_at.localeCompare(a.changed_at));
  const budget = sorted.find((c) => c.kind === "budget");
  const latest = sorted[0];
  const elapsed = latest ? changeDateLabel(latest.changed_at, today).split(" · ")[0] : null;
  const labels = { budget: "Orçamento modificado", status: "Estado modificado", bidding: "Lances modificados", campaign: "Campanha modificada" };
  const changeLabel = (change: CampaignChange) => change.event_id.startsWith("manual:") ? "Data da alteração confirmada" : labels[change.kind];
  return <div className={cn("space-y-2", expanded ? "rounded-lg border border-border bg-muted/10 p-3" : "mt-2")}>
    {signal && <div className="space-y-1.5">
      <p className="text-[10px] text-muted-foreground">ROAS desde a última alteração{signal.range ? ` · ${shortDate(signal.range.from)}–${shortDate(signal.range.to)}` : latest ? " · sem dias completos" : " · data por confirmar"}</p>
      <div className={cn("gap-2", expanded ? "grid sm:grid-cols-3" : "space-y-1")}>
        {[
          { label: "Google Ads", value: mult(signal.google.roas), level: signal.google.level, showElapsed: signal.google.roas != null },
          { label: "Custo / conversão", value: signal.googleConversions === 0 ? "Sem conversões" : money(signal.costPerConversion, currency), level: null, showElapsed: false },
          { label: "Shopify · produtos", value: mult(signal.shopify.roas), level: signal.shopify.level, showElapsed: signal.shopify.roas != null },
        ].map(({ label, value, level, showElapsed }) =>
          <div key={label} className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]"><span className="text-muted-foreground">{label}</span><strong className="tabular-nums">{value}</strong>{showElapsed && elapsed && <span className="text-[10px] text-muted-foreground" title={`${changeLabel(latest)} em ${shortDate(latest.changed_at)}. O ROAS acumula os dias completos após essa alteração.`}>· {elapsed}</span>}<ScaleBadge level={level} /></div>)}
      </div>
      <p className="text-[10px] text-muted-foreground">Equilíbrio {mult(signal.breakEven)}{signal.shared ? " · produtos partilhados" : ""}</p>
      {signal.reason && <p className="text-[10px] text-muted-foreground">{signal.reason}</p>}
      {expanded && <details className="text-[11px] text-muted-foreground"><summary className="cursor-pointer">Como ler os dois ROAS</summary><p className="mt-2 max-w-4xl leading-relaxed">{signal.scope ?? "Produtos por associar"}. Google: {money(signal.googleRevenue, currency)} de valor de conversão. Shopify: {money(signal.shopifyRevenue, currency)} de faturação líquida de todos os canais dos produtos associados, com portes e reembolsos proporcionais. Ambos dividem pelo gasto bruto de {money(signal.grossSpend, currency)} e acumulam apenas os dias completos desde a última alteração da campanha, independentemente do período da P&L selecionado. O equilíbrio usa o mesmo intervalo e inclui COGS, taxas e comissão, antes de créditos. Os badges exigem pelo menos cinco dias completos e cobertura de todo o intervalo. Acima do equilíbrio: analisar; acima de 2: scale; acima de 3: scale pronto. Abaixo do equilíbrio: Kill/discale. O dia da alteração e o dia atual não contam; uma nova alteração reinicia a contagem e a espera. Sem histórico de alterações ou com dias por importar, o ROAS fica por apurar. {signal.shared && "A faturação dos produtos é partilhada com outras campanhas: esta comparação não é atribuição exclusiva e não deve ser somada entre campanhas."}</p></details>}
    </div>}
    <div className="space-y-1 border-t border-border/50 pt-1.5 text-[10px] text-muted-foreground">
      {(budget ? [budget, ...(latest && latest.event_id !== budget.event_id ? [latest] : [])] : latest ? [latest] : []).map((c) => <p key={c.event_id} title={c.event_id.startsWith("manual:") ? `${shortDate(c.changed_at)} · data indicada pelo utilizador` : c.changed_at.replace("T", " ")}><History aria-hidden className="mr-1 inline h-3 w-3" />{changeLabel(c)} {changeDateLabel(c.changed_at, today)}{expanded && c.kind === "budget" && c.old_budget != null && c.new_budget != null ? ` · ${money(c.old_budget, c.currency ?? "")} → ${money(c.new_budget, c.currency ?? "")}` : ""}</p>)}
      {!latest && <p>Sem alterações no histórico importado</p>}
    </div>
  </div>;
}
function shortDate(date: string) { return `${date.slice(8, 10)}/${date.slice(5, 7)}/${date.slice(0, 4)}`; }
