import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { getGooglePnlCatalog, getGoogleFinanceData } from "@/lib/trackers/google-pnl-query";
import { summariseCollection } from "@/lib/trackers/google-collections";
import { summariseGooglePnl } from "@/lib/trackers/google-pnl";
import { MONTH_NAMES, type PnlFees } from "@/lib/trackers/pnl";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { GooglePnlSheet } from "./google-pnl-sheet";
import { GoogleCollectionSheet } from "./google-collection-sheet";
import { GoogleCollectionPicker, GoogleCollectionAssociation } from "./google-collection-controls";
import { CampaignPicker } from "./campaign-picker";
import { GoogleSpendNotice } from "./google-performance";
import type { FinanceParams } from "./finance-platform-page";
import { getGoogleSignals } from "@/lib/trackers/google-signals-query";
import { summariseGoogleSignalRoas } from "@/lib/trackers/google-scale";
import { GoogleFinanceSummary } from "./google-finance-summary";
import { GoogleFinanceBrowser } from "./google-finance-browser";
import { GoogleCampaignList, type GoogleCampaignOverview } from "./google-campaign-list";

export async function GoogleFinancePage({ db, userId, sp, year, month, currency, feesByMonth, range, query }: {
  db: SupabaseClient<Database>; userId: string; sp: FinanceParams; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; range: DateRange; query: string;
}) {
  const [catalog, insights] = await Promise.all([getGooglePnlCatalog(db, userId, year), getGoogleSignals(db, userId, currency)]);
  const data = await getGoogleFinanceData(db, userId, catalog, range, currency);
  const inStore = (c: { storeId: string | null }) => !sp.store || sp.store === "all" || c.storeId === sp.store;
  const storeCampaigns = data.campaigns.filter(inStore);
  const campaigns = storeCampaigns.filter((c) => c.status !== "PAUSED" && c.status !== "REMOVED");
  const visibleCampaignKeys = new Set(campaigns.map((c) => c.key));
  // Keep historical costs in the collections before filtering campaign navigation.
  const collections = data.collections.filter(inStore).map((c) => ({
    ...c, campaigns: c.campaigns.filter((campaign) => visibleCampaignKeys.has(campaign.key)),
  }));
  const selected = collections.find((c) => c.key === sp.collection);
  const campaign = campaigns.find((c) => c.key === sp.campaign);
  // Use the existing deduplicated store totals, never a sum of overlapping collections.
  const storeTotals = data.totals.filter(inStore);
  const total = summariseCollection(storeTotals.flatMap((c) => c.days), storeTotals.every((c) => c.salesKnown));
  const salesComplete = storeTotals.every((c) => c.salesComplete);
  const roasFor = (options: { key: string }[]) => summariseGoogleSignalRoas(options.map((c) => insights.signals.get(c.key)));
  const campaignOverview: GoogleCampaignOverview[] = campaigns.map((option) => {
    const rows = data.days.filter((d) => d.key === option.key);
    return { option, summary: summariseGooglePnl(rows, (d) => feesByMonth[Number(d.slice(5, 7)) - 1]), activity: rows.length > 0,
      signal: insights.signals.get(option.key), changes: insights.changes.filter((c) => c.campaign_key === option.key) };
  }).sort((a, b) => Number(b.option.status === "ENABLED") - Number(a.option.status === "ENABLED") || (b.summary.grossSpend ?? 0) - (a.summary.grossSpend ?? 0));
  const collectionOverview = collections.map((c) => ({ key: c.key, name: c.name, storeId: c.storeId, storeName: c.storeName,
    campaignKeys: c.campaigns.map((option) => option.key), summary: summariseCollection(c.days, c.productIds !== null),
    googleRoas: roasFor(c.campaigns), activeDays: new Set(c.days.filter((d) => d.grossSpend != null && d.grossSpend > 0).map((d) => d.date)).size }));
  const stores = [...new Map(collections.map((c) => [c.storeId, c.storeName])).entries()].map(([id, name]) => {
    const rows = storeTotals.filter((c) => c.storeId === id);
    return { id, name, summary: summariseCollection(rows.flatMap((c) => c.days), rows.every((c) => c.salesKnown)) };
  });
  const href = (changes: Record<string, string | null>) => pnlUrl(query, changes, "/finance/google");
  const tabs = [{ key: "year", name: "Ano", href: href({ view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({ key: String(i + 1), name: name.slice(0, 3), href: href({ view: "month", month: String(i + 1) }) }))];
  const period = `${month ? MONTH_NAMES[month - 1] : "Ano"} ${year}`;
  const campaignView = campaignOverview.find((c) => c.option.key === campaign?.key);

  return <div className="mx-auto max-w-[1440px] space-y-6">
    <PageHeader title="Google · Finance" description="Investimento e resultados das tuas coleções e campanhas." actions={<Link href="/connections" className="text-xs text-muted-foreground hover:text-primary">Atualizar script Google</Link>} />
    <nav aria-label="Período financeiro" className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 scrollbar-thin">{tabs.map((tab) => <Link key={tab.key} href={tab.href} aria-current={(month ? String(month) : "year") === tab.key ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors", (month ? String(month) : "year") === tab.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}>{tab.name}</Link>)}<span className="ml-auto px-3 text-xs text-muted-foreground">{year}</span></nav>
    {(sp.collection || sp.campaign) && <div className="space-y-3"><Link className="inline-block text-sm text-primary hover:underline" href={href({ collection: null, campaign: null })}>← Todas as lojas e coleções</Link><details className="text-xs text-muted-foreground"><summary className="mb-2 cursor-pointer">Mudar de coleção ou campanha</summary><div className="space-y-3"><GoogleCollectionPicker options={collections.filter((c) => c.handle)} selected={selected?.handle ? selected.key : ""} /><CampaignPicker options={campaigns} selectedKey={campaign?.key ?? ""} platform="Google" /></div></details></div>}
    <GoogleSpendNotice coverage={campaignView?.summary.adCoverage ?? (selected ? summariseCollection(selected.days).adCoverage : total.adCoverage)} />
    {campaign ? <>
      <GooglePnlSheet campaign={campaign} rows={data.days.filter((d) => d.key === campaign.key)} year={year} month={month} currency={currency} feesByMonth={feesByMonth} query={query} googleRoasSinceChange={campaignView?.signal?.google.roas} signal={campaignView?.signal} changes={campaignView?.changes ?? []} today={insights.today} />
      {campaign.storeId && <details className="rounded-lg border border-border p-4 text-xs text-muted-foreground"><summary className="cursor-pointer">Associação à coleção</summary><div className="mt-3"><GoogleCollectionAssociation key={`${campaign.key}:${campaign.collectionHandle}`} campaignKey={campaign.key} year={year} current={campaign.collectionHandle} /></div></details>}
    </> : selected ? <>
      <GoogleCollectionSheet collection={selected} year={year} month={month} currency={currency} query={query} googleRoasSinceChange={roasFor(selected.campaigns)} />
      <section className="space-y-3"><h3 className="text-base font-semibold">Campanhas da coleção</h3><div className="overflow-hidden rounded-xl border border-border bg-card"><GoogleCampaignList campaigns={campaignOverview.filter((c) => selected.campaigns.some((option) => option.key === c.option.key))} currency={currency} query={query} today={insights.today} /></div></section>
    </> : (sp.collection || sp.campaign) ? <p role="status" className="text-sm text-muted-foreground">A seleção não está disponível nesta loja ou neste período.</p> : <>
      <GoogleFinanceSummary summary={total} currency={currency} label={`${period} · Totais de todas as coleções`} googleRoas={roasFor(campaigns)} salesComplete={salesComplete} missingCollections={collections.filter((c) => c.handle && c.productIds === null).map((c) => c.name)} />
      {!storeCampaigns.length && <Card className="space-y-2 p-6"><h2 className="text-sm font-medium">Ainda sem campanhas Google importadas</h2><p className="text-xs leading-relaxed text-muted-foreground">O script Google associa os gastos às coleções. As sheets incluem os artigos vendidos dessas coleções.</p><Link href="/connections" className="inline-block text-xs text-primary">Obter script atualizado →</Link></Card>}
      {storeCampaigns.length > 0 && !campaigns.length && <p role="status" className="text-xs text-muted-foreground">Sem campanhas ativas nesta loja. As campanhas pausadas e removidas estão ocultas; o histórico mantém-se nas coleções.</p>}
      <GoogleFinanceBrowser key={query} collections={collectionOverview} campaigns={campaignOverview} stores={stores} currency={currency} query={query} today={insights.today} />
    </>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Regras Google e cálculo dos resultados</summary><div className="mt-3 max-w-4xl space-y-2 leading-relaxed"><p>Os gastos e o lucro usam o custo bruto dos anúncios, antes do crédito Google. O crédito é descontado apenas na Dashboard e na P&L principal.</p><p>Os ROAS Google e Shopify de cada campanha acumulam os dias completos desde a última alteração, excluindo o dia da alteração e o dia atual. Uma nova alteração reinicia a contagem. Os badges exigem uma campanha ativa, cinco dias completos, cobertura do intervalo e equilíbrio conhecido. Acima do equilíbrio: analisar; acima de 2: scale; acima de 3: scale pronto. Abaixo do equilíbrio: Kill/discale.</p><p>As sheets contam os artigos pagos que pertencem à coleção no Shopify, em encomendas de qualquer origem, incluindo encomendas mistas e extras pagos. Faturação e COGS dos outros artigos ficam nas respetivas coleções. Portes e reembolsos da encomenda são repartidos proporcionalmente. Cada encomenda conta uma vez por coleção. Um produto em várias coleções aparece em cada sheet; o resumo geral conta-o uma única vez.</p><p>O lucro da coleção desconta os COGS dos seus artigos e os anúncios Google associados; taxas e comissões ficam na P&L geral. Sem confirmação dos produtos ou dos gastos, o lucro fica por apurar. O ROAS Shopify da coleção usa as vendas de todos os canais e o gasto do período selecionado. A análise financeira individual das campanhas mantém a atribuição Google por ID ou nome exato; o ROAS Shopify dos sinais usa os produtos associados e pode ser partilhado entre campanhas.</p></div></details>
  </div>;
}
