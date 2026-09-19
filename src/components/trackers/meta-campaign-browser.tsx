"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, FolderOpen, Package, Search } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { groupMetaCampaigns, type MetaCampaignOverview, type MetaSummary } from "@/lib/trackers/meta-presentation";
import { money, mult, pct } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { MetaCampaignStatus, MetaPerformance } from "./meta-performance";

const normalise = (value: string) => value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase();

export function MetaCampaignBrowser({ campaigns, currency, query }: { campaigns: MetaCampaignOverview[]; currency: string; query: string }) {
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("all");
  const [sort, setSort] = useState("spend");
  const filtered = useMemo(() => campaigns.filter((c) => {
    const text = `${c.option.name} ${c.option.campaignId} ${c.option.storeName} ${c.option.accountName} ${c.target?.name ?? ""}`;
    return normalise(text).includes(normalise(search)) && (status === "all" || (status === "activity" ? c.activity : status === "inactive" ? !c.activity : c.option.status === status));
  }).sort((a, b) => sort === "name" ? a.option.name.localeCompare(b.option.name)
    : (sort === "revenue" ? b.summary.metaRevenue - a.summary.metaRevenue : b.summary.input.adspendFb - a.summary.input.adspendFb)
      || a.option.name.localeCompare(b.option.name)), [campaigns, search, status, sort]);
  const compare = (a: { name: string; summary: MetaSummary }, b: { name: string; summary: MetaSummary }) => sort === "name" ? a.name.localeCompare(b.name)
    : (sort === "revenue" ? b.summary.metaRevenue - a.summary.metaRevenue : b.summary.input.adspendFb - a.summary.input.adspendFb) || a.name.localeCompare(b.name);
  const stores = groupMetaCampaigns(filtered).sort(compare).map((store) => ({ ...store, targets: store.targets.sort(compare) }));
  const inputClass = "h-10 w-full rounded border border-input bg-card px-3 text-sm text-foreground";
  return <section className="space-y-4" aria-label="Campanhas Meta por loja">
    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_180px]">
      <label className="min-w-0 space-y-1.5 text-xs text-muted-foreground"><span>Procurar campanhas</span><div className="relative"><Search aria-hidden className="absolute left-3 top-3 h-4 w-4" /><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Campanha, produto, coleção ou ID…" className={cn(inputClass, "pl-9")} /></div></label>
      <label className="space-y-1.5 text-xs text-muted-foreground"><span>Mostrar</span><select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass}><option value="all">Todas as campanhas</option><option value="activity">Com atividade</option><option value="inactive">Sem atividade</option>{[["ACTIVE", "Ativas"], ["PAUSED", "Pausadas"], ["ARCHIVED", "Arquivadas"], ["DELETED", "Removidas"]].filter(([key]) => campaigns.some((c) => c.option.status === key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <label className="space-y-1.5 text-xs text-muted-foreground"><span>Ordenar por</span><select value={sort} onChange={(e) => setSort(e.target.value)} className={inputClass}><option value="spend">Maior gasto</option><option value="revenue">Maior receita Meta</option><option value="name">Nome</option></select></label>
    </div>
    <div className="flex flex-wrap items-end justify-between gap-2"><div><h2 className="text-sm font-medium">Por loja</h2><p className="mt-1 text-xs text-muted-foreground">Abre um produto ou coleção para comparar as campanhas.</p></div><p role="status" className="text-xs text-muted-foreground">{filtered.length} de {campaigns.length} campanhas</p></div>
    {!stores.length && <Card className="p-8 text-center text-sm text-muted-foreground">Nenhuma campanha corresponde aos filtros.</Card>}
    {stores.map((store) => <Card key={store.key} className="min-w-0 overflow-hidden">
      <details open className="group/store">
        <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 border-b border-border bg-muted/20 px-4 py-3"><span className="flex min-w-0 items-center gap-2 text-sm font-medium"><ChevronRight aria-hidden className="h-3.5 w-3.5 shrink-0 transition-transform group-open/store:rotate-90" />{store.name}<span className="text-xs font-normal text-muted-foreground">{store.campaigns.length} campanhas</span></span><span className="flex gap-5 text-xs text-muted-foreground"><span>Gasto <strong className="ml-1 font-medium text-foreground">{money(store.summary.input.adspendFb, currency)}</strong></span><span>ROAS Meta <strong className="ml-1 font-medium text-foreground">{mult(store.summary.metaRoas)}</strong></span></span></summary>
        <div className="hidden grid-cols-[minmax(0,2fr)_60px_repeat(3,minmax(0,1fr))_80px] gap-4 border-b border-border px-4 py-2 text-right text-[10px] uppercase tracking-wide text-muted-foreground lg:grid"><span className="text-left">Produto / coleção</span><span>Camp.</span><span>Gasto</span><span>Receita Meta</span><span>Lucro est.</span><span>ROAS Meta</span></div>
        {store.targets.map((group) => {
          const s = group.summary;
          const active = group.campaigns.some((c) => c.activity);
          return <details key={group.key} open={search.trim() ? true : undefined} className="group/target border-b border-border last:border-b-0">
            <summary className="grid cursor-pointer list-none grid-cols-2 items-center gap-x-4 gap-y-3 px-4 py-3 hover:bg-muted/20 lg:grid-cols-[minmax(0,2fr)_60px_repeat(3,minmax(0,1fr))_80px]">
              <span className="col-span-2 flex min-w-0 items-center gap-2 lg:col-span-1"><ChevronRight aria-hidden className="h-3 w-3 shrink-0 text-muted-foreground transition-transform group-open/target:rotate-90" />{group.kind === "Produto" ? <Package aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" /> : <FolderOpen aria-hidden className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />}<span className="min-w-0"><span className="block truncate text-xs font-medium" title={group.name}>{group.name}</span><span className="mt-0.5 block text-[10px] text-muted-foreground">{group.kind}</span></span><span className="ml-auto text-xs text-muted-foreground lg:hidden">{group.campaigns.length}</span></span>
              <span className="hidden text-right text-xs text-muted-foreground lg:block">{group.campaigns.length}</span>
              {[["Gasto", money(active ? s.input.adspendFb : null, currency), ""], ["Receita Meta", money(active ? s.metaRevenue : null, currency), "text-cyan-300"], ["Lucro est.", money(active && s.complete ? s.profit : null, currency), s.complete ? s.profit < 0 ? "text-red-400" : "text-emerald-400" : ""], ["ROAS Meta", mult(s.metaRoas), ""]].map(([label, value, color]) => <span key={label} className={cn("text-xs tabular-nums lg:text-right", color)}><span className="mr-2 text-[10px] text-muted-foreground lg:hidden">{label}</span>{value}</span>)}
            </summary>
            <div className="min-w-0 space-y-4 border-t border-border bg-muted/10 p-4">
              <MetaPerformance summary={s} currency={currency} active={active} />
              <div className="flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground"><span>Receita Shopify estimada <strong className="font-medium text-cyan-300">{money(active && s.complete ? s.net : null, currency)}</strong></span><span>COGS {money(active && s.complete ? s.input.cogs : null, currency)}</span><span>Margem {pct(active && s.complete ? s.margin : null)}</span><span>{s.metaPurchases.toLocaleString("pt-PT")} compras Meta</span></div>
              {!s.complete && <p className="text-xs text-amber-400">Algumas campanhas têm associação incompleta. O gasto e os resultados reportados pela Meta continuam disponíveis.</p>}
              <CampaignTable campaigns={group.campaigns} currency={currency} query={query} />
            </div>
          </details>;
        })}
      </details>
    </Card>)}
  </section>;
}

function CampaignTable({ campaigns, currency, query }: { campaigns: MetaCampaignOverview[]; currency: string; query: string }) {
  const columns = ["Campanha", "Gasto", "Receita Meta", "Compras Meta", "ROAS Meta", "Custo / compra", "Impressões", "Cliques", "CTR", "CPC", "Receita est.", "Lucro est.", ""];
  return <Table><TableHeader><TableRow>{columns.map((name, i) => <TableHead key={i} className={cn("whitespace-nowrap text-[10px]", i > 0 && "text-right")}>{name}</TableHead>)}</TableRow></TableHeader><TableBody>{campaigns.map((campaign) => {
    const s: MetaSummary = campaign.summary;
    const href = pnlUrl(query, { campaign: campaign.option.key, collection: null }, "/finance/meta");
    const observed = <T,>(value: T) => campaign.activity ? value : null;
    const values = [money(observed(s.input.adspendFb), currency), money(observed(s.metaRevenue), currency), campaign.activity ? s.metaPurchases.toLocaleString("pt-PT") : "—", mult(s.metaRoas), money(s.cpa, currency), campaign.activity ? s.impressions.toLocaleString("pt-PT") : "—", campaign.activity ? s.clicks.toLocaleString("pt-PT") : "—", pct(s.ctr), money(s.cpc, currency), money(campaign.activity && s.complete ? s.net : null, currency)];
    return <TableRow key={campaign.option.key}><TableCell className="min-w-[240px] max-w-[340px]"><Link href={href} className="block text-xs font-medium leading-relaxed hover:text-primary">{campaign.option.name}</Link><div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"><MetaCampaignStatus status={campaign.option.status} /><span className="text-[10px] text-muted-foreground">ID {campaign.option.campaignId}</span></div><p className="mt-1 text-[10px] text-muted-foreground">{campaign.option.accountName}{!campaign.activity ? " · sem atividade importada" : !s.complete ? " · associação incompleta" : ""}</p></TableCell>{values.map((value, i) => <TableCell key={i} className="whitespace-nowrap text-right text-xs tabular-nums">{value}</TableCell>)}<TableCell className={cn("whitespace-nowrap text-right text-xs tabular-nums", s.complete && campaign.activity && (s.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{money(campaign.activity && s.complete ? s.profit : null, currency)}</TableCell><TableCell className="whitespace-nowrap text-right"><Link href={href} aria-label={`Ver P&L de ${campaign.option.name}`} className="text-xs text-primary hover:underline">Ver P&L →</Link></TableCell></TableRow>;
  })}</TableBody></Table>;
}
