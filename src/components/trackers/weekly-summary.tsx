"use client";

import { useMemo, useState } from "react";
import type { Tables } from "@/types/database";
import { money, pct, mult } from "@/lib/trackers/format";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const LABELS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];

interface DayAgg {
  day: number;
  spend: number;
  atc: number;
  pur: number;
  units: number;
  storeValue: number;
  netMargin: number;
  marginPct: number | null;
  roas: number | null;
  conv: number | null;
  bestCampaign: string;
}

function aggregate(day: number, rows: Tables<"roas_entries">[]): DayAgg {
  let spend = 0,
    atc = 0,
    pur = 0,
    units = 0,
    storeValue = 0,
    netMargin = 0;
  let bestCampaign = "—";
  let bestMargin = -Infinity;

  for (const r of rows) {
    const sv = Number(r.price) * Number(r.units_sold);
    const tc = Number(r.cog) * Number(r.units_sold);
    const nm = sv - tc - Number(r.total_spend);
    spend += Number(r.total_spend);
    atc += Number(r.atc);
    pur += Number(r.pur);
    units += Number(r.units_sold);
    storeValue += sv;
    netMargin += nm;
    if (r.campaign_name.trim() && nm > bestMargin) {
      bestMargin = nm;
      bestCampaign = r.campaign_name;
    }
  }

  return {
    day,
    spend,
    atc,
    pur,
    units,
    storeValue,
    netMargin,
    marginPct: storeValue === 0 ? null : netMargin / storeValue,
    roas: spend === 0 ? null : storeValue / spend,
    conv: atc === 0 ? null : pur / atc,
    bestCampaign,
  };
}

export function WeeklySummary({
  allEntries,
  currency,
}: {
  allEntries: Tables<"roas_entries">[];
  currency: string;
}) {
  const [days, setDays] = useState<number[]>([1, 2, 3, 4, 5, 6, 7]);

  const byDay = useMemo(() => {
    const m = new Map<number, Tables<"roas_entries">[]>();
    for (const e of allEntries) {
      const list = m.get(e.day) ?? [];
      list.push(e);
      m.set(e.day, list);
    }
    return m;
  }, [allEntries]);

  const aggs = days.map((d) => aggregate(d, byDay.get(d) ?? []));

  const totals = aggs.reduce(
    (a, x) => {
      a.spend += x.spend;
      a.storeValue += x.storeValue;
      a.netMargin += x.netMargin;
      a.units += x.units;
      return a;
    },
    { spend: 0, storeValue: 0, netMargin: 0, units: 0 },
  );

  const withData = aggs.filter((a) => a.spend > 0 || a.storeValue > 0);
  const bestDay = withData.reduce<DayAgg | null>(
    (b, a) => (b === null || a.netMargin > b.netMargin ? a : b),
    null,
  );
  const worstDay = withData.reduce<DayAgg | null>(
    (b, a) => (b === null || a.netMargin < b.netMargin ? a : b),
    null,
  );
  const bestRoasDay = withData.reduce<DayAgg | null>(
    (b, a) => (b === null || (a.roas ?? 0) > (b.roas ?? 0) ? a : b),
    null,
  );

  const C = currency;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Escolhe os 7 dias da semana</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-4">
            {LABELS.map((label, i) => (
              <label key={label} className="flex flex-col gap-1 text-xs text-muted-foreground">
                {label}
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={days[i]}
                  onChange={(e) => {
                    const v = Math.min(31, Math.max(1, parseInt(e.target.value) || 1));
                    setDays((prev) => prev.map((d, idx) => (idx === i ? v : d)));
                  }}
                  className="w-16 rounded-md bg-sky-500/10 px-2 py-1.5 text-center text-sm outline-none focus:bg-sky-500/20"
                />
              </label>
            ))}
          </div>
        </CardContent>
      </Card>

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Dia</TableHead>
              <TableHead className="text-right">Spend</TableHead>
              <TableHead className="text-right">ATC</TableHead>
              <TableHead className="text-right">PUR</TableHead>
              <TableHead className="text-right">Units</TableHead>
              <TableHead className="text-right">Store Value</TableHead>
              <TableHead className="text-right">Net Margin</TableHead>
              <TableHead className="text-right">Margin %</TableHead>
              <TableHead className="text-right">ROAS</TableHead>
              <TableHead className="text-right">Conv %</TableHead>
              <TableHead>Best campaign</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {aggs.map((a, i) => (
              <TableRow key={i}>
                <TableCell className="font-medium">{LABELS[i]} · {String(a.day).padStart(2, "0")}</TableCell>
                <TableCell className="text-right tabular-nums">{money(a.spend, C)}</TableCell>
                <TableCell className="text-right tabular-nums">{a.atc}</TableCell>
                <TableCell className="text-right tabular-nums">{a.pur}</TableCell>
                <TableCell className="text-right tabular-nums">{a.units}</TableCell>
                <TableCell className="text-right tabular-nums">{money(a.storeValue, C)}</TableCell>
                <TableCell className="text-right tabular-nums">{money(a.netMargin, C)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(a.marginPct)}</TableCell>
                <TableCell className="text-right tabular-nums text-purple-400">{mult(a.roas)}</TableCell>
                <TableCell className="text-right tabular-nums">{pct(a.conv)}</TableCell>
                <TableCell className="max-w-[160px] truncate text-muted-foreground">{a.bestCampaign}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
        <div className="flex flex-wrap gap-6 border-t border-border px-4 py-3 text-sm">
          <span className="text-muted-foreground">Spend semana <span className="font-medium text-foreground">{money(totals.spend, C)}</span></span>
          <span className="text-muted-foreground">Store value <span className="font-medium text-foreground">{money(totals.storeValue, C)}</span></span>
          <span className="text-muted-foreground">Net margin <span className="font-medium text-foreground">{money(totals.netMargin, C)}</span></span>
          <span className="text-muted-foreground">Units <span className="font-medium text-foreground">{totals.units}</span></span>
        </div>
      </Card>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <Highlight title="Melhor dia" value={bestDay ? `Dia ${bestDay.day} · ${money(bestDay.netMargin, C)}` : "—"} cls="text-emerald-400" />
        <Highlight title="Pior dia" value={worstDay ? `Dia ${worstDay.day} · ${money(worstDay.netMargin, C)}` : "—"} cls="text-red-400" />
        <Highlight title="Melhor ROAS" value={bestRoasDay ? `Dia ${bestRoasDay.day} · ${mult(bestRoasDay.roas)}` : "—"} cls="text-purple-400" />
      </div>
    </div>
  );
}

function Highlight({ title, value, cls }: { title: string; value: string; cls: string }) {
  return (
    <Card className="p-4">
      <p className="text-xs font-medium text-muted-foreground">{title}</p>
      <p className={`mt-1 text-base font-semibold ${cls}`}>{value}</p>
    </Card>
  );
}
