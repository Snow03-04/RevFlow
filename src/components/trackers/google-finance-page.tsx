import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { ChevronRight, FolderOpen } from "lucide-react";
import { getGooglePnlCatalog, getGoogleFinanceData } from "@/lib/trackers/google-pnl-query";
import { summariseCollection, type GoogleCollection } from "@/lib/trackers/google-collections";
import { summariseGooglePnl } from "@/lib/trackers/google-pnl";
import { MONTH_NAMES, type PnlFees } from "@/lib/trackers/pnl";
import { money, mult, pct } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { GooglePnlSheet } from "./google-pnl-sheet";
import { GoogleCollectionSheet } from "./google-collection-sheet";
import { GoogleCollectionPicker, GoogleCollectionAssociation } from "./google-collection-controls";
import { CampaignPicker } from "./campaign-picker";
import { GooglePerformance, PartialValue, googleStatusLabel } from "./google-performance";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import type { FinanceParams } from "./finance-platform-page";

export async function GoogleFinancePage({ db, userId, sp, year, month, currency, feesByMonth, range, query }: {
  db: SupabaseClient<Database>; userId: string; sp: FinanceParams; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; range: DateRange; query: string;
}) {
  const catalog = await getGooglePnlCatalog(db, userId, year);
  const data = await getGoogleFinanceData(db, userId, catalog, range, currency);
  const inStore = (c: { storeId: string | null }) => !sp.store || sp.store === "all" || c.storeId === sp.store;
  const collections = data.collections.filter(inStore);
  const campaigns = data.campaigns.filter(inStore);
  const selected = collections.find((c) => c.key === sp.collection);
  const campaign = campaigns.find((c) => c.key === sp.campaign);
  const stores = [...new Map(collections.map((c) => [c.storeId, c.storeName])).entries()];
  const total = summariseCollection(collections.flatMap((c) => c.days));
  const href = (changes: Record<string, string | null>) => pnlUrl(query, changes, "/finance/google");
  const tabs = [{ key: "year", name: "Ano", href: href({ view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({ key: String(i + 1), name: name.slice(0, 3), href: href({ view: "month", month: String(i + 1) }) }))];
  return <div className="space-y-5">
    <PageHeader title="Google · Finance" description={`Lojas, coleções e campanhas · ${year} · ${currency}`} actions={<Link href="/connections" className="text-xs text-muted-foreground hover:text-primary">Atualizar script Google</Link>} />
    <nav aria-label="Período financeiro" className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1 scrollbar-thin">{tabs.map((t) => <Link key={t.key} href={t.href} aria-current={(month ? String(month) : "year") === t.key ? "page" : undefined} className={cn("whitespace-nowrap rounded px-3 py-1.5 text-sm", (month ? String(month) : "year") === t.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}>{t.name}</Link>)}</nav>
    <GoogleCollectionPicker options={collections.filter((c) => c.handle)} selected={selected?.handle ? selected.key : ""} />
    {campaigns.length > 0 && <details className="text-xs text-muted-foreground" open={!!sp.campaign}><summary className="mb-2 cursor-pointer">Procurar uma campanha individual</summary><CampaignPicker options={campaigns} selectedKey={campaign?.key ?? ""} platform="Google" /></details>}
    {(sp.collection || sp.campaign) && <Link className="inline-block text-xs text-primary" href={href({ collection: null, campaign: null })}>← Todas as lojas e coleções</Link>}
    {campaigns.length > 0 && total.grossSpend == null && <p role="status" className="rounded border border-border bg-card p-3 text-xs text-muted-foreground">O script anterior enviava apenas o custo pago após crédito. Atualiza para o script v4 para importar também o gasto bruto. CPC, CPM e ROAS aguardam esse valor.</p>}
    {campaign ? <>
      {campaign.storeId && <GoogleCollectionAssociation key={`${campaign.key}:${campaign.collectionHandle}`} campaignKey={campaign.key} year={year} current={campaign.collectionHandle} />}
      <GooglePnlSheet campaign={campaign} rows={data.days.filter((d) => d.key === campaign.key)} year={year} month={month} currency={currency} feesByMonth={feesByMonth} query={query} />
    </> : selected ? <>
      <GoogleCollectionSheet collection={selected} year={year} month={month} currency={currency} query={query} />
      {campaignList(selected)}
    </> : (sp.collection || sp.campaign) ? <p role="status" className="text-sm text-muted-foreground">A seleção não está disponível nesta loja ou neste período.</p> : <>
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">{[
        ["Faturação atribuída", money(total.revenue, currency), "text-cyan-300"],
        ["Pago após crédito", money(campaigns.length || data.accountSpend.some(inStore) ? total.spend : null, currency), ""],
        [total.complete ? "Lucro das coleções" : "Lucro identificado · parcial", money(total.spendKnown && collections.some((c) => c.days.length) ? total.profit : null, currency), total.profit < 0 ? "text-red-400" : "text-emerald-400"],
        ["Encomendas Google", String(total.orders), ""],
      ].map(([label, value, color]) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className={cn("mt-2 text-xl font-semibold tabular-nums", color)}>{value}</p></Card>)}</div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>Gasto bruto <strong className="text-foreground">{money(total.grossSpend, currency)}</strong></span><span>Crédito aplicado <strong className="text-foreground">{money(total.credit, currency)}</strong></span><span>COGS <strong className="text-foreground">{money(total.cogs, currency)}</strong></span></div>
      <GooglePerformance metrics={total} currency={currency} />
      {!campaigns.length && <Card className="space-y-2 p-4"><h2 className="text-sm font-medium">Completar os gastos por coleção</h2><p className="text-xs leading-relaxed text-muted-foreground">As coleções com vendas Google já aparecem abaixo. O script v4 importa as campanhas e as páginas dos anúncios para associar os gastos a cada coleção e calcular o lucro.</p><Link href="/connections" className="inline-block text-xs text-primary">Obter script atualizado →</Link></Card>}
      <div className="space-y-1"><h2 className="text-sm font-medium">Por loja</h2><p className="text-xs text-muted-foreground">Abre uma coleção para consultar as campanhas. “Ver P&L” mostra a sua folha diária.</p></div>
      {!stores.length ? <Card className="p-6 text-sm text-muted-foreground">Ainda sem atividade Google neste período. Importa os dados com o script disponível em Connections.</Card> : stores.map(([id, name]) => {
        const groups = collections.filter((c) => c.storeId === id);
        const s = summariseCollection(groups.flatMap((c) => c.days));
        return <Card key={id ?? "unmapped"} className="overflow-hidden"><details open className="group/store">
          <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3"><span className="flex items-center gap-2 text-sm font-medium"><ChevronRight className="h-3.5 w-3.5 transition-transform group-open/store:rotate-90" />{name}</span><span className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-muted-foreground"><span>Pago <strong className="ml-1 text-foreground">{money(groups.some((g) => g.campaigns.length) || data.accountSpend.some((a) => a.storeId === id) ? s.spend : null, currency)}</strong></span><span>{s.impressions.toLocaleString("pt-PT")} impressões</span><span>{s.clicks.toLocaleString("pt-PT")} cliques</span><span>CTR {pct(s.impressions ? s.clicks / s.impressions : null)}</span><span>CPC {money(s.cpc, currency)}</span></span></summary>
          <div className="overflow-x-auto scrollbar-thin"><div className="min-w-[760px]">
            <div className="grid grid-cols-[minmax(200px,2.3fr)_55px_repeat(4,minmax(85px,1fr))_75px] gap-3 border-b border-border px-4 py-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground"><span className="text-left">Coleção</span><span>Camp.</span><span>Pago</span><span>Faturação</span><span>Lucro</span><span>ROAS / equil.</span><span /></div>
            {groups.map((c) => { const r = summariseCollection(c.days); return <div key={c.key} className="relative border-b border-border last:border-0"><details className="group/collection">
              <summary className="grid cursor-pointer list-none grid-cols-[minmax(200px,2.3fr)_55px_repeat(4,minmax(85px,1fr))_75px] items-center gap-3 px-4 py-3 text-right text-xs hover:bg-muted/20"><span className="flex min-w-0 items-center gap-2 text-left font-medium"><ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/collection:rotate-90" /><span className="truncate">{c.name}</span></span><span className="text-muted-foreground">{c.campaigns.length}</span><span className="tabular-nums">{money(r.spendKnown && c.days.length ? r.spend : null, currency)}</span><span className="tabular-nums">{money(r.revenue, currency)}</span><span className={cn("tabular-nums", r.spendKnown && (r.profit < 0 ? "text-red-400" : "text-emerald-400"))}><PartialValue partial={!r.complete && r.spendKnown && c.days.length > 0}>{money(r.spendKnown && c.days.length ? r.profit : null, currency)}</PartialValue></span><span className="whitespace-nowrap tabular-nums">{mult(r.roas)}<span className="text-[10px] text-muted-foreground"> / {mult(r.breakEven)}</span></span><span /></summary>
              <div className="space-y-4 border-t border-border bg-muted/10 px-4 py-4"><GooglePerformance metrics={r} currency={currency} /><div className="flex flex-wrap gap-x-6 gap-y-2 text-xs text-muted-foreground"><span>Bruto {money(r.grossSpend, currency)}</span><span>Crédito {money(r.credit, currency)}</span><span>{r.orders} encomendas Shopify</span><span>COGS {money(r.cogs, currency)} · {pct(r.cogsPct)}</span><span>Margem identificada {pct(r.spendKnown && c.days.length ? r.margin : null)}{!r.complete ? " · parcial" : ""}</span></div>{r.reasons.length > 0 && <p className="text-xs text-amber-400">{r.reasons.join(". ")}. O lucro parcial usa apenas as vendas identificadas.</p>}{!c.days.length && <p className="text-xs text-muted-foreground">Sem atividade importada neste período.</p>}{campaignList(c)}</div>
            </details><Link aria-label={`Ver P&L de ${c.name} · ${name}`} href={href({ collection: c.key, campaign: null })} className="absolute right-4 top-3 text-xs text-primary hover:underline">Ver P&L →</Link></div>; })}
          </div></div>
        </details></Card>;
      })}
    </>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Como funciona a atribuição por coleção</summary><div className="mt-2 max-w-3xl space-y-2 leading-relaxed"><p>Conta apenas encomendas Shopify identificadas como Google Ads. Cada encomenda entra uma vez, na coleção da sua página de entrada; se essa página não identificar uma coleção, usa a associação explícita da campanha.</p><p>Bruto é o custo reportado pelo Google; pago é o custo após créditos promocionais. CPC, CPM e ROAS usam o bruto; o lucro usa o pago. URLs com várias coleções ficam em “Sem coleção associada” até confirmação manual. O lucro da coleção desconta COGS e anúncios pagos; “parcial” indica vendas identificadas com diferenças de atribuição; taxas e comissões ficam na P&L geral. O ROAS de equilíbrio é calculado a partir da margem antes de anúncios.</p><p>Os valores reportados pelo Google e o lucro após taxas de cada campanha continuam disponíveis na análise individual.</p></div></details>
  </div>;

  function campaignList(c: GoogleCollection) {
    return <div className="space-y-2"><h3 className="flex items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"><FolderOpen className="h-3.5 w-3.5" />Campanhas ({c.campaigns.length})</h3>
      {!c.campaigns.length ? <p className="text-xs text-muted-foreground">Ainda sem campanhas associadas. Associa a coleção na análise de uma campanha.</p> : <Table><TableHeader><TableRow>{["Campanha / estado", "Bruto", "Crédito", "Pago", "Impressões", "Cliques", "CTR", "CPC", "Conv. Google", "Valor conv.", "ROAS Google", "Enc. Shopify", "Receita Shopify", "Lucro identificado"].map((label,i) => <TableHead key={label} className={cn("whitespace-nowrap text-[10px]", i > 0 && "text-right")}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>{c.campaigns.map((campaign) => {
        const rows = data.days.filter((d) => d.key === campaign.key);
        const s = summariseGooglePnl(rows, (d) => feesByMonth[Number(d.slice(5, 7)) - 1]);
        return <TableRow key={campaign.key}><TableCell className="min-w-[250px]"><Link href={href({ campaign: campaign.key, collection: c.handle ? c.key : null })} className="font-medium hover:text-primary">{campaign.name}</Link><p className="mt-1 text-[10px] text-muted-foreground">{googleStatusLabel(campaign.status)} · ID {campaign.campaignId}{!rows.length ? " · sem atividade no período" : ""}</p></TableCell>{[money(s.grossSpend,currency),money(s.credit,currency),money(rows.length && s.spendKnown ? s.input.adspendGoogle : null,currency),s.impressions.toLocaleString("pt-PT"),s.clicks.toLocaleString("pt-PT"),pct(s.ctr),money(s.cpc,currency),s.conversions.toLocaleString("pt-PT"),money(s.conversionValue,currency),mult(s.googleRoas),String(s.input.orders),money(s.net,currency)].map((value,i)=><TableCell key={i} className="whitespace-nowrap text-right text-xs tabular-nums">{value}</TableCell>)}<TableCell className="whitespace-nowrap text-right text-xs tabular-nums"><PartialValue partial={rows.length > 0 && s.spendKnown && !s.complete}>{money(rows.length && s.spendKnown ? s.profit : null,currency)}</PartialValue></TableCell></TableRow>;
      })}</TableBody></Table>}
    </div>;
  }
}
