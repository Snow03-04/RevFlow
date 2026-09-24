import { ChevronDown } from "lucide-react";
import { metaRoasLabel, metaRoasValue, type MetaSummary } from "@/lib/trackers/meta-presentation";
import { money } from "@/lib/trackers/format";
import { MetaPerformance } from "./meta-performance";
import { MetaFinancialValue, MetaRoasComparison } from "./meta-finance-values";

export function MetaFinanceSummary({ summary: s, currency, available, label }: {
  summary: MetaSummary; currency: string; available: boolean; label: string;
}) {
  const values = [
    { label: "Investimento", value: money(available ? s.input.adspendFb : null, currency), note: "Gasto em anúncios Meta" },
    { label: "Faturação Shopify est.", value: <MetaFinancialValue summary={s} currency={currency} field="net" active={available} />, note: "Artigos dos produtos anunciados" },
    { label: "Lucro estimado", value: <MetaFinancialValue summary={s} currency={currency} field="profit" active={available} />, note: "Após COGS, anúncios e taxas" },
    { label: "ROAS / equilíbrio", value: <MetaRoasComparison summary={s} active={available} />, note: `${metaRoasLabel(s)} · ${metaRoasValue(s)}` },
  ];
  const financial = [
    ["Receita reportada Meta", money(s.metaRevenue, currency)],
    ["COGS", money(s.input.cogs, currency)],
    ["Taxas e comissões", money(s.paymentFees + s.agencyFees, currency)],
    ["Compras reportadas Meta", s.metaPurchases.toLocaleString("pt-PT")],
  ];
  return <section aria-label="Resumo Meta" className="space-y-3">
    <p className="text-xs text-muted-foreground">{label}</p>
    <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border lg:grid-cols-4">
      {values.map((metric) => <div key={metric.label} className="min-w-0 bg-card p-4 sm:p-5">
        <p className="text-xs font-medium text-muted-foreground">{metric.label}</p>
        <div className="mt-2 text-xl font-semibold tracking-tight tabular-nums xl:text-2xl">{metric.value}</div>
        <p className="mt-2 text-[11px] text-muted-foreground">{metric.note}</p>
      </div>)}
    </div>
    <details className="group rounded-lg border border-border/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-3 text-xs text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
        <ChevronDown aria-hidden className="h-3.5 w-3.5 transition-transform group-open:rotate-180" />
        Análise financeira e tráfego
        <span className="ml-auto text-right">{metaRoasLabel(s)} · {metaRoasValue(s)}</span>
      </summary>
      <div className="space-y-4 border-t border-border/60 p-4">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">{financial.map(([name, value], i) => <div key={name}><p className="text-xs text-muted-foreground">{name}</p><p className="mt-1 text-sm font-medium tabular-nums">{!available ? "—" : i === 0 || i === 3 || s.complete || s.financialActivity ? value : "Por apurar"}</p></div>)}</div>
        {!s.complete && <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">{s.reasons.join(". ")}. Os valores parciais incluem as vendas identificadas e todos os gastos; algumas vendas e custos de produtos ainda podem faltar.</p>}
        <MetaPerformance summary={s} currency={currency} active={available} />
        {s.recentMeta && <p className="text-xs text-muted-foreground">O ROAS Meta usa {s.recentMeta.from.split("-").reverse().join("/")}–{s.recentMeta.to.split("-").reverse().join("/")}: receita total desses dois dias / gasto total desses dois dias. Exclui hoje e não muda com o mês selecionado.</p>}
        <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">O lucro usa a receita Shopify estimada e desconta COGS, anúncios, taxas e comissões. A atribuição Shopify pode diferir dos resultados reportados pela Meta.</p>
      </div>
    </details>
  </section>;
}
