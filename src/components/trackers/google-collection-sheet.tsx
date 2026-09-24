import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONTH_NAMES, daysInMonth } from "@/lib/trackers/pnl";
import { summariseCollection, type GoogleCollection } from "@/lib/trackers/google-collections";
import { money, mult, pct, num } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { PartialValue, googleAdMoney } from "./google-performance";
import { CampaignSheet } from "./campaign-sheet";
import { GoogleFinanceSummary } from "./google-finance-summary";

export function GoogleCollectionSheet({ collection, year, month, currency, query, googleRoasSinceChange }: {
  collection: GoogleCollection; year: number; month?: number; currency: string; query: string; googleRoasSinceChange?: number | null;
}) {
  const total = summariseCollection(collection.days, collection.productIds !== null);
  let cumulative = 0, cumulativeKnown = true, cumulativePartial = false, seenActivity = false;
  const periods = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, i) => {
    const n = i + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}` : `${year}-${String(n).padStart(2, "0")}`;
    const days = collection.days.filter((d) => d.date.startsWith(prefix));
    const summary = summariseCollection(days, collection.productIds !== null);
    cumulative += summary.profit ?? 0; cumulativeKnown = cumulativeKnown && (!days.length || (summary.spendKnown && summary.salesKnown));
    cumulativePartial = cumulativePartial || !summary.complete;
    seenActivity = seenActivity || days.length > 0;
    return { prefix, summary, active: days.length > 0, cumulative, cumulativePartial, cumulativeKnown: cumulativeKnown && seenActivity, n };
  });
  return <section className="space-y-4">
    <div className="flex flex-wrap items-end justify-between gap-2"><div><p className="text-xs text-muted-foreground">{collection.storeName} / Coleções</p><h2 className="mt-1 text-xl font-semibold">{collection.name}</h2></div><p className="text-xs text-muted-foreground">{month ? MONTH_NAMES[month - 1] : "Ano"} {year} · {collection.campaigns.length} campanhas</p></div>
    <GoogleFinanceSummary summary={total} currency={currency} label="Artigos desta coleção · inclui encomendas mistas" googleRoas={googleRoasSinceChange ?? null} salesComplete={total.salesKnown} />
    {!total.complete && <p role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">{total.reasons.join(". ")}. O lucro identificado é parcial. Se faltarem gastos, fica por apurar.</p>}
    <CampaignSheet title={collection.name} period={`${month ? MONTH_NAMES[month - 1] : "Ano"} ${year}`}><Table><TableHeader><TableRow>{[month ? "Dia" : "Mês", "Enc.", "Unid.", "Faturação", "COGS", "COGS %", "Gasto bruto", "ROAS", "Lucro", "Margem", "Lucro acum."].map((h, i) => <TableHead key={h} data-detail={i === 5} className={cn("whitespace-nowrap text-[11px] uppercase", i > 0 && "text-right")}>{h}</TableHead>)}</TableRow></TableHeader>
      <TableBody>{periods.map((r) => <TableRow key={r.prefix} className={cn(!r.active && "text-muted-foreground/60")}>
        <TableCell className="whitespace-nowrap">{month ? <><span className="font-medium">{r.n}</span><span className="ml-1.5 text-[10px] text-muted-foreground">{new Date(`${r.prefix}T12:00:00Z`).toLocaleDateString("pt-PT", { weekday: "short", timeZone: "UTC" })}</span></> : <Link href={pnlUrl(query, { month: String(r.n), view: "month" }, "/finance/google")} className="hover:text-primary">{MONTH_NAMES[r.n - 1]}</Link>}</TableCell>
        {cells(r.summary, r.active)}<TableCell className={cn("text-right tabular-nums", r.cumulativeKnown && (r.cumulative < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={r.cumulativeKnown && r.cumulativePartial}>{money(r.cumulativeKnown ? r.cumulative : null, currency)}</PartialValue></TableCell>
      </TableRow>)}<TableRow className="bg-muted/30 font-semibold"><TableCell>Total</TableCell>{cells(total, collection.days.length > 0)}<TableCell className="text-right tabular-nums"><PartialValue partial={total.spendKnown && !total.complete}>{money(total.spendKnown && collection.days.length ? total.profit : null, currency)}</PartialValue></TableCell></TableRow></TableBody>
    </Table></CampaignSheet>
  </section>;
  function cells(s: ReturnType<typeof summariseCollection>, active: boolean) {
    const value = (n: number | null) => active ? n : null;
    return [active ? num(s.orders) : "—", active ? num(s.units) : "—", money(value(s.revenue), currency), money(value(s.cogs), currency), pct(value(s.cogsPct)), googleAdMoney(s.adCoverage, "grossSpend", currency), mult(value(s.roas)), money(value(s.profit), currency), pct(value(s.margin))]
      .map((v, i) => <TableCell key={i} data-detail={i === 4} className={cn("whitespace-nowrap text-right text-xs tabular-nums", i === 7 && s.profit != null && active && (s.profit < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={i === 7 && active && s.spendKnown && !s.complete}>{v}</PartialValue></TableCell>);
  }
}
