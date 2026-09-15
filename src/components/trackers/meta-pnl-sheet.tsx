import Link from "next/link";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { MONTH_NAMES, daysInMonth, type PnlFees } from "@/lib/trackers/pnl";
import { summariseMetaPnl, type MetaPnlDay } from "@/lib/trackers/meta-pnl";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";
import { money, pct, mult } from "@/lib/trackers/format";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";

export function MetaPnlSheet({ campaign, rows, year, month, currency, feesByMonth, query }: {
  campaign: MetaPnlOption;
  rows: MetaPnlDay[];
  year: number;
  /** Undefined = annual dashboard. */
  month?: number;
  currency: string;
  feesByMonth: PnlFees[];
  query: string;
}) {
  const feesForDate = (date: string) => feesByMonth[Number(date.slice(5, 7)) - 1];
  const total = summariseMetaPnl(rows, feesForDate);
  const available = <T,>(value: T) => total.complete ? value : null;
  const kpis = [
    { label: "Receita líquida estimada", value: money(available(total.net), currency) },
    { label: "Lucro estimado", value: money(available(total.profit), currency), profit: true },
    { label: "COGS", value: money(available(total.input.cogs), currency) },
    { label: "COGS Impact", value: pct(available(total.cogsImpact)) },
    { label: "Meta Ads", value: money(total.input.adspendFb, currency) },
    { label: "ROAS estimado", value: mult(available(total.roas)) },
  ];
  const groups = Array.from({ length: month ? daysInMonth(year, month) : 12 }, (_, index) => {
    const n = index + 1;
    const prefix = month ? `${year}-${String(month).padStart(2, "0")}-${String(n).padStart(2, "0")}`
      : `${year}-${String(n).padStart(2, "0")}`;
    const days = rows.filter((row) => row.date.startsWith(prefix));
    return {
      key: prefix, label: month ? `${String(n).padStart(2, "0")}/${String(month).padStart(2, "0")}` : MONTH_NAMES[index],
      href: month ? null : pnlUrl(query, { view: "month", month: String(n) }),
      days, summary: summariseMetaPnl(days, feesForDate),
    };
  });

  return (
    <div className="space-y-5">
      <div>
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-lg font-medium">{campaign.name}</h2>
          <span className="rounded-full bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary">P&L estimada · Meta</span>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">{campaign.storeName} · {campaign.accountName} · {month ? MONTH_NAMES[month - 1] : "Ano"} {year}</p>
        <p className="mt-1 text-xs text-muted-foreground">ID {campaign.campaignId} · Consulta dos dados importados</p>
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3 xl:grid-cols-6">
        {kpis.map((k) => <Card key={k.label} className="p-4">
          <p className="text-xs text-muted-foreground">{k.label}</p>
          <p className={cn("mt-2 text-lg font-semibold tabular-nums", k.profit && total.complete && (total.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{k.value}</p>
        </Card>)}
      </div>

      {!total.complete && <div role="status" className="rounded-lg border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
        Existem dias sem associação suficiente entre a campanha e as vendas Shopify. A receita estimada, os COGS e o lucro total ficam por apurar. O gasto e a receita reportada pela Meta continuam visíveis na tabela.
      </div>}
      {!rows.length && <p className="text-sm text-muted-foreground">Sem atividade importada para esta campanha neste período.</p>}

      <details className="rounded-lg border border-border bg-card p-4 text-sm" open>
        <summary className="cursor-pointer font-medium">Como são calculados estes valores</summary>
        <div className="mt-3 space-y-2 text-xs leading-relaxed text-muted-foreground">
          <p>A receita e os custos Shopify são repartidos por produto ou pela coleção de entrada, no dia da encomenda. Entre campanhas do mesmo destino, a partilha segue as compras reportadas pela Meta; sem compras, segue o gasto. Uma encomenda é repartida uma única vez.</p>
          <p>Esta estimativa pode incluir vendas orgânicas e diferir da atribuição da Meta. Exclui encomendas de Google Ads identificadas, testes e cancelamentos. As colunas «Receita Meta» e «Compras Meta» mostram o que a Meta reporta, separadamente da receita usada no lucro.</p>
          <p>Os COGS usam a sheet do fornecedor e as regras de custos da app. Inclui portes cobrados e reembolsos; as taxas de pagamento e comissões seguem as definições gerais da P&L. «Encomendas» pode ter decimais devido à partilha. Os valores desta vista são de consulta.</p>
          <p>COGS da sheet nas vendas repartidas: <span className="font-medium text-foreground">{money(total.sheetCogs, currency)}</span> · Outras regras de COGS: <span className="font-medium text-foreground">{money(total.input.cogs - total.sheetCogs, currency)}</span>.</p>
        </div>
      </details>

      <Card className="overflow-hidden">
        <Table>
          <TableHeader><TableRow>
            {[month ? "Dia" : "Mês", "Encomendas (est.)", "Receita bruta", "Reembolsos", "Receita líquida", "COGS", "Meta Ads", "Pagamento", "Comissão Meta", "Lucro (est.)", "Margem", "COGS Impact", "ROAS (est.)", "Compras Meta", "Receita Meta", "Associação"].map((label, i) =>
              <TableHead key={label} className={cn("whitespace-nowrap", i > 0 && "text-right")}>{label}</TableHead>)}
          </TableRow></TableHeader>
          <TableBody>
            {groups.map((group) => <TableRow key={group.key} className={!group.days.length ? "text-muted-foreground" : undefined}>
              <TableCell className="whitespace-nowrap font-medium">{group.href ? <Link className="hover:text-primary" href={group.href}>{group.label}</Link> : group.label}</TableCell>
              {cells(group.summary)}
              <TableCell className="min-w-[180px] text-right text-xs text-muted-foreground">
                {!group.days.length ? "Sem atividade importada" : !group.summary.complete
                  ? [...new Set(group.days.map((d) => d.reason).filter(Boolean))].join(" · ")
                  : group.days.some((d) => d.via === "name") ? "Estimada pelo nome" : "Estimada pelo destino"}
              </TableCell>
            </TableRow>)}
            <TableRow className="bg-muted/40 font-semibold">
              <TableCell>Total</TableCell>{cells(total)}
              <TableCell className="text-right text-xs">{total.complete ? "Estimativa" : "Por apurar"}</TableCell>
            </TableRow>
          </TableBody>
        </Table>
      </Card>
    </div>
  );

  function cells(summary: ReturnType<typeof summariseMetaPnl>) {
    const known = <T,>(value: T) => summary.complete ? value : null;
    const fields = [
      summary.complete ? summary.input.orders.toLocaleString("pt-PT", { maximumFractionDigits: 2 }) : "—",
      money(known(summary.input.grossRevenue), currency), money(known(summary.input.refunds), currency),
      money(known(summary.net), currency), money(known(summary.input.cogs), currency),
      money(summary.input.adspendFb, currency), money(known(summary.paymentFees), currency),
      money(summary.agencyFees, currency), money(known(summary.profit), currency),
      pct(known(summary.margin)), pct(known(summary.cogsImpact)), mult(known(summary.roas)),
      summary.metaPurchases.toLocaleString("pt-PT"), money(summary.metaRevenue, currency),
    ];
    return fields.map((value, i) => <TableCell key={i} className={cn("whitespace-nowrap text-right tabular-nums", i === 8 && summary.complete && (summary.profit < 0 ? "text-red-400" : "text-emerald-400"))}>{value}</TableCell>);
  }
}
