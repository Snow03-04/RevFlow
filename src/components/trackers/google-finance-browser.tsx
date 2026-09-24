"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, List, Search, X } from "lucide-react";
import type { summariseCollection } from "@/lib/trackers/google-collections";
import { money, mult, num, pct } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { GoogleCampaignList, type GoogleCampaignOverview } from "./google-campaign-list";
import { googleAdMoney } from "./google-performance";

type CollectionSummary = ReturnType<typeof summariseCollection>;
export type GoogleCollectionOverview = {
  key: string; name: string; storeId: string | null; storeName: string; campaignKeys: string[];
  summary: CollectionSummary; googleRoas: number | null; activeDays: number;
};
export type GoogleStoreOverview = { id: string | null; name: string; summary: CollectionSummary };
type Sort = "spend" | "roas" | "name";
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";
const PAGE_SIZE = 10;

export function GoogleFinanceBrowser({ collections, campaigns, stores, currency, query, today }: {
  collections: GoogleCollectionOverview[]; campaigns: GoogleCampaignOverview[]; stores: GoogleStoreOverview[];
  currency: string; query: string; today: string;
}) {
  const [search, setSearch] = useState("");
  const [onlineOnly, setOnlineOnly] = useState(() => campaigns.some((c) => c.option.status === "ENABLED"));
  const [grouped, setGrouped] = useState(true);
  const [sort, setSort] = useState<Sort>("spend");
  const [page, setPage] = useState(0);
  const byKey = new Map(campaigns.map((c) => [c.option.key, c]));
  const campaignRows = (c: GoogleCollectionOverview) => c.campaignKeys.flatMap((key) => byKey.get(key) ? [byKey.get(key)!] : []);
  const active = (c: GoogleCollectionOverview) => campaignRows(c).filter((row) => row.option.status === "ENABLED").length;
  const term = search.trim().toLocaleLowerCase("pt-PT");
  const matches = (...values: (string | null | undefined)[]) => values.some((value) => value?.toLocaleLowerCase("pt-PT").includes(term));
  const compare = (a: { name: string; spend: number | null; roas: number | null; online: boolean }, b: typeof a) =>
    Number(b.online) - Number(a.online) || (sort === "name" ? 0 : sort === "roas" ? (b.roas ?? -Infinity) - (a.roas ?? -Infinity) : (b.spend ?? -Infinity) - (a.spend ?? -Infinity)) || a.name.localeCompare(b.name, "pt-PT");
  const sortCampaigns = (rows: GoogleCampaignOverview[]) => [...rows].sort((a, b) => compare(
    { name: a.option.name, spend: a.summary.grossSpend, roas: a.signal?.google.roas ?? null, online: a.option.status === "ENABLED" },
    { name: b.option.name, spend: b.summary.grossSpend, roas: b.signal?.google.roas ?? null, online: b.option.status === "ENABLED" }));
  const visibleCampaigns = sortCampaigns(campaigns.filter((c) => (!onlineOnly || c.option.status === "ENABLED") && matches(c.option.name, c.option.storeName, c.option.collectionHandle)));
  const visibleCollections = collections.filter((c) => (!onlineOnly || active(c) > 0) && (matches(c.name, c.storeName) || campaignRows(c).some((row) => matches(row.option.name))))
    .sort((a, b) => compare({ name: a.name, spend: a.summary.grossSpend, roas: a.googleRoas, online: active(a) > 0 }, { name: b.name, spend: b.summary.grossSpend, roas: b.googleRoas, online: active(b) > 0 }));
  const pages = Math.max(1, Math.ceil(visibleCampaigns.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const count = grouped ? visibleCollections.length : visibleCampaigns.length;
  const onlineCount = grouped ? collections.filter((c) => active(c) > 0).length : campaigns.filter((c) => c.option.status === "ENABLED").length;
  const totalCount = grouped ? collections.length : campaigns.length;
  const reset = () => { setSearch(""); setOnlineOnly(false); setPage(0); };

  return <section aria-label="Coleções e campanhas Google" className="space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-semibold">Coleções e campanhas</h2><p className="mt-1 text-xs text-muted-foreground">Online primeiro · estado importado do Google</p></div>
      <div role="group" aria-label="Organização das campanhas" className="flex rounded-lg border border-border p-1">
        {[{ value: false, label: "Campanhas", icon: List }, { value: true, label: "Por coleção", icon: FolderOpen }].map(({ value, label, icon: Icon }) => <button key={label} type="button" aria-pressed={grouped === value} onClick={() => { setGrouped(value); setPage(0); }} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs", focusClass, grouped === value ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}><Icon aria-hidden className="h-3.5 w-3.5" />{label}</button>)}
      </div>
    </div>
    <div className="overflow-hidden rounded-xl border border-border bg-card">
      <div className="space-y-4 border-b border-border p-4">
        <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1">
          {[{ value: true, label: grouped ? "Com campanhas online" : "Online", count: onlineCount }, { value: false, label: grouped ? "Todas as coleções" : "Todas", count: totalCount }].map(({ value, label, count }) => <button key={label} type="button" aria-pressed={onlineOnly === value} onClick={() => { setOnlineOnly(value); setPage(0); }} className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm", focusClass, onlineOnly === value ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{value && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{label}<span className={cn("rounded px-1.5 py-0.5 text-[11px] tabular-nums", onlineOnly === value ? "bg-primary/10" : "bg-muted")}>{count}</span></button>)}
        </div>
        <div className="flex flex-col gap-3 sm:flex-row">
          <div className="relative min-w-0 flex-1"><Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" /><input aria-label="Procurar no Google Finance" value={search} onChange={(e) => { setSearch(e.target.value); setPage(0); }} placeholder="Procurar coleção, campanha ou loja…" className={cn("h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm placeholder:text-muted-foreground", focusClass)} />{search && <button type="button" aria-label="Limpar pesquisa" onClick={() => { setSearch(""); setPage(0); }} className={cn("absolute right-1 top-1 rounded-md p-2 text-muted-foreground hover:text-foreground", focusClass)}><X aria-hidden className="h-4 w-4" /></button>}</div>
          <select aria-label="Ordenar resultados Google" value={sort} onChange={(e) => { setSort(e.target.value as Sort); setPage(0); }} className={cn("h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-52", focusClass)}><option value="spend">Maior investimento</option><option value="roas">Maior ROAS Google</option><option value="name">Nome A–Z</option></select>
        </div>
      </div>
      {!count ? <div className="space-y-3 px-4 py-12 text-center"><Search aria-hidden className="mx-auto h-6 w-6 text-muted-foreground/50" /><p className="text-sm font-medium">Nenhum resultado encontrado</p><p className="text-xs text-muted-foreground">Experimenta outro nome ou estado.</p><button type="button" onClick={reset} className={cn("rounded px-2 py-1 text-xs text-primary hover:underline", focusClass)}>Limpar filtros</button></div>
        : !grouped ? <GoogleCampaignList campaigns={visibleCampaigns.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE)} currency={currency} query={query} today={today} />
        : <div className="divide-y divide-border">{stores.filter((store) => visibleCollections.some((c) => c.storeId === store.id)).map((store) => <section key={store.id ?? "unmapped"} aria-label={`Resultados de ${store.name}`}>
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/20 px-4 py-4"><div><h3 className="text-sm font-semibold">{store.name}</h3><p className="mt-1 text-[11px] text-muted-foreground">Resumo da loja · todas as coleções</p></div><dl className="flex flex-wrap gap-x-6 gap-y-3">{[["Gasto bruto", googleAdMoney(store.summary.adCoverage, "grossSpend", currency)], ["Impressões", num(store.summary.impressions)], ["Cliques", num(store.summary.clicks)], ["CTR", pct(store.summary.ctr)], ["CPC", googleAdMoney(store.summary.adCoverage, "cpc", currency)]].map(([label, value]) => <div key={label}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 text-xs font-medium tabular-nums">{value}</dd></div>)}</dl></div>
          <div className="overflow-x-auto"><div className="md:min-w-[960px]">
            <div className="hidden grid-cols-[minmax(200px,2fr)_40px_40px_repeat(3,minmax(95px,1fr))_135px_95px] gap-3 border-b border-border/60 px-4 py-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground md:grid"><span className="text-left">Coleção</span><span>Camp.</span><span title="Dias com investimento no período">Dias</span><span>Gasto bruto</span><span>Faturação</span><span>Lucro</span><span>Shopify / equil.</span><span>ROAS Google</span></div>
            {visibleCollections.filter((c) => c.storeId === store.id).map((c) => <details key={c.key} className="group/collection border-b border-border/60 last:border-0">
              <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-4 px-4 py-4 text-left text-xs hover:bg-muted/20 md:grid-cols-[minmax(200px,2fr)_40px_40px_repeat(3,minmax(95px,1fr))_135px_95px] md:gap-3 md:text-right [&::-webkit-details-marker]:hidden">
                <span className="col-span-2 flex min-w-0 items-center gap-2 text-left md:col-span-1"><ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/collection:rotate-180" /><span className="min-w-0"><span className="block truncate text-sm font-medium" title={c.name}>{c.name}</span><span className="mt-1 block text-[11px] text-muted-foreground">{active(c) > 0 ? <span className="text-emerald-600 dark:text-emerald-400">{active(c)} online</span> : "Sem campanhas online"}<span className="md:hidden"> · {c.campaignKeys.length} camp. · {c.activeDays} dias</span></span></span></span>
                <span className="hidden tabular-nums text-muted-foreground md:inline">{c.campaignKeys.length}</span><span className="hidden tabular-nums text-muted-foreground md:inline">{c.activeDays}</span>
                <span className="tabular-nums"><MobileLabel>Gasto bruto</MobileLabel>{googleAdMoney(c.summary.adCoverage, "grossSpend", currency)}</span>
                <span className="tabular-nums"><MobileLabel>Faturação</MobileLabel>{money(c.summary.revenue, currency)}</span>
                <span className="tabular-nums"><MobileLabel>Lucro</MobileLabel><span className={cn(c.summary.profit != null && (c.summary.profit < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"))}>{money(c.summary.profit, currency)}</span>{c.summary.profit != null && !c.summary.complete && <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>}</span>
                <span className="whitespace-nowrap tabular-nums" title="Vendas dos artigos de todos os canais / gasto bruto Google · período selecionado"><MobileLabel>Shopify / equilíbrio</MobileLabel>{mult(c.summary.roas)}<span className="text-[11px] text-muted-foreground"> / {mult(c.summary.breakEven)}</span></span>
                <span className="tabular-nums" title="Dias completos desde a última alteração de cada campanha"><MobileLabel>ROAS Google · após alteração</MobileLabel>{mult(c.googleRoas)}</span>
              </summary>
              <div className="border-t border-border/60 bg-muted/10"><div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3"><p className="text-[11px] text-muted-foreground">{num(c.summary.units)} artigos · {num(c.summary.orders)} encomendas · COGS {money(c.summary.cogs, currency)}</p><Link href={pnlUrl(query, { collection: c.key, campaign: null }, "/finance/google")} className={cn("inline-flex items-center gap-1 rounded text-xs text-primary hover:underline", focusClass)}>Ver sheet de {c.name}<ArrowUpRight aria-hidden className="h-3.5 w-3.5" /></Link></div>
                {c.summary.reasons.length > 0 && <p className="px-4 pb-3 text-xs text-muted-foreground">{c.summary.reasons.join(". ")}.</p>}
                <GoogleCampaignList campaigns={sortCampaigns(campaignRows(c).filter((row) => !onlineOnly || row.option.status === "ENABLED"))} currency={currency} query={query} today={today} />
              </div>
            </details>)}
          </div></div>
        </section>)}</div>}
      <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3"><p role="status" className="text-xs text-muted-foreground">{grouped ? `${count} coleções` : `${count ? currentPage * PAGE_SIZE + 1 : 0}–${Math.min((currentPage + 1) * PAGE_SIZE, count)} de ${count} campanhas`}{(search || onlineOnly) && <button type="button" onClick={reset} className={cn("ml-3 rounded text-primary hover:underline", focusClass)}>Limpar filtros</button>}</p>{!grouped && pages > 1 && <nav aria-label="Páginas de campanhas" className="flex items-center gap-2"><button type="button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className={cn("rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-30", focusClass)}><ChevronLeft aria-hidden className="h-4 w-4" /></button><span className="text-xs text-muted-foreground">{currentPage + 1} / {pages}</span><button type="button" aria-label="Página seguinte" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className={cn("rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-30", focusClass)}><ChevronRight aria-hidden className="h-4 w-4" /></button></nav>}</div>
    </div>
    <p className="text-[11px] leading-relaxed text-muted-foreground">Os filtros organizam a lista; os resumos mantêm os totais do período. Nas coleções, faturação e lucro incluem os seus artigos de todos os canais. Os dois ROAS das campanhas contam desde a última alteração; os badges exigem cinco dias completos.</p>
  </section>;
}

function MobileLabel({ children }: { children: React.ReactNode }) {
  return <span className="mb-1 block whitespace-normal text-[10px] text-muted-foreground md:hidden">{children}</span>;
}
