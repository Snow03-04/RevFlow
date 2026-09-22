import { money, mult, pct } from "@/lib/trackers/format";
import type { GoogleAdCoverage } from "@/lib/trackers/google-ad-coverage";

export function googleAdMoney(coverage: GoogleAdCoverage, metric: "grossSpend" | "cpc" | "cpm" | "cpa", currency: string) {
  const value = coverage[metric];
  return `${money(value, currency)}${value != null && !coverage.complete ? " · parcial" : ""}`;
}

export function GoogleSpendNotice({ coverage }: { coverage: GoogleAdCoverage }) {
  if (!coverage.missingDates.length) return null;
  const dates = coverage.missingDates.slice(0, 5).map((d) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`).join(", ");
  const extra = coverage.missingDates.length > 5 ? ` e mais ${coverage.missingDates.length - 5} dias` : "";
  return <p role="status" className="rounded border border-border bg-card p-3 text-xs text-muted-foreground">Gastos Google por importar: {dates}{extra}. {coverage.grossSpend != null ? "O gasto e os custos por clique, impressão e conversão mostram apenas os dias com gasto bruto importado, assinalados como parciais." : "Ainda não há gasto bruto disponível neste período."} O lucro do período aguarda os gastos em falta. Executa o script Google Ads para atualizar a importação.</p>;
}

type Performance = {
  impressions: number; clicks: number; conversions: number; conversionValue: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpa: number | null; googleRoas: number | null;
  adCoverage: GoogleAdCoverage;
};
export function GooglePerformance({ metrics: s, currency, googleRoasSinceChange = null }: {
  metrics: Performance; currency: string; googleRoasSinceChange?: number | null;
}) {
  const values = [
    ["Impressões", s.impressions.toLocaleString("pt-PT")], ["Cliques", s.clicks.toLocaleString("pt-PT")],
    ["CTR", pct(s.ctr)], ["CPC", googleAdMoney(s.adCoverage, "cpc", currency)], ["CPM", googleAdMoney(s.adCoverage, "cpm", currency)],
    ["Conversões Google", s.conversions.toLocaleString("pt-PT", { maximumFractionDigits: 2 })],
    ["Valor conv. Google", money(s.conversionValue, currency)], ["ROAS Google · após alteração", mult(googleRoasSinceChange)],
    ["Custo / conversão", googleAdMoney(s.adCoverage, "cpa", currency)],
  ];
  return <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border lg:grid-cols-9">
    {values.map(([label, value]) => <div key={label} className="bg-card px-3 py-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium tabular-nums">{value}</p></div>)}
  </div>;
}
export function PartialValue({ children, partial }: { children: React.ReactNode; partial: boolean }) {
  return <span title={partial ? "Apenas vendas Shopify identificadas; associação incompleta." : undefined}>{children}</span>;
}
export const googleStatusLabel = (status?: string | null) => ({ ENABLED: "Ativa", PAUSED: "Pausada", REMOVED: "Removida" }[status ?? ""] ?? "Estado não importado");
