import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { getMetaPnlCatalog, getMetaPnlDays } from "@/lib/trackers/meta-pnl-query";
import { summariseMetaPnl, type MetaPnlDay } from "@/lib/trackers/meta-pnl";
import { sumMetaSummaries } from "@/lib/trackers/meta-presentation";
import { MONTH_NAMES, type PnlFees } from "@/lib/trackers/pnl";
import { money } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { CampaignPicker } from "./campaign-picker";
import { MetaPnlSheet } from "./meta-pnl-sheet";
import { MetaPerformance } from "./meta-performance";
import { MetaCampaignBrowser } from "./meta-campaign-browser";
import type { FinanceParams } from "./finance-platform-page";

export async function MetaFinancePage({ db, userId, sp, year, month, currency, feesByMonth, range, query }: {
  db: SupabaseClient<Database>; userId: string; sp: FinanceParams; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; range: DateRange; query: string;
}) {
  const catalog = await getMetaPnlCatalog(db, userId, year);
  // Allocate with all competing campaigns before applying any display filter.
  const days = await getMetaPnlDays(db, userId, catalog.rows, range, currency);
  const byCampaign = new Map<string, MetaPnlDay[]>();
  for (const day of days) {
    const rows = byCampaign.get(day.key) ?? [];
    rows.push(day);
    byCampaign.set(day.key, rows);
  }
  const options = catalog.options.filter((o) => !sp.store || sp.store === "all" || o.storeId === sp.store);
  const fees = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const overview = options.map((option) => {
    const rows = byCampaign.get(option.key) ?? [];
    return { option, summary: summariseMetaPnl(rows, fees), target: rows.find((r) => r.target)?.target ?? null, activity: rows.length > 0 };
  });
  const selected = options.find((o) => o.key === sp.campaign);
  const total = sumMetaSummaries(overview.map((c) => c.summary));
  const active = overview.some((c) => c.activity);
  const href = (changes: Record<string, string | null>) => pnlUrl(query, changes, "/finance/meta");
  const tabs = [{ key: "year", name: "Ano", href: href({ view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({ key: String(i + 1), name: name.slice(0, 3), href: href({ view: "month", month: String(i + 1) }) }))];
  return <div className="space-y-5">
    <PageHeader title="Meta · Finance" description={`Lojas, produtos e campanhas · ${year} · ${currency}`} actions={<Link href="/pnl?view=settings" className="text-xs text-muted-foreground hover:text-primary">Comissões e taxas</Link>} />
    <nav aria-label="Período financeiro" className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1 scrollbar-thin">{tabs.map((tab) => <Link key={tab.key} href={tab.href} aria-current={(month ? String(month) : "year") === tab.key ? "page" : undefined} className={cn("whitespace-nowrap rounded px-3 py-1.5 text-sm", (month ? String(month) : "year") === tab.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}>{tab.name}</Link>)}</nav>
    {options.length > 0 && <details className="text-xs text-muted-foreground" open={!!sp.campaign}><summary className="mb-2 cursor-pointer">Procurar uma campanha individual</summary><CampaignPicker options={options} selectedKey={selected?.key ?? ""} platform="Meta" /></details>}
    {sp.campaign && <Link href={href({ campaign: null, collection: null })} className="inline-block text-xs text-primary">← Todas as lojas e campanhas</Link>}
    {selected ? <MetaPnlSheet campaign={selected} rows={byCampaign.get(selected.key) ?? []} year={year} month={month} currency={currency} feesByMonth={feesByMonth} query={query} basePath="/finance/meta" /> : sp.campaign ? <p role="status" className="text-sm text-muted-foreground">Esta campanha não está disponível na loja e no ano selecionados.</p> : !options.length ? <Card className="space-y-2 p-6"><h2 className="text-sm font-medium">Ainda sem campanhas Meta importadas</h2><p className="text-xs text-muted-foreground">Confirma a ligação Meta e a loja associada.</p><Link href="/connections" className="inline-block text-xs text-primary">Ver ligações →</Link></Card> : <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
        ["Receita Shopify estimada", money(active && total.complete ? total.net : null, currency), "text-cyan-300"],
        ["Meta Ads", money(active ? total.input.adspendFb : null, currency), ""],
        ["Lucro estimado", money(active && total.complete ? total.profit : null, currency), total.profit < 0 ? "text-red-400" : "text-emerald-400"],
        ["Compras Meta", active ? total.metaPurchases.toLocaleString("pt-PT") : "—", ""],
      ].map(([label, value, color]) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", color)}>{value}</p></Card>)}</div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>Receita reportada Meta <strong className="font-medium text-foreground">{money(active ? total.metaRevenue : null, currency)}</strong></span><span>COGS <strong className="font-medium text-foreground">{money(active && total.complete ? total.input.cogs : null, currency)}</strong></span><span>Taxas e comissões <strong className="font-medium text-foreground">{money(active && total.complete ? total.paymentFees + total.agencyFees : null, currency)}</strong></span></div>
      <MetaPerformance summary={total} currency={currency} active={active} />
      {!total.complete && <p role="status" className="rounded border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-amber-300">Existem campanhas com associação incompleta. A receita e o lucro estimados ficam por apurar; os resultados reportados pela Meta continuam disponíveis.</p>}
      <MetaCampaignBrowser campaigns={overview} currency={currency} query={query} />
      <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Como funciona a organização e a atribuição</summary><div className="mt-2 max-w-3xl space-y-2 leading-relaxed"><p>As campanhas estão agrupadas por loja e pelo produto ou coleção já identificado. Abre um grupo para comparar resultados; “Ver P&L” mostra a folha diária de cada campanha.</p><p>A receita e as compras reportadas pela Meta são distintas da estimativa Shopify. O lucro estimado desconta COGS, publicidade, taxas e comissões. Os filtros servem para consultar os resultados e não alteram a repartição das vendas.</p></div></details>
    </>}
  </div>;
}
