import { money, mult, pct } from "@/lib/trackers/format";

type Performance = {
  impressions: number; clicks: number; conversions: number; conversionValue: number;
  ctr: number | null; cpc: number | null; cpm: number | null; cpa: number | null; googleRoas: number | null;
};
export function GooglePerformance({ metrics: s, currency }: { metrics: Performance; currency: string }) {
  const values = [
    ["Impressões", s.impressions.toLocaleString("pt-PT")], ["Cliques", s.clicks.toLocaleString("pt-PT")],
    ["CTR", pct(s.ctr)], ["CPC", money(s.cpc, currency)], ["CPM", money(s.cpm, currency)],
    ["Conversões Google", s.conversions.toLocaleString("pt-PT", { maximumFractionDigits: 2 })],
    ["Valor conv. Google", money(s.conversionValue, currency)], ["ROAS Google", mult(s.googleRoas)],
    ["Custo / conversão", money(s.cpa, currency)],
  ];
  return <div className="grid grid-cols-3 gap-px overflow-hidden rounded border border-border bg-border lg:grid-cols-9">
    {values.map(([label, value]) => <div key={label} className="bg-card px-3 py-3"><p className="text-[10px] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-medium tabular-nums">{value}</p></div>)}
  </div>;
}
export function PartialValue({ children, partial }: { children: React.ReactNode; partial: boolean }) {
  return <span className="inline-flex items-center justify-end gap-1.5">{children}{partial && <span title="Apenas vendas Shopify identificadas; associação incompleta." className="text-[9px] font-normal text-amber-400">parcial</span>}</span>;
}
export const googleStatusLabel = (status?: string | null) => ({ ENABLED: "Ativa", PAUSED: "Pausada", REMOVED: "Removida" }[status ?? ""] ?? "Estado não importado");
