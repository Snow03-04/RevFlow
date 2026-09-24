import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { summariseGeneralSheet, type GeneralCollection } from "@/lib/trackers/general-sheet";
import { MONTH_NAMES, daysInMonth, type PnlFees } from "@/lib/trackers/pnl";
import { money, mult, pct, num } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { CampaignSheet } from "./campaign-sheet";

export function GeneralCollectionSheet({ collection, year, month, currency, feesByMonth, query }: {
  collection: GeneralCollection; year: number; month?: number; currency: string; feesByMonth: PnlFees[]; query: string;
}) {
  const salesKnown = collection.productIds != null;
  const fees = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const total = summariseGeneralSheet(collection.days, salesKnown, fees);
  let cumulative = 0, cumulativeKnown = salesKnown, seenActivity = false;
  const periods = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, i) => {
    const n = i + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}` : `${year}-${String(n).padStart(2, "0")}`;
    const days = collection.days.filter((day) => day.date.startsWith(prefix));
    const summary = summariseGeneralSheet(days, salesKnown, fees);
    cumulative += summary.profit ?? 0;
    cumulativeKnown = cumulativeKnown && (!days.length || summary.profit != null);
    seenActivity = seenActivity || days.length > 0;
    return { n, prefix, summary, active: days.length > 0, cumulative: cumulativeKnown && seenActivity ? cumulative : null };
  });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-muted-foreground">{collection.storeName} · General sheet</p><h2 className="mt-1 text-xl font-semibold">{collection.name}</h2></div><p className="text-xs text-muted-foreground">{month ? MONTH_NAMES[month - 1] : "Ano"} {year} · {collection.campaigns.filter((c) => c.active).length} campanhas ativas</p></div>
    <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
      ["Faturação líquida · todos os canais", money(total.revenue, currency)],
      ["Gasto total · Meta + Google", money(total.spend, currency)],
      ["Lucro após taxas", money(total.profit, currency)],
      ["Encomendas com estes produtos", num(total.orders)],
    ].map(([label, value], index) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", index === 2 && total.profit != null && (total.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{value}</p></Card>)}</div>
    <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>ROAS <strong className="text-foreground">{mult(total.roas)}</strong></span><span>Equilíbrio <strong className="text-foreground">{mult(total.breakEven)}</strong></span><span>Meta <strong className="text-foreground">{money(total.metaSpend, currency)}</strong></span><span>Google bruto <strong className="text-foreground">{money(total.googleSpend, currency)}</strong></span></div>
    {!salesKnown && <p role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs">Não foi possível confirmar os produtos desta coleção no Shopify. A faturação e o lucro ficam por apurar até a ligação estar disponível.</p>}
    {!total.spendKnown && <p role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs">Faltam gastos importados ou o custo bruto Google em alguns dias. O lucro e o ROAS desses períodos ficam por apurar.</p>}
    <p className="text-xs leading-relaxed text-muted-foreground">Conta apenas os artigos pagos desta coleção, em encomendas de qualquer origem, incluindo encomendas mistas e extras pagos do AfterSell. A faturação e os COGS dos outros produtos ficam nas respetivas coleções. Portes, reembolsos da encomenda e taxas fixas são repartidos pelo valor dos artigos. Cada encomenda conta uma vez por coleção; um produto presente em várias coleções aparece em cada uma. Lucro = vendas líquidas destes artigos − COGS − anúncios Meta e Google − taxas e comissões. O custo Google é bruto, antes de créditos.</p>
    <CampaignSheet title={collection.name} period={`${month ? MONTH_NAMES[month - 1] : "Ano"} ${year}`}><Table><TableHeader><TableRow>{[
      month ? "Dia" : "Mês", "Enc.", "Unid.", "Faturação", "Reemb.", "COGS", "Meta", "Google", "Gasto total", "Taxas", "Comissões", "ROAS", "Lucro", "Margem", "Lucro acum.",
    ].map((label, index) => <TableHead key={label} data-detail={[4, 6, 7, 9, 10].includes(index)} className={cn("whitespace-nowrap text-[11px] uppercase", index > 0 && "text-right")}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
      {periods.map((row) => <TableRow key={row.prefix} className={cn(!row.active && "text-muted-foreground/60")}><TableCell className="whitespace-nowrap">{month ? <><span className="font-medium">{row.n}</span><span className="ml-1.5 text-[10px] text-muted-foreground">{new Date(`${row.prefix}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" })}</span></> : <Link href={pnlUrl(query, { month: String(row.n), view: "month" }, "/finance/general")} className="hover:text-primary">{MONTH_NAMES[row.n - 1]}</Link>}</TableCell>{cells(row.summary, row.active)}<TableCell className={cn("text-right tabular-nums", row.cumulative != null && (row.cumulative < 0 ? "text-red-400" : "text-emerald-400"))}>{money(row.cumulative, currency)}</TableCell></TableRow>)}
      <TableRow className="bg-muted/30 font-semibold"><TableCell>Total</TableCell>{cells(total, true)}<TableCell className="text-right tabular-nums">{money(total.profit, currency)}</TableCell></TableRow>
    </TableBody></Table></CampaignSheet>
  </section>;
  function cells(summary: ReturnType<typeof summariseGeneralSheet>, active: boolean) {
    const values = [num(summary.orders), num(summary.units), money(summary.revenue, currency), money(summary.refunds, currency), money(summary.cogs, currency),
      money(summary.metaSpend, currency), money(summary.googleSpend, currency), money(summary.spend, currency), money(summary.payments, currency), money(summary.agency, currency),
      mult(summary.roas), money(summary.profit, currency), pct(summary.margin)];
    return values.map((value, index) => <TableCell key={index} data-detail={[3, 5, 6, 8, 9].includes(index)} className={cn("whitespace-nowrap text-right text-xs tabular-nums", index === 11 && active && summary.profit != null && (summary.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{active ? value : "—"}</TableCell>);
  }
}
