import Link from "next/link";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONTH_NAMES, daysInMonth, type PnlFees } from "@/lib/trackers/pnl";
import { summariseMetaPnl, type MetaPnlDay } from "@/lib/trackers/meta-pnl";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";
import { money, pct, mult } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";
import { MetaCampaignStatus } from "./meta-performance";
import { MetaFinanceSummary } from "./meta-finance-summary";
import { CampaignSheet } from "./campaign-sheet";
import { MetaRoasBadge } from "./meta-roas-badge";
import { META_FIRE_ROAS, type MetaRoasSignal, type MetaRoasCheck } from "@/lib/trackers/meta-roas";

export function MetaPnlSheet({ campaign, rows, year, month, currency, feesByMonth, query, basePath = "/pnl", fire, roasCheck }: {
  campaign: MetaPnlOption;
  rows: MetaPnlDay[];
  year: number;
  /** Undefined = annual dashboard. */
  month?: number;
  currency: string;
  feesByMonth: PnlFees[];
  query: string;
  basePath?: string;
  fire?: MetaRoasSignal | null;
  roasCheck?: MetaRoasCheck;
}) {
  const feesForDate = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const total = { ...summariseMetaPnl(rows, feesForDate), recentMeta: roasCheck?.recent };
  const groups = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, index) => {
    const n = index + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      : `${year}-${String(n).padStart(2, "0")}`;
    const days = rows.filter((row) => row.date.startsWith(prefix));
    return {
      key: prefix, label: month ? `${String(n).padStart(2, "0")}/${String(month).padStart(2, "0")}` : MONTH_NAMES[index],
      href: month ? null : pnlUrl(query, { view: "month", month: String(n) }, basePath),
      days, summary: summariseMetaPnl(days, feesForDate),
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <MetaRoasBadge signal={fire} />
          <h2 className="text-lg font-medium">{campaign.name}</h2>
          <MetaCampaignStatus status={campaign.status} />
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{campaign.storeName} · {campaign.accountName} · {month ? MONTH_NAMES[month - 1] : "Ano"} {year}</p>
        {campaign.campaignId && <p className="mt-1 text-xs text-muted-foreground">ID {campaign.campaignId}</p>}
      </div>

      <MetaFinanceSummary summary={total} currency={currency} available={rows.length > 0} label={`${month ? MONTH_NAMES[month - 1] : "Ano"} ${year} · Resultados da campanha`} />
      {roasCheck && <section aria-label="Consistência do ROAS Meta" className="rounded-lg border border-border bg-card p-4">
        <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-medium">Últimos 3 dias completos</h3><span className="text-xs text-muted-foreground">{roasCheck.qualifiedDays}/3 dias com ROAS ≥ {META_FIRE_ROAS}x</span></div>
        <div className="mt-3 grid grid-cols-3 gap-3">{roasCheck.days.map((day) => <div key={day.date} className="rounded-md bg-muted/30 p-3"><p className="text-[11px] text-muted-foreground">{day.date.slice(8)}/{day.date.slice(5, 7)}</p><p className={cn("mt-1 text-lg font-semibold tabular-nums", day.roas != null && (day.roas >= META_FIRE_ROAS ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground"))}>{mult(day.roas)}</p></div>)}</div>
        <p className="mt-3 text-xs text-muted-foreground">{fire ? "A campanha cumpre a regra do 🔥." : "O 🔥 aparece quando os três dias atingem pelo menos 3x."} O dia de hoje não entra nesta avaliação. Um dia sem gasto ou sem dados não cumpre a regra.</p>
      </section>}
      {!rows.length && <p className="text-sm text-muted-foreground">Sem atividade importada para esta campanha neste período.</p>}

      <details className="rounded-lg border border-border bg-card p-4 text-sm">
        <summary className="cursor-pointer font-medium">Como são calculados estes valores</summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>A receita e os custos Shopify seguem os artigos comprados e os produtos confirmados na coleção, mesmo quando a entrada foi por outra página ou a encomenda contém outros artigos. Entre campanhas que anunciam o mesmo produto, a partilha segue as compras reportadas pela Meta; sem compras, segue o gasto. Cada artigo é repartido uma única vez.</p>
          <p>Esta estimativa pode incluir vendas orgânicas e diferir da atribuição da Meta. Exclui encomendas de Google Ads identificadas, testes e cancelamentos. As colunas «Receita Meta» e «Compras Meta» mostram o que a Meta reporta, separadamente da receita usada no lucro.</p>
          <p>Os resumos usam o ROAS Facebook dos últimos 2 dias completos. As linhas da folha mantêm o ROAS histórico de cada dia ou mês.</p>
          <p>Os COGS usam a sheet do fornecedor e as regras de custos da app. Inclui portes cobrados e reembolsos; as taxas de pagamento e comissões seguem as definições gerais da P&L. «Encomendas» pode ter decimais devido à partilha. Os valores desta vista são de consulta.</p>
          <p>COGS da sheet nas vendas repartidas: <span className="font-medium text-foreground">{money(total.sheetCogs, currency)}</span> · Outras regras de COGS: <span className="font-medium text-foreground">{money(total.input.cogs - total.sheetCogs, currency)}</span>.</p>
        </div>
      </details>

      <CampaignSheet title={campaign.name} period={`${month ? MONTH_NAMES[month - 1] : "Ano"} ${year}`}>
        <Table>
          <TableHeader><TableRow>
            {[month ? "Dia" : "Mês", "Enc. est.", "Receita bruta", "Reembolsos", "Receita líquida", "COGS", "Meta Ads", "Pagamento", "Comissão", "Lucro est.", "Margem", "COGS %", "ROAS est.", "Compras Meta", "Receita Meta", "ROAS Meta", "Associação"].map((label, i) =>
              <TableHead key={label} data-detail={[2,3,7,8,11,13].includes(i)} className={cn("whitespace-nowrap text-[10px] uppercase tracking-wide", i > 0 && "text-right")}>{label}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {groups.map((group) => <TableRow key={group.key} className={!group.days.length ? "text-muted-foreground" : undefined}>
              <TableCell className="whitespace-nowrap font-medium">{group.href ? <Link className="hover:text-primary" href={group.href}>{group.label}</Link> : group.label}</TableCell>
              {cells(group.summary, group.days.length > 0)}
              <TableCell className="text-right text-xs text-muted-foreground" title={!group.days.length ? "Sem atividade importada" : !group.summary.complete
                  ? [...new Set(group.days.map((d) => d.reason).filter(Boolean))].join(" · ")
                  : group.days.some((d) => d.via === "name") ? "Estimada pelo nome" : "Estimada pelo destino"}>
                {!group.days.length ? "—" : !group.summary.complete ? "Por apurar" : group.days.some((d) => d.via === "name") ? "Nome" : "Destino"}
              </TableCell>
            </TableRow>)}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>{cells(total, rows.length > 0)}
              <TableCell className="text-right text-xs">{total.complete ? "Estimativa" : "Por apurar"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </CampaignSheet>
    </div>
  );

  function cells(summary: ReturnType<typeof summariseMetaPnl>, active: boolean) {
    const known = <T,>(value: T) => summary.complete || summary.financialActivity ? value : null;
    const fields = [
      summary.complete ? summary.input.orders.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : "—",
      money(known(summary.input.grossRevenue), currency), money(known(summary.input.refunds), currency),
      money(known(summary.net), currency), money(known(summary.input.cogs), currency),
      money(summary.input.adspendFb, currency), money(known(summary.paymentFees), currency),
      money(summary.agencyFees, currency), money(known(summary.profit), currency),
      pct(known(summary.margin)), pct(known(summary.cogsImpact)), mult(known(summary.roas)),
      summary.metaPurchases.toLocaleString("pt-PT"), money(summary.metaRevenue, currency), mult(summary.metaRoas),
    ];
    return fields.map((value, i) => <TableCell key={i} data-detail={[1,2,6,7,10,12].includes(i)} className={cn("whitespace-nowrap text-right text-xs tabular-nums", i === 8 && active && summary.complete && (summary.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{active ? value : "—"}</TableCell>);
  }
}
