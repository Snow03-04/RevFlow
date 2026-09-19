import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONTH_NAMES, daysInMonth } from "@/lib/trackers/pnl";
import { summariseCollection, type GoogleCollection } from "@/lib/trackers/google-collections";
import { money, mult, pct } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { GooglePerformance, PartialValue } from "./google-performance";

export function GoogleCollectionSheet({ collection, year, month, currency, query }: {
  collection: GoogleCollection; year: number; month?: number; currency: string; query: string;
}) {
  const total = summariseCollection(collection.days);
  let cumulative = 0, cumulativeKnown = true, cumulativePartial = false, seenActivity = false;
  const periods = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, i) => {
    const n = i + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}` : `${year}-${String(n).padStart(2, "0")}`;
    const days = collection.days.filter((d) => d.date.startsWith(prefix));
    const summary = summariseCollection(days);
    cumulative += summary.profit; cumulativeKnown = cumulativeKnown && summary.spendKnown;
    cumulativePartial = cumulativePartial || !summary.complete;
    seenActivity = seenActivity || days.length > 0;
    return { prefix, summary, active: days.length > 0, cumulative, cumulativePartial, cumulativeKnown: cumulativeKnown && seenActivity, n };
  });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-muted-foreground">{collection.storeName} / Coleções</p><h2 className="mt-1 text-xl font-semibold">{collection.name}</h2></div><p className="text-xs text-muted-foreground">{month ? MONTH_NAMES[month - 1] : "Ano"} {year} · {collection.campaigns.length} campanhas</p></div>
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{[
      ["Faturação líquida", money(total.revenue, currency), "text-cyan-300"],
      ["Pago após crédito", money(total.spendKnown && collection.days.length ? total.spend : null, currency), ""],
      [total.complete ? "Lucro da coleção" : "Lucro identificado · parcial", money(total.spendKnown && collection.days.length ? total.profit : null, currency), total.profit < 0 ? "text-red-400" : "text-emerald-400"],
      ["Encomendas", String(total.orders), ""],
    ].map(([label, value, color]) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", color)}>{value}</p></Card>)}</div>
    <GooglePerformance metrics={total} currency={currency} />
    <p className="text-xs text-muted-foreground">Lucro = faturação Shopify identificada − COGS − anúncios pagos. CPC, CPM e ROAS usam o gasto antes do crédito. Taxas de pagamento e comissões ficam na P&L geral. Acumulado dentro do período selecionado.</p>
    {!total.complete && <p role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">{total.reasons.join(". ")}. O lucro identificado é parcial. Se faltarem gastos, fica por apurar.</p>}
    <Card className="overflow-hidden"><Table><TableHeader><TableRow>{[month ? "Dia" : "Mês", "Enc.", "Faturação", "COGS", "COGS %", "Bruto", "Crédito", "Pago", "ROAS", "Lucro", "Margem", "Lucro acum."].map((h, i) => <TableHead key={h} className={cn("whitespace-nowrap text-[11px] uppercase", i > 0 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{periods.map((r) => <TableRow key={r.prefix} className={cn(!r.active && "text-muted-foreground/60")}>
        <TableCell className="whitespace-nowrap">{month ? <><span className="font-medium">{r.n}</span><span className="ml-1.5 text-[10px] text-muted-foreground">{new Date(`${r.prefix}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" })}</span></> : <Link href={pnlUrl(query, { month: String(r.n), view: "month" }, "/finance/google")} className="hover:text-primary">{MONTH_NAMES[r.n - 1]}</Link>}</TableCell>
        {cells(r.summary, r.active)}<TableCell className={cn("text-right tabular-nums", r.cumulativeKnown && (r.cumulative < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={r.cumulativeKnown && r.cumulativePartial}>{money(r.cumulativeKnown ? r.cumulative : null, currency)}</PartialValue></TableCell>
      </TableRow>)}<TableRow className="bg-muted/30 font-semibold"><TableCell>Total</TableCell>{cells(total, collection.days.length > 0)}<TableCell className="text-right tabular-nums"><PartialValue partial={total.spendKnown && !total.complete}>{money(total.spendKnown && collection.days.length ? total.profit : null, currency)}</PartialValue></TableCell></TableRow></TableBody>
    </Table></Card>
  </section>;
  function cells(s: ReturnType<typeof summariseCollection>, active: boolean) {
    const value = (n: number | null) => active ? n : null;
    return [active ? String(s.orders) : "—", money(value(s.revenue), currency), money(value(s.cogs), currency), pct(value(s.cogsPct)), money(value(s.grossSpend), currency), money(value(s.credit), currency), money(value(s.spendKnown ? s.spend : null), currency), mult(value(s.roas)), money(value(s.spendKnown ? s.profit : null), currency), pct(value(s.spendKnown ? s.margin : null))]
      .map((v, i) => <TableCell key={i} className={cn("whitespace-nowrap text-right text-xs tabular-nums", i === 8 && s.spendKnown && active && (s.profit < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={i === 8 && active && s.spendKnown && !s.complete}>{v}</PartialValue></TableCell>);
  }
}
