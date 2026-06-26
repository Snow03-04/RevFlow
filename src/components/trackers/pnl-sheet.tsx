"use client";

import { useMemo, useState, useTransition } from "react";
import { Download, Loader2 } from "lucide-react";
import type { Tables } from "@/types/database";
import {
  calcPnlDay,
  daysInMonth,
  marginBand,
  type PnlFees,
} from "@/lib/trackers/pnl";
import { money, pct, mult, bandText } from "@/lib/trackers/format";
import {
  savePnlDay,
  savePnlMonthOverride,
  autofillPnlMonth,
} from "@/lib/trackers/actions";
import { NumCell, TextCell, PctCell, useDebouncedSave } from "@/components/trackers/cells";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DayRow {
  gross: number;
  refunds: number;
  cogs: number;
  adFb: number;
  adGoogle: number;
  notes: string;
}

const WEEKDAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export function PnlSheet({
  year,
  month,
  currency,
  defaultFees,
  override,
  initialDays,
}: {
  year: number;
  month: number;
  currency: string;
  defaultFees: PnlFees;
  override: Tables<"pnl_month_overrides"> | null;
  initialDays: Tables<"pnl_days">[];
}) {
  const n = daysInMonth(year, month);
  const debounce = useDebouncedSave();

  const [fees, setFees] = useState<PnlFees>({
    feeFb: override?.agency_fee_fb != null ? Number(override.agency_fee_fb) : defaultFees.feeFb,
    feeGoogle:
      override?.agency_fee_google != null
        ? Number(override.agency_fee_google)
        : defaultFees.feeGoogle,
    txFee:
      override?.transaction_fee != null
        ? Number(override.transaction_fee)
        : defaultFees.txFee,
  });

  const [rows, setRows] = useState<DayRow[]>(() => {
    const byDay = new Map(initialDays.map((d) => [d.day, d]));
    return Array.from({ length: n }, (_, i) => {
      const d = byDay.get(i + 1);
      return {
        gross: Number(d?.gross_revenue ?? 0),
        refunds: Number(d?.refunds ?? 0),
        cogs: Number(d?.cogs ?? 0),
        adFb: Number(d?.adspend_fb ?? 0),
        adGoogle: Number(d?.adspend_google ?? 0),
        notes: d?.notes ?? "",
      };
    });
  });

  function persistDay(day: number, r: DayRow) {
    debounce(`day-${day}`, () => {
      savePnlDay({
        year,
        month,
        day,
        gross_revenue: r.gross,
        refunds: r.refunds,
        cogs: r.cogs,
        adspend_fb: r.adFb,
        adspend_google: r.adGoogle,
        notes: r.notes || null,
      });
    });
  }

  function updateRow(idx: number, patch: Partial<DayRow>) {
    setRows((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], ...patch };
      persistDay(idx + 1, next[idx]);
      return next;
    });
  }

  function updateFees(patch: Partial<PnlFees>) {
    setFees((prev) => {
      const next = { ...prev, ...patch };
      debounce("override", () =>
        savePnlMonthOverride({
          year,
          month,
          agency_fee_fb: next.feeFb,
          agency_fee_google: next.feeGoogle,
          transaction_fee: next.txFee,
        }),
      );
      return next;
    });
  }

  // Compute every row + running cumulative profit.
  const computed = useMemo(() => {
    let cumulative = 0;
    return rows.map((r) => {
      const c = calcPnlDay(
        {
          grossRevenue: r.gross,
          refunds: r.refunds,
          cogs: r.cogs,
          adspendFb: r.adFb,
          adspendGoogle: r.adGoogle,
        },
        fees,
      );
      cumulative += c.profit;
      return { ...c, cumulative };
    });
  }, [rows, fees]);

  const C = currency;

  const [importing, startImport] = useTransition();
  function runImport() {
    if (
      !confirm(
        "Importar Gross Revenue, Refunds, COGS (Shopify) e Adspend FB (Meta) deste mês? Substitui esses campos; mantém Adspend Google e Notes.",
      )
    )
      return;
    startImport(async () => {
      const res = await autofillPnlMonth(year, month);
      if (!res.ok) alert(res.error ?? "Falha ao importar.");
      else window.location.reload();
    });
  }

  return (
    <div className="space-y-4">
      {/* Yellow per-month assumptions */}
      <div className="flex flex-wrap items-center gap-6 rounded-xl border border-amber-500/20 bg-amber-500/5 p-4">
        <span className="text-sm font-medium text-amber-400">
          Pressupostos deste mês
        </span>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Agency Fee FB
          <PctCell value={fees.feeFb} onChange={(v) => updateFees({ feeFb: v })} />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Agency Fee Google
          <PctCell
            value={fees.feeGoogle}
            onChange={(v) => updateFees({ feeGoogle: v })}
          />
        </label>
        <label className="flex items-center gap-2 text-sm text-muted-foreground">
          Transaction Fee
          <PctCell value={fees.txFee} onChange={(v) => updateFees({ txFee: v })} />
        </label>
        <div className="ml-auto flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            Guardado automaticamente
          </span>
          <Button variant="outline" size="sm" onClick={runImport} disabled={importing}>
            {importing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Download className="h-4 w-4" />
            )}
            Importar do Shopify/Meta
          </Button>
        </div>
      </div>

      <div className="max-h-[72vh] overflow-auto rounded-xl border border-border scrollbar-thin">
        <table className="w-full min-w-[1100px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-[11px] uppercase tracking-wide text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-card">
              <th className="sticky left-0 top-0 z-30 bg-card px-2 py-2 text-left">Date</th>
              <th className="px-2 py-2 text-right text-sky-400">Gross Rev</th>
              <th className="px-2 py-2 text-right text-sky-400">Refunds</th>
              <th className="px-2 py-2 text-right">Net Rev</th>
              <th className="px-2 py-2 text-right text-sky-400">COGS</th>
              <th className="px-2 py-2 text-right text-sky-400">Ad FB</th>
              <th className="px-2 py-2 text-right text-sky-400">Ad Google</th>
              <th className="px-2 py-2 text-right">Fee FB</th>
              <th className="px-2 py-2 text-right">Fee Google</th>
              <th className="px-2 py-2 text-right">Tx Fee</th>
              <th className="px-2 py-2 text-right">Total Costs</th>
              <th className="px-2 py-2 text-right">Profit</th>
              <th className="px-2 py-2 text-right">Margin</th>
              <th className="px-2 py-2 text-right">COG %</th>
              <th className="px-2 py-2 text-right text-purple-400">ROAS</th>
              <th className="px-2 py-2 text-right">Cumul.</th>
              <th className="px-2 py-2 text-left text-sky-400">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const day = i + 1;
              const c = computed[i];
              const band = marginBand(c.marginPct);
              const date = new Date(year, month - 1, day);
              return (
                <tr key={day} className="border-b border-border/50">
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 text-muted-foreground">
                    {String(day).padStart(2, "0")} · {WEEKDAYS[date.getDay()]}
                  </td>
                  <td className="p-0">
                    <NumCell value={r.gross} onChange={(v) => updateRow(i, { gross: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.refunds} onChange={(v) => updateRow(i, { refunds: v })} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(c.netRevenue, C)}</td>
                  <td className="p-0">
                    <NumCell value={r.cogs} onChange={(v) => updateRow(i, { cogs: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.adFb} onChange={(v) => updateRow(i, { adFb: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.adGoogle} onChange={(v) => updateRow(i, { adGoogle: v })} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{money(c.agencyFeeFb, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{money(c.agencyFeeGoogle, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{money(c.transactionFee, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{money(c.totalCosts, C)}</td>
                  <td className={cn("px-2 py-1 text-right font-medium tabular-nums", bandText[band])}>{money(c.profit, C)}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums", bandText[band])}>{pct(c.marginPct)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-muted-foreground">{pct(c.cogImpactPct)}</td>
                  <td className="px-2 py-1 text-right tabular-nums text-purple-400">{mult(c.roas)}</td>
                  <td className="px-2 py-1 text-right tabular-nums">{money(c.cumulative, C)}</td>
                  <td className="p-0 min-w-[160px]">
                    <TextCell value={r.notes} onChange={(v) => updateRow(i, { notes: v })} placeholder="…" />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
