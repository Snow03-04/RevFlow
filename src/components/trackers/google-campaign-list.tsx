import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import type { GoogleCollectionCampaign } from "@/lib/trackers/google-collections";
import type { summariseGooglePnl } from "@/lib/trackers/google-pnl";
import type { GoogleScaleSignal, ScaleMetric } from "@/lib/trackers/google-scale";
import type { CampaignChange } from "@/lib/google/change-history";
import { changeDateLabel } from "@/lib/google/change-events";
import { money, mult } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { GoogleCampaignSignals, ScaleBadge } from "./google-campaign-signals";
import { googleAdMoney, googleStatusLabel } from "./google-performance";

export type GoogleCampaignOverview = {
  option: GoogleCollectionCampaign; summary: ReturnType<typeof summariseGooglePnl>; activity: boolean;
  signal?: GoogleScaleSignal; changes: CampaignChange[];
};

export function GoogleCampaignList({ campaigns, currency, query, today }: {
  campaigns: GoogleCampaignOverview[]; currency: string; query: string; today: string;
}) {
  if (!campaigns.length) return <p className="p-4 text-xs text-muted-foreground">Sem campanhas ativas associadas a esta coleção.</p>;
  function info(c: GoogleCampaignOverview) {
    const latest = [...c.changes].sort((a, b) => b.changed_at.localeCompare(a.changed_at))[0];
    return latest ? `Alterada ${changeDateLabel(latest.changed_at, today)}` : "Data da alteração por confirmar";
  }
  const href = (c: GoogleCampaignOverview) => pnlUrl(query, { campaign: c.option.key, collection: null }, "/finance/google");
  const profit = (c: GoogleCampaignOverview) => c.activity && c.summary.spendKnown ? c.summary.profit : null;
  const profitValue = (c: GoogleCampaignOverview) => <span className={cn(profit(c) != null && (profit(c)! < 0 ? "text-red-600 dark:text-red-400" : "text-emerald-600 dark:text-emerald-400"))}>{money(profit(c), currency)}{profit(c) != null && !c.summary.complete && <span className="ml-1 text-[10px] text-muted-foreground">parcial</span>}</span>;
  const diagnostics = (c: GoogleCampaignOverview) => <details className="mt-2 text-[11px] text-muted-foreground"><summary className="cursor-pointer">Sinais e alterações</summary><GoogleCampaignSignals signal={c.signal} changes={c.changes} today={today} currency={currency} expanded /></details>;
  return <>
    <div className="hidden md:block"><Table aria-label="Resultados das campanhas Google"><TableHeader><TableRow className="bg-muted/20 hover:bg-muted/20">{["Campanha", "Gasto bruto", "Receita ident.", "Lucro ident.", "Google / equilíbrio", "Shopify / equilíbrio", ""].map((label, i) => <TableHead key={i} className={cn("whitespace-nowrap text-[10px]", i ? "text-right" : "w-[32%]")}>{label || <span className="sr-only">Detalhes</span>}</TableHead>)}</TableRow></TableHeader><TableBody>{campaigns.map((c) => <TableRow key={c.option.key}>
      <TableCell className="min-w-[225px] py-4"><Link href={href(c)} className="text-sm font-medium hover:text-primary">{c.option.name}</Link><div className="mt-1.5 flex flex-wrap gap-x-3 gap-y-1"><GoogleCampaignStatus status={c.option.status} /><span className="text-[10px] text-muted-foreground">{info(c)}</span></div>{diagnostics(c)}</TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{googleAdMoney(c.summary.adCoverage, "grossSpend", currency)}</TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{money(c.activity ? c.summary.net : null, currency)}</TableCell>
      <TableCell className="whitespace-nowrap text-right text-sm tabular-nums">{profitValue(c)}</TableCell>
      <TableCell className="text-right"><GoogleRoasMetric metric={c.signal?.google} signal={c.signal} /></TableCell>
      <TableCell className="text-right"><GoogleRoasMetric metric={c.signal?.shopify} signal={c.signal} /></TableCell>
      <TableCell className="pl-0"><Link href={href(c)} aria-label={`Ver P&L de ${c.option.name}`} className="inline-flex rounded-md p-2 text-muted-foreground hover:bg-primary/10 hover:text-primary"><ArrowUpRight aria-hidden className="h-4 w-4" /></Link></TableCell>
    </TableRow>)}</TableBody></Table></div>
    <div className="divide-y divide-border md:hidden">{campaigns.map((c) => <article key={c.option.key} className="space-y-4 p-4">
      <div><div className="flex items-center justify-between"><GoogleCampaignStatus status={c.option.status} /><Link href={href(c)} aria-label={`Ver P&L de ${c.option.name}`} className="p-1 text-muted-foreground"><ArrowUpRight aria-hidden className="h-4 w-4" /></Link></div><Link href={href(c)} className="mt-2 block text-sm font-medium">{c.option.name}</Link><p className="mt-1 text-[10px] text-muted-foreground">{info(c)}</p></div>
      <dl className="grid grid-cols-2 gap-4"><div><dt className="text-[10px] text-muted-foreground">Gasto bruto</dt><dd className="mt-1 text-sm tabular-nums">{googleAdMoney(c.summary.adCoverage, "grossSpend", currency)}</dd></div><div><dt className="text-[10px] text-muted-foreground">Receita identificada</dt><dd className="mt-1 text-sm tabular-nums">{money(c.activity ? c.summary.net : null, currency)}</dd></div><div><dt className="mb-1 text-[10px] text-muted-foreground">Google / equilíbrio</dt><dd><GoogleRoasMetric metric={c.signal?.google} signal={c.signal} /></dd></div><div><dt className="mb-1 text-[10px] text-muted-foreground">Shopify / equilíbrio</dt><dd><GoogleRoasMetric metric={c.signal?.shopify} signal={c.signal} /></dd></div></dl>
      <div className="flex justify-between border-t border-border/60 pt-3 text-xs"><span className="text-muted-foreground">Lucro identificado</span><span className="tabular-nums">{profitValue(c)}</span></div>{diagnostics(c)}
    </article>)}</div>
  </>;
}

function GoogleRoasMetric({ metric, signal }: { metric?: ScaleMetric; signal?: GoogleScaleSignal }) {
  return <div className="space-y-1" title={signal?.reason ?? (signal?.range ? `${signal.range.from}–${signal.range.to} · desde a última alteração` : "Sem dados desde a última alteração")}>
    <p className="whitespace-nowrap text-sm tabular-nums">{mult(metric?.roas ?? null)}<span className="text-[11px] text-muted-foreground"> / {mult(signal?.breakEven ?? null)}</span></p>
    <ScaleBadge level={metric?.level ?? null} />
    {metric?.roas == null && <p className="text-[10px] text-muted-foreground">{signal?.expectedDays === 0 ? "A aguardar dias completos" : "Dados por apurar"}</p>}
    {metric?.roas != null && !metric.level && signal && signal.expectedDays < 5 && <p className="text-[10px] text-muted-foreground">{signal.expectedDays}/5 dias completos</p>}
  </div>;
}

export function GoogleCampaignStatus({ status }: { status?: string | null }) {
  const active = status === "ENABLED";
  return <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap text-xs", active ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}><span aria-hidden className={cn("h-1.5 w-1.5 rounded-full", active ? "bg-emerald-500" : "bg-muted-foreground/50")} />{active ? "Online" : googleStatusLabel(status)}</span>;
}
