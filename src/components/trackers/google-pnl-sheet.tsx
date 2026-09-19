import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONTH_NAMES, daysInMonth, type PnlFees } from "@/lib/trackers/pnl";
import { summariseGooglePnl, type GooglePnlDay } from "@/lib/trackers/google-pnl";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";
import { money, pct, mult } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { GooglePerformance, PartialValue } from "./google-performance";

export function GooglePnlSheet({ campaign, rows, year, month, currency, feesByMonth, query }: {
  campaign: MetaPnlOption; rows: GooglePnlDay[]; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; query: string;
}) {
  const fees = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const total = summariseGooglePnl(rows, fees);
  const kpis = [
    ["Gasto bruto", money(total.grossSpend, currency)],
    ["Crédito aplicado", money(total.credit, currency)],
    ["Pago após crédito", money(rows.length && total.spendKnown ? total.input.adspendGoogle : null, currency)],
    ["Receita Shopify identificada", money(total.net, currency)],
    [total.complete ? "Lucro associado" : "Lucro identificado · parcial", money(rows.length && total.spendKnown ? total.profit : null, currency)],
    ["Valor de conversão Google", money(total.conversionValue, currency)],
  ];
  const groups = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, i) => {
    const n = i + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}` : `${year}-${String(n).padStart(2, "0")}`;
    const days = rows.filter((r) => r.date.startsWith(prefix));
    return { prefix, days, summary: summariseGooglePnl(days, fees),
      label: month ? `${String(n).padStart(2, "0")}/${String(month).padStart(2, "0")}` : MONTH_NAMES[i],
      href: month ? null : pnlUrl(query, { view: "month", month: String(n) }, "/finance/google") };
  });
  return <div className="space-y-5">
    <div><h2 className="text-lg font-medium">{campaign.name}</h2><p className="mt-1 text-sm text-muted-foreground">{campaign.storeName} · {campaign.accountName} · {month ? MONTH_NAMES[month - 1] : "Ano"} {year}</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">{kpis.map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-lg font-semibold tabular-nums">{value}</p></Card>)}</div>
    <GooglePerformance metrics={total} currency={currency} />
    {!total.complete && <p role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">Há diferenças entre a atribuição Google e as encomendas Shopify identificadas. Os resultados marcados como parciais podem não incluir todas as vendas. Nos dias sem gastos importados, o lucro fica por apurar.</p>}
    <details className="rounded-lg border border-border bg-card p-4 text-sm"><summary className="cursor-pointer font-medium">Como são calculados estes valores</summary>
      <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
        <p>Cliques, conversões, valor de conversão e gasto bruto são reportados pelo Google. O valor pago desconta créditos promocionais proporcionalmente por campanha. O lucro usa o pago; CPC, CPM e ROAS usam o bruto. Conversões podem incluir ações diferentes de compras.</p>
        <p>A receita, os COGS e o lucro usam encomendas Shopify com uma campanha Google identificada pelo ID ou pelo nome exato na ligação de entrada. Um gclid, por si só, não identifica a campanha. Encomendas sem identificação não são distribuídas por suposição.</p>
        <p>Os COGS incluem a sheet do fornecedor. As comissões Google e taxas de pagamento seguem as definições da P&L. A atribuição Google pode usar datas e janelas diferentes das encomendas Shopify; por isso, o seu valor de conversão é mostrado à parte.</p>
      </div>
    </details>
    <Card className="overflow-hidden"><Table><TableHeader><TableRow>{[month ? "Dia" : "Mês", "Bruto", "Crédito", "Pago", "Impressões", "Cliques", "CTR", "CPC", "Conversões Google", "Valor conv. Google", "ROAS Google", "Encomendas Shopify", "Receita identificada", "COGS", "Pagamento", "Comissão Google", "Lucro identificado", "Margem", "Associação"].map((h, i) => <TableHead key={h} className={cn("whitespace-nowrap", i > 0 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{groups.map((g) => <TableRow key={g.prefix}><TableCell className="whitespace-nowrap">{g.href ? <Link href={g.href} className="hover:text-primary">{g.label}</Link> : g.label}</TableCell>{cells(g.summary, g.days.length > 0)}<TableCell className="min-w-[180px] text-right text-xs text-muted-foreground">{!g.days.length ? "Sem atividade importada" : g.summary.complete ? "Dados associados" : [...new Set(g.days.map((d) => d.reason).filter(Boolean))].join(" · ")}</TableCell></TableRow>)}
        <TableRow className="bg-muted/40 font-semibold"><TableCell>Total</TableCell>{cells(total, rows.length > 0)}<TableCell /></TableRow>
      </TableBody></Table></Card>
  </div>;
  function cells(s: ReturnType<typeof summariseGooglePnl>, active: boolean) {
    return [money(s.grossSpend, currency), money(s.credit, currency), money(s.spendKnown ? s.input.adspendGoogle : null, currency), s.impressions.toLocaleString("pt-PT"), s.clicks.toLocaleString("pt-PT"), pct(s.ctr), money(s.cpc, currency), s.conversions.toLocaleString("pt-PT"), money(s.conversionValue, currency), mult(s.googleRoas),
      String(s.input.orders), money(s.net, currency), money(s.input.cogs, currency), money(s.paymentFees, currency), money(s.spendKnown ? s.agencyFees : null, currency), money(s.spendKnown ? s.profit : null, currency), pct(s.spendKnown ? s.margin : null)]
      .map((v, i) => <TableCell key={i} className={cn("whitespace-nowrap text-right tabular-nums", i === 15 && active && s.spendKnown && (s.profit < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={i === 15 && active && s.spendKnown && !s.complete}>{active ? v : "—"}</PartialValue></TableCell>);
  }
}
