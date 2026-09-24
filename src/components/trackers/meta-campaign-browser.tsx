"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowUpRight, ChevronDown, ChevronLeft, ChevronRight, FolderOpen, List, Search, X } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupMetaCampaigns, metaRoasLabel, metaRoasValue, isMetaPaused, selectMetaCampaigns, sumMetaSummaries, type MetaCampaignOverview, type MetaCampaignFilter, type MetaCampaignSort } from "@/lib/trackers/meta-presentation";
import { money, pct, num } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { MetaCampaignStatus } from "./meta-performance";
import { MetaFinanceSummary } from "./meta-finance-summary";
import { MetaRoasBadge } from "./meta-roas-badge";
import { MetaFinancialValue, MetaRoasComparison } from "./meta-finance-values";

const PAGE_SIZE = 10;
const focusClass = "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export function MetaCampaignBrowser({ campaigns, currency, query, period, statusUnavailable = false }: {
  campaigns: MetaCampaignOverview[]; currency: string; query: string; period: string; statusUnavailable?: boolean;
}) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<MetaCampaignFilter>(() => campaigns.some((campaign) => campaign.option.status === "ACTIVE") ? "online" : "all");
  const [sort, setSort] = useState<MetaCampaignSort>("spend");
  const [grouped, setGrouped] = useState(true);
  const [page, setPage] = useState(0);
  const filtered = useMemo(() => selectMetaCampaigns(campaigns, search, status, sort), [campaigns, search, status, sort]);
  const summary = useMemo(() => sumMetaSummaries(filtered.map((campaign) => campaign.summary)), [filtered]);
  const stores = useMemo(() => groupMetaCampaigns(filtered), [filtered]);
  const online = campaigns.filter((campaign) => campaign.option.status === "ACTIVE").length;
  const paused = campaigns.filter((campaign) => isMetaPaused(campaign.option.status)).length;
  const tabs: { key: MetaCampaignFilter; label: string; count: number }[] = [
    { key: "all", label: "Todas", count: campaigns.length },
    { key: "online", label: "Online", count: online },
    { key: "paused", label: "Pausadas", count: paused },
    { key: "other", label: "Outras", count: campaigns.length - online - paused },
  ];
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const currentPage = Math.min(page, pages - 1);
  const visible = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);
  const hasFilter = !!search.trim() || status !== "all";
  const reset = () => { setSearch(""); setStatus("all"); setPage(0); };
  const showStore = new Set(campaigns.map((campaign) => campaign.option.storeId)).size > 1;

  return <div className="space-y-7">
    <MetaFinanceSummary summary={summary} currency={currency} available={filtered.some((campaign) => campaign.activity)} label={`${period} · ${hasFilter ? `${filtered.length} campanhas filtradas` : "Todas as campanhas"}`} />
    <section aria-label="Campanhas Meta" className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h2 className="text-base font-semibold">Campanhas</h2><p className="mt-1 text-xs text-muted-foreground">Online primeiro · estado atual da Meta</p></div>
        <div role="group" aria-label="Organização das campanhas" className="flex rounded-lg border border-border p-1">
          <button type="button" aria-pressed={!grouped} onClick={() => setGrouped(false)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs", focusClass, !grouped ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}><List aria-hidden className="h-3.5 w-3.5" />Campanhas</button>
          <button type="button" aria-pressed={grouped} onClick={() => setGrouped(true)} className={cn("inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs", focusClass, grouped ? "bg-muted font-medium text-foreground" : "text-muted-foreground hover:text-foreground")}><FolderOpen aria-hidden className="h-3.5 w-3.5" />Por coleção / produto</button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="space-y-4 border-b border-border p-4">
          <div role="group" aria-label="Filtrar por estado" className="flex flex-wrap gap-1">
            {tabs.filter((item) => item.key !== "other" || item.count > 0).map((item) => <button key={item.key} type="button" aria-pressed={status === item.key} onClick={() => { setStatus(item.key); setPage(0); }} className={cn("inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors", focusClass, status === item.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {item.key === "online" && <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-emerald-500" />}{item.label}<span className={cn("rounded px-1.5 py-0.5 text-[11px] tabular-nums", status === item.key ? "bg-primary/10" : "bg-muted")}>{item.count}</span>
            </button>)}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row">
            <div className="relative min-w-0 flex-1">
              <Search aria-hidden className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <input aria-label="Procurar campanhas" value={search} onChange={(event) => { setSearch(event.target.value); setPage(0); }} placeholder="Procurar campanha, produto ou loja…" className={cn("h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm placeholder:text-muted-foreground", focusClass)} />
              {search && <button type="button" aria-label="Limpar pesquisa" onClick={() => { setSearch(""); setPage(0); }} className={cn("absolute right-1 top-1 rounded-md p-2 text-muted-foreground hover:text-foreground", focusClass)}><X aria-hidden className="h-4 w-4" /></button>}
            </div>
            <select aria-label="Ordenar campanhas" value={sort} onChange={(event) => { setSort(event.target.value as MetaCampaignSort); setPage(0); }} className={cn("h-10 rounded-lg border border-input bg-background px-3 text-sm sm:w-52", focusClass)}>
              <option value="spend">Maior investimento</option><option value="revenue">Maior receita Meta</option><option value="roas">Maior ROAS Meta · 2 dias</option><option value="name">Nome A–Z</option>
            </select>
          </div>
          {statusUnavailable && <p role="status" className="text-xs text-muted-foreground">Não foi possível confirmar o estado de algumas contas. Essas campanhas aparecem com o estado por confirmar.</p>}
        </div>

        {!filtered.length ? <div className="space-y-3 px-4 py-12 text-center"><Search aria-hidden className="mx-auto h-6 w-6 text-muted-foreground/50" /><p className="text-sm font-medium">Nenhuma campanha encontrada</p><p className="text-xs text-muted-foreground">Experimenta outro nome ou estado.</p>{hasFilter && <button type="button" onClick={reset} className={cn("rounded px-2 py-1 text-xs text-primary hover:underline", focusClass)}>Limpar filtros</button>}</div>
          : grouped ? <div className="divide-y divide-border">{stores.map((store) => <section key={store.key} aria-label={`Resultados de ${store.name}`}>
            <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border bg-muted/20 px-4 py-4">
              <div><h3 className="text-sm font-semibold">{store.name}</h3><p className="mt-1 text-[11px] text-muted-foreground">{store.campaigns.filter((c) => c.option.status === "ACTIVE").length} campanhas online</p></div>
              <dl className="flex flex-wrap gap-x-6 gap-y-3">{[["Gasto", money(store.summary.input.adspendFb, currency)], ["Impressões", num(store.summary.impressions)], ["Cliques", num(store.summary.clicks)], ["CTR", pct(store.summary.ctr)], ["CPC", money(store.summary.cpc, currency)], [metaRoasLabel(store.summary), metaRoasValue(store.summary)]].map(([label, value]) => <div key={label}><dt className="text-[10px] text-muted-foreground">{label}</dt><dd className="mt-1 text-xs font-medium tabular-nums">{value}</dd></div>)}</dl>
            </div>
            <div className="overflow-x-auto"><div className="md:min-w-[900px]">
              <div className="hidden grid-cols-[minmax(220px,2fr)_45px_45px_repeat(3,minmax(95px,1fr))_145px_95px] gap-3 border-b border-border/60 px-4 py-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground md:grid"><span className="text-left">Coleção / produto</span><span>Camp.</span><span title="Dias com investimento no período">Dias</span><span>Gasto</span><span>Faturação est.</span><span>Lucro est.</span><span>ROAS / equilíbrio</span><span>Meta · 2 dias</span></div>
              {store.targets.map((target) => <details key={target.key} className="group/target border-b border-border/60 last:border-0">
                <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-4 px-4 py-4 text-left text-xs hover:bg-muted/20 md:grid-cols-[minmax(220px,2fr)_45px_45px_repeat(3,minmax(95px,1fr))_145px_95px] md:gap-3 md:text-right [&::-webkit-details-marker]:hidden">
                  <span className="col-span-2 flex min-w-0 items-center gap-2 text-left md:col-span-1"><ChevronDown aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-open/target:rotate-180" /><span className="min-w-0"><span className="block truncate text-sm font-medium" title={target.name}>{target.name}</span><span className="mt-1 block text-[11px] text-muted-foreground">{target.campaigns.filter((campaign) => campaign.option.status === "ACTIVE").length} online<span className="md:hidden"> · {target.campaigns.length} camp. · {target.summary.activeDates.length} dias</span></span></span></span>
                  <span className="hidden tabular-nums text-muted-foreground md:inline">{target.campaigns.length}</span><span className="hidden tabular-nums text-muted-foreground md:inline">{target.summary.activeDates.length}</span>
                  <span className="tabular-nums"><span className="mb-1 block text-[10px] text-muted-foreground md:hidden">Gasto</span>{money(target.summary.input.adspendFb, currency)}</span>
                  <span><span className="mb-1 block text-[10px] text-muted-foreground md:hidden">Faturação est.</span><MetaFinancialValue summary={target.summary} currency={currency} field="net" active={target.campaigns.some((c) => c.activity)} /></span>
                  <span><span className="mb-1 block text-[10px] text-muted-foreground md:hidden">Lucro est.</span><MetaFinancialValue summary={target.summary} currency={currency} field="profit" active={target.campaigns.some((c) => c.activity)} /></span>
                  <span><span className="mb-1 block text-[10px] text-muted-foreground md:hidden">ROAS / equilíbrio</span><MetaRoasComparison summary={target.summary} active={target.campaigns.some((c) => c.activity)} /></span>
                  <span className="tabular-nums"><span className="mb-1 block text-[10px] text-muted-foreground md:hidden">ROAS Meta · 2 dias</span>{metaRoasValue(target.summary)}</span>
                </summary>
                <div className="border-t border-border/60 bg-muted/10"><CampaignList campaigns={target.campaigns} currency={currency} query={query} showStore={false} /></div>
              </details>)}
            </div></div>
          </section>)}</div>
          : <CampaignList campaigns={visible} currency={currency} query={query} showStore={showStore} />}

        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3">
          <p role="status" className="text-xs text-muted-foreground">{filtered.length === 0 ? "0 campanhas" : grouped ? `${filtered.length} campanhas` : `${currentPage * PAGE_SIZE + 1}–${Math.min((currentPage + 1) * PAGE_SIZE, filtered.length)} de ${filtered.length} campanhas`}{hasFilter && <button type="button" onClick={reset} className={cn("ml-3 rounded text-primary hover:underline", focusClass)}>Limpar filtros</button>}</p>
          {!grouped && pages > 1 && <nav aria-label="Páginas de campanhas" className="flex items-center gap-2"><button type="button" aria-label="Página anterior" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)} className={cn("rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-30", focusClass)}><ChevronLeft aria-hidden className="h-4 w-4" /></button><span className="min-w-12 text-center text-xs tabular-nums text-muted-foreground">{currentPage + 1} / {pages}</span><button type="button" aria-label="Página seguinte" disabled={currentPage === pages - 1} onClick={() => setPage(currentPage + 1)} className={cn("rounded-md border border-border p-1.5 hover:bg-muted disabled:opacity-30", focusClass)}><ChevronRight aria-hidden className="h-4 w-4" /></button></nav>}
        </div>
      </div>
      <p className="text-[11px] leading-relaxed text-muted-foreground">Faturação, lucro e ROAS de equilíbrio usam os artigos Shopify repartidos entre campanhas. O ROAS Meta usa os últimos 2 dias completos, sem hoje, independentemente do período selecionado. Dias = dias com investimento no período.</p>
    </section>
  </div>;
}

function CampaignList({ campaigns, currency, query, showStore }: { campaigns: MetaCampaignOverview[]; currency: string; query: string; showStore: boolean }) {
  const rows = campaigns.map((campaign) => {
    const s = campaign.summary;
    return {
      campaign,
      href: pnlUrl(query, { campaign: campaign.option.key, collection: null }, "/finance/meta"),
      metrics: [
        ["Dias", String(s.activeDates.length)],
        ["Gasto", money(campaign.activity ? s.input.adspendFb : null, currency)],
      ],
    };
  });
  const subtitle = (campaign: MetaCampaignOverview) => [showStore ? campaign.option.storeName : null, campaign.target?.name || campaign.option.accountName].filter(Boolean).join(" · ");
  return <>
    <div className="hidden md:block"><Table aria-label="Resultados das campanhas Meta"><TableHeader><TableRow className="bg-muted/20 hover:bg-muted/20">
      {["Campanha", "Dias", "Gasto", "Faturação est.", "Lucro est.", "ROAS / equilíbrio", "ROAS Meta · 2 dias", ""].map((label, index) => <TableHead key={index} className={cn("whitespace-nowrap text-[10px]", index === 0 ? "w-[30%]" : "text-right")}>{label || <span className="sr-only">Detalhes</span>}</TableHead>)}
    </TableRow></TableHeader><TableBody>{rows.map(({ campaign, href, metrics }) => <TableRow key={campaign.option.key}>
      <TableCell className="min-w-[230px] max-w-[440px] py-4"><div className="flex items-center gap-2"><MetaRoasBadge signal={campaign.fire} /><Link href={href} className={cn("block min-w-0 rounded text-sm font-medium leading-relaxed hover:text-primary", focusClass)} title={campaign.option.name}>{campaign.option.name}</Link></div><div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1"><MetaCampaignStatus status={campaign.option.status} /><span className="max-w-[280px] truncate text-xs text-muted-foreground" title={subtitle(campaign)}>{subtitle(campaign)}</span></div></TableCell>
      {metrics.map(([label, value]) => <TableCell key={label} className="whitespace-nowrap py-4 text-right text-sm tabular-nums">{value}</TableCell>)}
      <TableCell className="whitespace-nowrap py-4 text-right text-sm"><MetaFinancialValue summary={campaign.summary} currency={currency} field="net" active={campaign.activity} /></TableCell>
      <TableCell className="whitespace-nowrap py-4 text-right text-sm"><MetaFinancialValue summary={campaign.summary} currency={currency} field="profit" active={campaign.activity} /></TableCell>
      <TableCell className="py-4 text-right text-sm"><MetaRoasComparison summary={campaign.summary} active={campaign.activity} /></TableCell>
      <TableCell className="py-4 text-right text-sm tabular-nums">{metaRoasValue(campaign.summary)}</TableCell>
      <TableCell className="py-4 pl-0"><Link href={href} aria-label={`Ver P&L de ${campaign.option.name}`} className={cn("inline-flex rounded-md p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary", focusClass)}><ArrowUpRight aria-hidden className="h-4 w-4" /></Link></TableCell>
    </TableRow>)}</TableBody></Table></div>
    <div className="divide-y divide-border md:hidden">{rows.map(({ campaign, href, metrics }) => <article key={campaign.option.key} className="space-y-4 p-4">
      <div><div className="mb-2 flex items-center justify-between"><MetaCampaignStatus status={campaign.option.status} /><Link href={href} aria-label={`Ver P&L de ${campaign.option.name}`} className={cn("rounded p-1 text-muted-foreground", focusClass)}><ArrowUpRight aria-hidden className="h-4 w-4" /></Link></div><div className="flex items-center gap-2"><MetaRoasBadge signal={campaign.fire} /><Link href={href} className={cn("block min-w-0 rounded text-sm font-medium leading-relaxed hover:text-primary", focusClass)}>{campaign.option.name}</Link></div><p className="mt-1 truncate text-xs text-muted-foreground">{subtitle(campaign)}</p></div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3">{metrics.map(([label, value]) => <div key={label}><dt className="text-[11px] text-muted-foreground">{label}</dt><dd className="mt-1 text-sm font-medium tabular-nums">{value}</dd></div>)}<div><dt className="text-[11px] text-muted-foreground">Faturação est.</dt><dd className="mt-1 text-sm font-medium"><MetaFinancialValue summary={campaign.summary} currency={currency} field="net" active={campaign.activity} /></dd></div><div><dt className="text-[11px] text-muted-foreground">ROAS / equilíbrio</dt><dd className="mt-1 text-sm font-medium"><MetaRoasComparison summary={campaign.summary} active={campaign.activity} /></dd></div></dl>
      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs"><span className="text-muted-foreground">Lucro estimado</span><span className="font-medium"><MetaFinancialValue summary={campaign.summary} currency={currency} field="profit" active={campaign.activity} /></span></div>
      <p className="text-[11px] text-muted-foreground">Meta · 2 dias · {metaRoasValue(campaign.summary)} ROAS · {campaign.summary.metaPurchases.toLocaleString("pt-PT")} compras</p>
    </article>)}</div>
  </>;
}
