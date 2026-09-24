import Link from "next/link";
import { Layers3 } from "lucide-react";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { getGeneralSheetData } from "@/lib/trackers/general-sheet-query";
import { summariseGeneralSheet } from "@/lib/trackers/general-sheet";
import { MONTH_NAMES, type PnlFees } from "@/lib/trackers/pnl";
import { money, mult, num } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GoogleCollectionPicker } from "./google-collection-controls";
import { GeneralCollectionSheet } from "./general-collection-sheet";
import { GeneralCollectionAssociation } from "./general-collection-controls";
import type { FinanceParams } from "./finance-platform-page";

export async function GeneralFinancePage({ db, userId, sp, year, month, currency, feesByMonth, range, query }: {
  db: SupabaseClient<Database>; userId: string; sp: FinanceParams; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; range: DateRange; query: string;
}) {
  const { collections, unresolved, unavailableMeta } = await getGeneralSheetData(db, userId, year, range, currency, sp.store);
  const selected = collections.find((collection) => collection.key === sp.collection);
  const stores = [...new Map(collections.map((collection) => [collection.storeId, collection.storeName])).entries()];
  const activeCampaigns = new Set(collections.flatMap((c) => c.campaigns.filter((campaign) => campaign.active).map((campaign) => `${campaign.platform}:${campaign.key}`)));
  const href = (changes: Record<string, string | null>) => pnlUrl(query, changes, "/finance/general");
  const fees = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const tabs = [{ key: "year", name: "Ano", href: href({ view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({ key: String(i + 1), name: name.slice(0, 3), href: href({ view: "month", month: String(i + 1) }) }))];
  return <div className="space-y-5">
    <PageHeader title="General sheet" description={`Coleções anunciadas · todas as origens de venda · ${year} · ${currency}`} actions={<Link href="/pnl?view=settings" className="text-xs text-muted-foreground hover:text-primary">Comissões e taxas</Link>} />
    <p className="max-w-4xl text-xs leading-relaxed text-muted-foreground">Uma folha por coleção e por loja. Junta os anúncios Meta e Google e conta só os artigos pagos dessa coleção, incluindo encomendas mistas, extras do AfterSell e vendas de qualquer canal.</p>
    {unavailableMeta.length > 0 && <p role="status" className="rounded-md border border-amber-500/20 bg-amber-500/5 p-3 text-xs text-muted-foreground">Não foi possível confirmar as campanhas ativas Meta em {unavailableMeta.join(", ")}. Algumas coleções podem estar em falta. <Link href="/connections" className="text-primary">Verificar ligação</Link></p>}
    <nav aria-label="Período financeiro" className="flex gap-1 overflow-x-auto rounded-md border border-border bg-card p-1 scrollbar-thin">{tabs.map((tab) => <Link key={tab.key} href={tab.href} aria-current={(month ? String(month) : "year") === tab.key ? "page" : undefined} className={cn("whitespace-nowrap rounded px-3 py-1.5 text-sm", (month ? String(month) : "year") === tab.key ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}>{tab.name}</Link>)}</nav>
    <GoogleCollectionPicker options={collections} selected={selected?.key ?? ""} basePath="/finance/general" />
    {sp.collection && <Link href={href({ collection: null })} className="inline-block text-xs text-primary">← Todas as lojas e coleções</Link>}
    {selected ? <GeneralCollectionSheet collection={selected} year={year} month={month} currency={currency} feesByMonth={feesByMonth} query={query} /> : sp.collection ? <p role="status" className="text-sm text-muted-foreground">Esta coleção não está disponível na loja selecionada ou já não tem campanhas ativas.</p> : <>
      <div className="grid grid-cols-3 gap-3">{[["Coleções anunciadas", collections.length], ["Lojas", stores.length], ["Campanhas ativas associadas", activeCampaigns.size]].map(([label, value]) => <Card key={label} className="p-4"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-2 text-xl font-semibold tabular-nums">{value}</p></Card>)}</div>
      {!collections.length && <Card className="space-y-2 p-6"><h2 className="text-sm font-medium">Ainda sem coleções anunciadas identificadas</h2><p className="text-xs leading-relaxed text-muted-foreground">As coleções aparecem quando têm campanhas ativas Meta ou Google associadas. Confirma as ligações e a loja de cada conta de anúncios.</p><Link href="/connections" className="inline-block text-xs text-primary">Ver ligações →</Link></Card>}
      {stores.map(([storeId, storeName]) => <Card key={storeId} className="overflow-hidden"><div className="flex items-center gap-2 border-b border-border bg-muted/20 px-4 py-3"><Layers3 className="h-4 w-4 text-primary" /><h2 className="text-sm font-medium">{storeName}</h2></div><Table><TableHeader><TableRow>{["Coleção", "Anúncios ativos", "Enc.", "Faturação", "COGS", "Gasto Meta + Google", "ROAS", "Lucro", ""].map((label, index) => <TableHead key={index} className={cn("whitespace-nowrap text-[10px] uppercase", index > 1 && "text-right")}>{label}</TableHead>)}</TableRow></TableHeader><TableBody>
        {collections.filter((collection) => collection.storeId === storeId).map((collection) => {
          const total = summariseGeneralSheet(collection.days, collection.productIds != null, fees);
          const platforms = [...new Set(collection.campaigns.filter((c) => c.active).map((c) => c.platform))];
          return <TableRow key={collection.key}><TableCell className="min-w-[180px]"><Link href={href({ collection: collection.key })} className="font-medium hover:text-primary">{collection.name}</Link>{!total.salesKnown && <p className="mt-1 text-[10px] text-amber-400">Produtos por confirmar no Shopify</p>}{total.salesKnown && !total.spendKnown && <p className="mt-1 text-[10px] text-amber-400">Gastos por apurar em alguns dias</p>}</TableCell>
            <TableCell><div className="flex gap-1.5">{platforms.map((platform) => <span key={platform} className="rounded-full border border-border bg-muted/30 px-2 py-0.5 text-[10px]">{platform === "meta" ? "Meta" : "Google"}</span>)}</div></TableCell>
            {[num(total.orders), money(total.revenue, currency), money(total.cogs, currency), money(total.spend, currency), mult(total.roas)].map((value, index) => <TableCell key={index} className="whitespace-nowrap text-right text-xs tabular-nums">{value}</TableCell>)}
            <TableCell className={cn("whitespace-nowrap text-right text-xs tabular-nums", total.profit != null && (total.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{money(total.profit, currency)}</TableCell>
            <TableCell className="whitespace-nowrap text-right"><Link aria-label={`Ver sheet de ${collection.name} · ${storeName}`} href={href({ collection: collection.key })} className="text-xs text-primary hover:underline">Ver sheet →</Link></TableCell></TableRow>;
        })}
      </TableBody></Table></Card>)}
    </>}
    {unresolved.length > 0 && <details className="rounded-lg border border-border bg-card p-4"><summary className="cursor-pointer text-xs font-medium">{unresolved.length} campanhas ativas por associar a uma coleção</summary><p className="mt-2 text-xs text-muted-foreground">Indica a coleção quando o destino do anúncio não a identifica ou o produto pertence a várias.</p><div className="mt-4 space-y-4">{unresolved.map((campaign) => <div key={`${campaign.platform}:${campaign.key}`} className="space-y-2"><p className="text-xs"><strong>{campaign.name}</strong><span className="text-muted-foreground"> · {campaign.platform === "meta" ? "Meta" : "Google"} · {campaign.storeName}</span></p>{campaign.storeId ? <GeneralCollectionAssociation campaign={campaign} year={year} /> : <Link href="/connections" className="text-xs text-primary">Associar a conta a uma loja →</Link>}</div>)}</div></details>}
    <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">Como funciona a General sheet</summary><div className="mt-2 max-w-4xl space-y-2 leading-relaxed"><p>As coleções são identificadas pelos destinos dos anúncios ou pela associação que definires. Os produtos são confirmados na coleção Shopify atual. Campanhas da mesma coleção, em Meta ou Google, partilham uma só folha nessa loja.</p><p>Cada encomenda conta uma vez por coleção, incluindo apenas os seus artigos e extras pagos, com a respetiva faturação e COGS. Portes, reembolsos e taxas fixas da encomenda são repartidos proporcionalmente. Um produto que pertença a várias coleções aparece em cada folha; por isso, as folhas não devem ser somadas como total da loja.</p><p>Os gastos incluem o histórico das campanhas associadas à coleção, incluindo campanhas entretanto pausadas. O lucro desconta COGS, gasto bruto dos anúncios, taxas de pagamento e comissões configuradas na P&amp;L.</p></div></details>
  </div>;
}
