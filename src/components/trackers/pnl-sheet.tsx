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
import { NumCell, TextCell, PctCell, MoneyCell, useDebouncedSave } from "@/components/trackers/cells";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface DayRow {
  gross: number;
  refunds: number;
  cogs: number;
  adFb: number;
  adGoogle: number;
  orders: number;
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
        orders: Number(d?.orders ?? 0),
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
        orders: r.orders,
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
          orders: r.orders,
        },
        fees,
      );
      cumulative += c.profit;
      return { ...c, cumulative };
    });
  }, [rows, fees]);

  // Month totals — recomputed live whenever a row or a fee assumption changes.
  const totals = useMemo(() => {
    const t = {
      orders: 0,
      gross: 0,
      refunds: 0,
      netRevenue: 0,
      cogs: 0,
      adFb: 0,
      adGoogle: 0,
      agencyFeeFb: 0,
      agencyFeeGoogle: 0,
      transactionFee: 0,
      totalCosts: 0,
      profit: 0,
    };
    rows.forEach((r, i) => {
      const c = computed[i];
      t.orders += r.orders;
      t.gross += r.gross;
      t.refunds += r.refunds;
      t.netRevenue += c.netRevenue;
      t.cogs += r.cogs;
      t.adFb += r.adFb;
      t.adGoogle += r.adGoogle;
      t.agencyFeeFb += c.agencyFeeFb;
      t.agencyFeeGoogle += c.agencyFeeGoogle;
      t.transactionFee += c.transactionFee;
      t.totalCosts += c.totalCosts;
      t.profit += c.profit;
    });
    const adspend = t.adFb + t.adGoogle;
    return {
      ...t,
      marginPct: t.netRevenue === 0 ? null : t.profit / t.netRevenue,
      cogImpactPct: t.netRevenue === 0 ? null : t.cogs / t.netRevenue,
      roas: adspend === 0 ? null : t.netRevenue / adspend,
    };
  }, [rows, computed]);

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
      {/* Per-month assumptions — kept visually quiet so it doesn't compete with the sheet. */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3 rounded-lg border border-border bg-muted/20 px-4 py-2.5">
        <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
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
          Transaction Fee (por encomenda)
          <MoneyCell
            value={fees.txFee}
            onChange={(v) => updateFees({ txFee: v })}
            currency={C}
          />
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
              <th className="border-l border-border/60 px-2 py-2 text-right text-sky-400">Enc.</th>
              <th className="px-2 py-2 text-right text-sky-400">Gross Rev</th>
              <th className="px-2 py-2 text-right text-sky-400">Refunds</th>
              <th className="px-2 py-2 text-right">Net Rev</th>
              <th className="border-l border-border/60 px-2 py-2 text-right text-sky-400">COGS</th>
              <th className="px-2 py-2 text-right text-sky-400">Ad FB</th>
              <th className="px-2 py-2 text-right text-sky-400">Ad Google</th>
              <th className="px-2 py-2 text-right">Fee FB</th>
              <th className="px-2 py-2 text-right">Fee Google</th>
              <th className="px-2 py-2 text-right">Tx Fee</th>
              <th className="px-2 py-2 text-right">Total Costs</th>
              <th className="border-l border-border/60 px-2 py-2 text-right">Profit</th>
              <th className="px-2 py-2 text-right">Margin</th>
              <th className="px-2 py-2 text-right">COG %</th>
              <th className="px-2 py-2 text-right text-primary">ROAS</th>
              <th className="px-2 py-2 text-right">Cumul.</th>
              <th className="border-l border-border/60 px-2 py-2 text-left text-sky-400">Notes</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => {
              const day = i + 1;
              const c = computed[i];
              const band = marginBand(c.marginPct);
              const date = new Date(year, month - 1, day);
              return (
                <tr
                  key={day}
                  className="border-b border-border/50 transition-colors even:bg-muted/20 hover:bg-muted/40"
                >
                  <td className="sticky left-0 z-10 whitespace-nowrap bg-card px-2 py-1 text-muted-foreground">
                    {String(day).padStart(2, "0")} · {WEEKDAYS[date.getDay()]}
                  </td>
                  <td className="border-l border-border/60 p-0">
                    <NumCell value={r.orders} onChange={(v) => updateRow(i, { orders: v })} step="1" />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.gross} onChange={(v) => updateRow(i, { gross: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.refunds} onChange={(v) => updateRow(i, { refunds: v })} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(c.netRevenue, C)}</td>
                  <td className="border-l border-border/60 p-0">
                    <NumCell value={r.cogs} onChange={(v) => updateRow(i, { cogs: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.adFb} onChange={(v) => updateRow(i, { adFb: v })} />
                  </td>
                  <td className="p-0">
                    <NumCell value={r.adGoogle} onChange={(v) => updateRow(i, { adGoogle: v })} />
                  </td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(c.agencyFeeFb, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(c.agencyFeeGoogle, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(c.transactionFee, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(c.totalCosts, C)}</td>
                  <td className={cn("border-l border-border/60 px-2 py-1 text-right font-medium tabular-nums whitespace-nowrap", bandText[band])}>{money(c.profit, C)}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums whitespace-nowrap", bandText[band])}>{pct(c.marginPct)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{pct(c.cogImpactPct)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-primary">{mult(c.roas)}</td>
                  <td
                    className={cn(
                      "px-2 py-1 text-right font-semibold tabular-nums whitespace-nowrap",
                      c.cumulative < 0
                        ? "text-red-400"
                        : c.cumulative > 0
                          ? "text-[#39ff14]"
                          : "text-muted-foreground",
                    )}
                  >
                    {money(c.cumulative, C)}
                  </td>
                  <td className="min-w-[160px] border-l border-border/60 p-0">
                    <TextCell value={r.notes} onChange={(v) => updateRow(i, { notes: v })} placeholder="…" />
                  </td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr className="border-t-2 border-border text-[11px] font-semibold [&>td]:sticky [&>td]:bottom-0 [&>td]:bg-card">
              <td className="sticky left-0 bottom-0 z-20 whitespace-nowrap bg-card px-2 py-2 text-left uppercase tracking-wide text-muted-foreground">
                Total
              </td>
              <td className="border-l border-border/60 px-2 py-2 text-right tabular-nums">{totals.orders}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.gross, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.refunds, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.netRevenue, C)}</td>
              <td className="border-l border-border/60 px-2 py-2 text-right tabular-nums">{money(totals.cogs, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.adFb, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.adGoogle, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(totals.agencyFeeFb, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(totals.agencyFeeGoogle, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{money(totals.transactionFee, C)}</td>
              <td className="px-2 py-2 text-right tabular-nums">{money(totals.totalCosts, C)}</td>
              <td
                className={cn(
                  "border-l border-border/60 px-2 py-2 text-right tabular-nums",
                  totals.profit < 0 ? "text-red-400" : totals.profit > 0 ? "text-[#39ff14]" : "text-muted-foreground",
                )}
              >
                {money(totals.profit, C)}
              </td>
              <td className={cn("px-2 py-2 text-right tabular-nums", bandText[marginBand(totals.marginPct)])}>{pct(totals.marginPct)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-muted-foreground">{pct(totals.cogImpactPct)}</td>
              <td className="px-2 py-2 text-right tabular-nums text-primary">{mult(totals.roas)}</td>
              <td
                className={cn(
                  "px-2 py-2 text-right tabular-nums",
                  totals.profit < 0 ? "text-red-400" : totals.profit > 0 ? "text-[#39ff14]" : "text-muted-foreground",
                )}
              >
                {money(totals.profit, C)}
              </td>
              <td className="border-l border-border/60 px-2 py-2"></td>
            </tr>
          </tfoot>
        </table>
      </div>
    </div>
  );
}
