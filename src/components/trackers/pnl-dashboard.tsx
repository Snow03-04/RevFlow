import { Card } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  MONTH_NAMES,
  marginBand,
  type MonthSummary,
} from "@/lib/trackers/pnl";
import { money, pct, mult, bandText } from "@/lib/trackers/format";
import { cn } from "@/lib/utils";

export function PnlDashboard({
  months,
  currency,
}: {
  months: MonthSummary[];
  currency: string;
}) {
  const totals = months.reduce(
    (a, m) => {
      a.gross += m.gross;
      a.net += m.net;
      a.profit += m.profit;
      a.adspend += m.adspend;
      return a;
    },
    { gross: 0, net: 0, profit: 0, adspend: 0 },
  );
  const marginPct = totals.net === 0 ? null : totals.profit / totals.net;
  const roas = totals.adspend === 0 ? null : totals.net / totals.adspend;

  const kpis = [
    { label: "Gross Revenue", value: money(totals.gross, currency) },
    { label: "Net Revenue", value: money(totals.net, currency) },
    {
      label: "Total Profit",
      value: money(totals.profit, currency),
      cls: bandText[marginBand(marginPct)],
    },
    {
      label: "Profit Margin",
      value: pct(marginPct),
      cls: bandText[marginBand(marginPct)],
    },
    { label: "ROAS", value: mult(roas), cls: "text-purple-400" },
    { label: "Total Adspend", value: money(totals.adspend, currency) },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => (
          <Card key={k.label} className="p-4">
            <p className="text-xs font-medium text-muted-foreground">{k.label}</p>
            <p className={cn("mt-1.5 text-lg font-semibold tabular-nums", k.cls)}>
              {k.value}
            </p>
          </Card>
        ))}
      </div>

      <Card>
        <div className="border-b border-border px-5 py-3">
          <h3 className="text-sm font-medium">Breakdown mensal</h3>
        </div>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Mês</TableHead>
              <TableHead className="text-right">Gross</TableHead>
              <TableHead className="text-right">Net</TableHead>
              <TableHead className="text-right">Profit</TableHead>
              <TableHead className="text-right">Margin</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {months.map((m) => {
              const band = marginBand(m.marginPct);
              return (
                <TableRow key={m.month}>
                  <TableCell className="font-medium">
                    {MONTH_NAMES[m.month - 1]}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(m.gross, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {money(m.net, currency)}
                  </TableCell>
                  <TableCell className={cn("text-right font-medium tabular-nums", bandText[band])}>
                    {money(m.profit, currency)}
                  </TableCell>
                  <TableCell className={cn("text-right tabular-nums", bandText[band])}>
                    {pct(m.marginPct)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-purple-400">
                    {mult(m.roas)}
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}
