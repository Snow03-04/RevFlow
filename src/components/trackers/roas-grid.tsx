"use client";

import { useMemo, useState, useTransition } from "react";
import { Plus, Trash2, Download, Loader2 } from "lucide-react";
import type { Tables } from "@/types/database";
import {
  calcRoas,
  dayCounter,
  roasDecision,
  decisionMarginFrom,
  roasBand,
  convBand,
  type DayContextEntry,
  type RoasThresholds,
} from "@/lib/trackers/roas";
import { money, pct, mult, bandText, bandBg } from "@/lib/trackers/format";
import {
  saveRoasEntry,
  deleteRoasEntry,
  autofillRoasDay,
  autofillRoasAllDays,
  clearAllRoasEntries,
} from "@/lib/trackers/actions";
import { NumCell, TextCell, useDebouncedSave } from "@/components/trackers/cells";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Row {
  id: string;
  position: number;
  name: string;
  spend: number;
  cpc: number;
  atc: number;
  pur: number;
  price: number;
  cog: number;
  units: number;
}

function newId() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export function RoasGrid({
  day,
  initialEntries,
  prevContext,
  thresholds,
  minMargin,
  currency,
}: {
  day: number;
  initialEntries: Tables<"roas_entries">[];
  prevContext: Record<string, DayContextEntry>;
  thresholds: RoasThresholds;
  minMargin: number;
  currency: string;
}) {
  const debounce = useDebouncedSave();
  const [rows, setRows] = useState<Row[]>(() =>
    initialEntries.map((e) => ({
      id: e.id,
      position: e.position,
      name: e.campaign_name,
      spend: Number(e.total_spend),
      cpc: Number(e.cpc),
      atc: Number(e.atc),
      pur: Number(e.pur),
      price: Number(e.price),
      cog: Number(e.cog),
      units: Number(e.units_sold),
    })),
  );

  function persist(r: Row) {
    debounce(`row-${r.id}`, () =>
      saveRoasEntry({
        id: r.id,
        day,
        position: r.position,
        campaign_name: r.name,
        total_spend: r.spend,
        cpc: r.cpc,
        atc: r.atc,
        pur: r.pur,
        price: r.price,
        cog: r.cog,
        units_sold: r.units,
      }),
    );
  }

  function update(id: string, patch: Partial<Row>) {
    setRows((prev) => {
      const next = prev.map((r) => (r.id === id ? { ...r, ...patch } : r));
      const changed = next.find((r) => r.id === id);
      if (changed) persist(changed);
      return next;
    });
  }

  function addRow() {
    const r: Row = {
      id: newId(),
      position: rows.length,
      name: "",
      spend: 0,
      cpc: 0,
      atc: 0,
      pur: 0,
      price: 0,
      cog: 0,
      units: 0,
    };
    setRows((prev) => [...prev, r]);
  }

  function removeRow(id: string) {
    setRows((prev) => prev.filter((r) => r.id !== id));
    deleteRoasEntry(id);
  }

  const [importing, startImport] = useTransition();
  function runImport() {
    if (
      !confirm(
        `Importar campanhas da Meta para o Day ${String(day).padStart(2, "0")} (dia ${day} do mês atual)? Sincroniza a Meta ao vivo e preenche Campaign / Spend / CPC / PUR e o COG (da página Custos).`,
      )
    )
      return;
    startImport(async () => {
      const res = await autofillRoasDay(day);
      if (!res.ok) alert(res.error ?? "Falha ao importar.");
      else if ((res.count ?? 0) === 0)
        alert("Sem campanhas Meta sincronizadas para esse dia.");
      else window.location.reload();
    });
  }

  const [importingAll, startImportAll] = useTransition();
  function runImportAll() {
    if (
      !confirm(
        "Importar as campanhas da Meta para TODOS os dias do mês atual? Sincroniza a Meta ao vivo e coloca cada campanha no seu dia, com o COG da página Custos.",
      )
    )
      return;
    startImportAll(async () => {
      const res = await autofillRoasAllDays();
      if (!res.ok) alert(res.error ?? "Falha ao importar.");
      else if ((res.count ?? 0) === 0)
        alert("Sem campanhas Meta sincronizadas neste mês.");
      else window.location.reload();
    });
  }

  const [clearing, startClear] = useTransition();
  function runClear() {
    if (
      !confirm(
        "Apagar TODAS as campanhas de TODOS os dias do ROAS Tracker? Esta ação não pode ser desfeita.",
      )
    )
      return;
    startClear(async () => {
      const res = await clearAllRoasEntries();
      if (!res.ok) alert(res.error ?? "Falha ao limpar.");
      else window.location.reload();
    });
  }

  // Duplicate-name detection within this day.
  const nameCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of rows) {
      const k = r.name.trim();
      if (k) m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [rows]);

  const C = currency;

  function marginCls(p: number | null): string {
    if (p === null) return "text-muted-foreground";
    if (p < 0) return bandText.bad;
    if (p >= minMargin) return bandText.good;
    return bandText.warn;
  }

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        ⚡ Todas as decisões são <strong>sugestões</strong>, não aconselhamento
        financeiro. O contador Day# avalia em dias pares (48h).
      </p>

      <div className="max-h-[72vh] overflow-auto rounded-xl border border-border scrollbar-thin">
        <table className="w-full min-w-[1600px] border-collapse text-xs">
          <thead>
            <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground [&>th]:sticky [&>th]:top-0 [&>th]:z-20 [&>th]:bg-card">
              <th className="sticky left-0 top-0 z-30 bg-card px-2 py-2 text-left text-sky-400">Campaign</th>
              <th className="px-2 py-2 text-center">D#</th>
              <th className="border-l border-border/60 px-2 py-2 text-right text-sky-400">Spend</th>
              <th className="px-2 py-2 text-right text-sky-400">CPC</th>
              <th className="px-2 py-2 text-right text-sky-400">ATC</th>
              <th className="px-2 py-2 text-right text-sky-400">PUR</th>
              <th className="px-2 py-2 text-right">BER</th>
              <th className="px-2 py-2 text-right text-purple-400">ROAS</th>
              <th className="px-2 py-2 text-right">CPA</th>
              <th className="border-l border-border/60 px-2 py-2 text-right text-sky-400">Price</th>
              <th className="px-2 py-2 text-right text-sky-400">COG</th>
              <th className="px-2 py-2 text-right">Margin/u</th>
              <th className="px-2 py-2 text-right text-sky-400">Units</th>
              <th className="border-l border-border/60 px-2 py-2 text-right">Total COG</th>
              <th className="px-2 py-2 text-right">Store Val</th>
              <th className="px-2 py-2 text-right">Net Margin</th>
              <th className="px-2 py-2 text-right">Margin %</th>
              <th className="px-2 py-2 text-right">Conv %</th>
              <th className="border-l border-border/60 px-2 py-2 text-left">Decision</th>
              <th className="px-2 py-2 text-left">Yesterday</th>
              <th className="px-2 py-2 text-center">Dup</th>
              <th className="px-1 py-2"></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const calc = calcRoas({
                campaignName: r.name,
                totalSpend: r.spend,
                cpc: r.cpc,
                atc: r.atc,
                pur: r.pur,
                price: r.price,
                cog: r.cog,
                unitsSold: r.units,
              });
              const prev = prevContext[r.name.trim()] ?? {
                active: false,
                marginPct: null,
                counter: 0,
                decision: { label: "—", kind: "empty" as const },
              };
              const counter = dayCounter(r.name, r.spend, prev.counter);
              const decision = roasDecision(
                counter,
                r.spend,
                decisionMarginFrom(calc.marginPct, r.spend),
                prev,
              );
              const dup = (nameCounts.get(r.name.trim()) ?? 0) > 1;

              return (
                <tr
                  key={r.id}
                  className="border-b border-border/50 transition-colors even:bg-muted/20 hover:bg-muted/40"
                >
                  <td className="sticky left-0 z-10 bg-card p-0 min-w-[150px]">
                    <TextCell value={r.name} onChange={(v) => update(r.id, { name: v })} placeholder="Nome exato…" />
                  </td>
                  <td className="px-2 py-1 text-center tabular-nums text-muted-foreground">{counter || "-"}</td>
                  <td className="border-l border-border/60 p-0"><NumCell value={r.spend} onChange={(v) => update(r.id, { spend: v })} /></td>
                  <td className="p-0"><NumCell value={r.cpc} onChange={(v) => update(r.id, { cpc: v })} /></td>
                  <td className="p-0"><NumCell value={r.atc} onChange={(v) => update(r.id, { atc: v })} step="1" /></td>
                  <td className="p-0"><NumCell value={r.pur} onChange={(v) => update(r.id, { pur: v })} step="1" /></td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{mult(calc.ber)}</td>
                  <td className={cn("px-2 py-1 text-right font-medium tabular-nums whitespace-nowrap", bandText[roasBand(calc.roas, thresholds)])}>{mult(calc.roas)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(calc.cpa, C)}</td>
                  <td className="border-l border-border/60 p-0"><NumCell value={r.price} onChange={(v) => update(r.id, { price: v })} /></td>
                  <td className="p-0"><NumCell value={r.cog} onChange={(v) => update(r.id, { cog: v })} /></td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(calc.marginPerUnit, C)}</td>
                  <td className="p-0"><NumCell value={r.units} onChange={(v) => update(r.id, { units: v })} step="1" /></td>
                  <td className="border-l border-border/60 px-2 py-1 text-right tabular-nums whitespace-nowrap text-muted-foreground">{money(calc.totalCog, C)}</td>
                  <td className="px-2 py-1 text-right tabular-nums whitespace-nowrap">{money(calc.storeValue, C)}</td>
                  <td className={cn("px-2 py-1 text-right font-medium tabular-nums whitespace-nowrap", marginCls(calc.marginPct))}>{money(calc.netMargin, C)}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums whitespace-nowrap", marginCls(calc.marginPct))}>{pct(calc.marginPct)}</td>
                  <td className={cn("px-2 py-1 text-right tabular-nums whitespace-nowrap", bandText[convBand(calc.convPct)])}>{pct(calc.convPct)}</td>
                  <td className={cn("border-l border-border/60 whitespace-nowrap px-2 py-1 font-medium", bandText[decision.kind], bandBg[decision.kind])}>{decision.label || "—"}</td>
                  <td className="whitespace-nowrap px-2 py-1 text-muted-foreground">{prev.decision.label || "—"}</td>
                  <td className="px-2 py-1 text-center">{dup ? <span className="text-red-400">⚠️</span> : <span className="text-emerald-400/70">✓</span>}</td>
                  <td className="px-1 py-1 text-center">
                    <button onClick={() => removeRow(r.id)} className="text-muted-foreground hover:text-destructive">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={22} className="px-4 py-8 text-center text-sm text-muted-foreground">
                  Sem campanhas neste dia. Adiciona a primeira.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button variant="outline" size="sm" onClick={addRow}>
          <Plus className="h-4 w-4" /> Adicionar campanha
        </Button>
        <Button variant="outline" size="sm" onClick={runImport} disabled={importing}>
          {importing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Importar dia {String(day).padStart(2, "0")}
        </Button>
        <Button variant="outline" size="sm" onClick={runImportAll} disabled={importingAll}>
          {importingAll ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Download className="h-4 w-4" />
          )}
          Importar mês todo
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={runClear}
          disabled={clearing}
          className="text-muted-foreground hover:text-destructive"
        >
          {clearing ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Trash2 className="h-4 w-4" />
          )}
          Limpar todos os dias
        </Button>
      </div>
    </div>
  );
}
