import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { getMetaPnlCatalog, getMetaPnlDays, getMetaRoasChecks } from "@/lib/trackers/meta-pnl-query";
import { getCurrentMetaCampaigns } from "@/lib/meta/campaign-catalog";
import { summariseMetaPnl, type MetaPnlDay } from "@/lib/trackers/meta-pnl";
import { mergeCurrentMetaOptions } from "@/lib/trackers/meta-presentation";
import { MONTH_NAMES, type PnlFees } from "@/lib/trackers/pnl";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/dashboard/page-header";
import { CampaignPicker } from "./campaign-picker";
import { MetaPnlSheet } from "./meta-pnl-sheet";
import { MetaCampaignBrowser } from "./meta-campaign-browser";
import type { FinanceParams } from "./finance-platform-page";

export async function MetaFinancePage({ db, userId, sp, year, month, currency, feesByMonth, range, query }: {
  db: SupabaseClient<Database>; userId: string; sp: FinanceParams; year: number; month?: number;
  currency: string; feesByMonth: PnlFees[]; range: DateRange; query: string;
}) {
  const [catalog, current] = await Promise.all([
    getMetaPnlCatalog(db, userId, year),
    getCurrentMetaCampaigns(db, userId, sp.store),
  ]);
  const storeNames = new Map(catalog.stores.map((store) => [store.id, store.shop_name || store.shop_domain]));
  const options = mergeCurrentMetaOptions(catalog.options, current.options, storeNames)
    .filter((o) => !sp.store || sp.store === "all" || o.storeId === sp.store);
  // Allocate with all competing campaigns before applying any display filter.
  const [days, roasChecks] = await Promise.all([
    getMetaPnlDays(db, userId, catalog.rows, range, currency),
    getMetaRoasChecks(db, userId, options, currency),
  ]);
  const byCampaign = new Map<string, MetaPnlDay[]>();
  for (const day of days) {
    const rows = byCampaign.get(day.key) ?? [];
    rows.push(day);
    byCampaign.set(day.key, rows);
  }
  const fees = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const overview = options.map((option) => {
    const rows = byCampaign.get(option.key) ?? [];
    return { option, summary: { ...summariseMetaPnl(rows, fees), recentMeta: roasChecks.get(option.key)?.recent }, target: rows.find((r) => r.target)?.target ?? null, activity: rows.length > 0, fire: roasChecks.get(option.key)?.signal ?? null };
  });
  const selected = options.find((o) => o.key === sp.campaign);
  const period = `${month ? MONTH_NAMES[month - 1] : "Ano"} ${year}`;
  const href = (changes: Record<string, string | null>) => pnlUrl(query, changes, "/finance/meta");
  const tabs = [{ key: "year", name: "Ano", href: href({ view: "dashboard", month: null }) },
    ...MONTH_NAMES.map((name, i) => ({ key: String(i + 1), name: name.slice(0, 3), href: href({ view: "month", month: String(i + 1) }) }))];
  return <div className="mx-auto max-w-[1440px] space-y-6">
    <PageHeader title="Meta · Finance" description="Investimento e resultados das tuas campanhas." actions={<Link href="/pnl?view=settings" className="text-xs text-muted-foreground hover:text-primary">Comissões e taxas</Link>} />
    <nav aria-label="Período financeiro" className="flex items-center gap-1 overflow-x-auto rounded-lg border border-border bg-card p-1 scrollbar-thin">{tabs.map((tab) => <Link key={tab.key} href={tab.href} aria-current={(month ? String(month) : "year") === tab.key ? "page" : undefined} className={cn("whitespace-nowrap rounded-md px-3 py-2 text-sm transition-colors", (month ? String(month) : "year") === tab.key ? "bg-primary/10 font-medium text-primary" : "text-muted-foreground hover:bg-accent")}>{tab.name}</Link>)}<span className="ml-auto px-3 text-xs text-muted-foreground">{year}</span></nav>
    {sp.campaign && <div className="space-y-3"><Link href={href({ campaign: null, collection: null })} className="inline-block text-sm text-primary hover:underline">← Todas as campanhas</Link><details className="text-xs text-muted-foreground"><summary className="mb-2 cursor-pointer">Mudar de campanha</summary><CampaignPicker options={options} selectedKey={selected?.key ?? ""} platform="Meta" /></details></div>}
    {selected ? <MetaPnlSheet campaign={selected} rows={byCampaign.get(selected.key) ?? []} year={year} month={month} currency={currency} feesByMonth={feesByMonth} query={query} basePath="/finance/meta" fire={roasChecks.get(selected.key)?.signal} roasCheck={roasChecks.get(selected.key)} /> : sp.campaign ? <p role="status" className="text-sm text-muted-foreground">Esta campanha não está disponível na loja e no ano selecionados.</p> : !options.length ? <Card className="space-y-2 p-6"><h2 className="text-sm font-medium">Ainda sem campanhas Meta importadas</h2><p className="text-xs text-muted-foreground">Confirma a ligação Meta e a loja associada.</p><Link href="/connections" className="inline-block text-xs text-primary">Ver ligações →</Link></Card> : <>
      <MetaCampaignBrowser key={query} campaigns={overview} currency={currency} query={query} period={period} statusUnavailable={current.unavailable.length > 0} />
    </>}
  </div>;
}
