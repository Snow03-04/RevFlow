"use client";

import { Fragment, useMemo, useState, useTransition } from "react";
import {
  Package,
  RefreshCw,
  Search,
  Loader2,
  Clock,
  Plus,
  Trash2,
} from "lucide-react";
import type { CogsProduct } from "@/lib/queries";
import {
  saveProductCost,
  deleteProductCostEntry,
  recomputeAllMetricsAction,
} from "@/lib/cogs/actions";
import { useDebouncedSave } from "@/components/trackers/cells";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatCurrency, formatPercent, cn } from "@/lib/utils";

interface Row extends CogsProduct {
  costInput: number | null;
  dirty: boolean;
}

export function CogsTable({
  products,
  currency,
}: {
  products: CogsProduct[];
  currency: string;
}) {
  const debounce = useDebouncedSave(600);
  const debounceRecalc = useDebouncedSave(2500);
  const [rows, setRows] = useState<Row[]>(() =>
    products.map((p) => ({ ...p, costInput: p.cost, dirty: false })),
  );
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"sold" | "all" | "missing">("sold");
  const [hasEdits, setHasEdits] = useState(false);
  const [autoStatus, setAutoStatus] = useState<"idle" | "running" | "done">(
    "idle",
  );
  const [recomputing, startRecompute] = useTransition();
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [addDate, setAddDate] = useState(() =>
    new Date().toISOString().slice(0, 10),
  );
  const [addValue, setAddValue] = useState("");

  const soldCount = useMemo(() => rows.filter((r) => r.sold).length, [rows]);
  // Sold products with no cost set → they count €0 in the COGS (understates it).
  const missingCount = useMemo(
    () => rows.filter((r) => r.sold && r.costInput == null).length,
    [rows],
  );

  const today = () => new Date().toISOString().slice(0, 10);

  // Auto-recompute the dashboard/P&L a few seconds after edits settle.
  function triggerRecalc() {
    debounceRecalc("recalc", async () => {
      setAutoStatus("running");
      await recomputeAllMetricsAction();
      setAutoStatus("done");
    });
  }

  function sortHist(h: { effectiveFrom: string; cost: number }[]) {
    return [...h].sort((a, b) => a.effectiveFrom.localeCompare(b.effectiveFrom));
  }

  /** Inline edit = set the CURRENT cost (effective today), exact. */
  function updateCost(productId: string, value: number | null) {
    setHasEdits(true);
    const d = today();
    setRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId) return r;
        const hist =
          value == null
            ? []
            : sortHist([
                ...r.costHistory.filter((h) => h.effectiveFrom !== d),
                { effectiveFrom: d, cost: value },
              ]);
        return {
          ...r,
          costInput: value,
          costHistory: hist,
          costSource: value == null ? "shopify" : "manual",
          dirty: true,
        };
      }),
    );
    debounce(`cost-${productId}`, () => saveProductCost(productId, value));
    triggerRecalc();
  }

  /** History panel: add a cost effective from a chosen date. */
  function addDatedCost(productId: string, effectiveFrom: string, value: number) {
    if (!effectiveFrom || Number.isNaN(value)) return;
    setHasEdits(true);
    setRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId) return r;
        const hist = sortHist([
          ...r.costHistory.filter((h) => h.effectiveFrom !== effectiveFrom),
          { effectiveFrom, cost: value },
        ]);
        return {
          ...r,
          costHistory: hist,
          costInput: hist[hist.length - 1].cost,
          costSource: "manual",
          dirty: true,
        };
      }),
    );
    saveProductCost(productId, value, effectiveFrom);
    triggerRecalc();
    setAddValue("");
  }

  function removeDatedCost(productId: string, effectiveFrom: string) {
    setHasEdits(true);
    setRows((prev) =>
      prev.map((r) => {
        if (r.productId !== productId) return r;
        const hist = r.costHistory.filter(
          (h) => h.effectiveFrom !== effectiveFrom,
        );
        return {
          ...r,
          costHistory: hist,
          costInput: hist.length ? hist[hist.length - 1].cost : null,
          costSource: hist.length ? "manual" : "shopify",
          dirty: true,
        };
      }),
    );
    deleteProductCostEntry(productId, effectiveFrom);
    triggerRecalc();
  }

  function recompute() {
    startRecompute(async () => {
      const res = await recomputeAllMetricsAction();
      if (!res.ok) alert(res.error ?? "Falha ao recalcular.");
      else window.location.reload();
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (mode === "sold" && !r.sold) return false;
      if (mode === "missing" && !(r.sold && r.costInput == null)) return false;
      if (!q) return true;
      return (
        r.title.toLowerCase().includes(q) ||
        (r.sku ?? "").toLowerCase().includes(q)
      );
    });
  }, [rows, query, mode]);

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Procurar produto…"
              className="w-[220px] pl-9"
            />
          </div>
          <div className="flex items-center gap-1 rounded-lg border border-border bg-card p-1">
            <button
              onClick={() => setMode("sold")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "sold"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Só vendidos ({soldCount})
            </button>
            <button
              onClick={() => setMode("all")}
              className={cn(
                "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                mode === "all"
                  ? "bg-primary/15 text-primary"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              Todos ({rows.length})
            </button>
            {missingCount > 0 && (
              <button
                onClick={() => setMode("missing")}
                className={cn(
                  "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
                  mode === "missing"
                    ? "bg-amber-500/20 text-amber-300"
                    : "text-amber-400/80 hover:text-amber-300",
                )}
              >
                Sem custo ({missingCount})
              </button>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {autoStatus === "running" ? (
            <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" /> A atualizar o
              dashboard…
            </span>
          ) : autoStatus === "done" ? (
            <span className="text-xs text-emerald-400">
              Dashboard atualizado ✓
            </span>
          ) : hasEdits ? (
            <span className="text-xs text-amber-400">Custos guardados</span>
          ) : null}
          <Button onClick={recompute} disabled={recomputing}>
            {recomputing ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="h-4 w-4" />
            )}
            Recalcular e atualizar
          </Button>
        </div>
      </div>

      {missingCount > 0 && mode !== "missing" && (
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm">
          <span className="text-amber-300">
            ⚠️ {missingCount} produto{missingCount > 1 ? "s" : ""} vendido
            {missingCount > 1 ? "s" : ""} sem custo — contam €0 no COGS e
            inflacionam o lucro.
          </span>
          <button
            onClick={() => setMode("missing")}
            className="rounded-md border border-amber-500/40 px-2.5 py-1 text-xs font-medium text-amber-200 transition-colors hover:bg-amber-500/15"
          >
            Ver e preencher
          </button>
        </div>
      )}

      <Card>
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Produto</TableHead>
              <TableHead className="text-right">Preço venda</TableHead>
              <TableHead className="text-right text-sky-400">Custo (COGS)</TableHead>
              <TableHead className="text-right">Margem / u</TableHead>
              <TableHead className="text-right">Margem %</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((r) => {
              const cost = r.costInput;
              const marginUnit = cost == null ? null : r.price - cost;
              const marginPct =
                cost == null || r.price <= 0 ? null : (r.price - cost) / r.price;
              const open = openHistory === r.productId;
              return (
                <Fragment key={r.productId}>
                <TableRow>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.imageUrl}
                          alt=""
                          loading="lazy"
                          decoding="async"
                          className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{r.title}</p>
                        <p className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                          {r.variantCount > 1
                            ? `${r.variantCount} variantes`
                            : r.sku || "—"}
                          {r.costSource === "manual" && cost != null && (
                            <Badge variant="muted">manual</Badge>
                          )}
                          {r.costHistory.length > 1 && (
                            <Badge variant="muted">{r.costHistory.length} datas</Badge>
                          )}
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.price, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-1.5">
                      <div className="flex w-[130px] items-center rounded-lg border border-input bg-sky-500/10 px-2 focus-within:ring-1 focus-within:ring-sky-400/50">
                        <span className="text-xs text-muted-foreground">{currencySymbol(currency)}</span>
                        <input
                          type="number"
                          step="0.01"
                          value={cost ?? ""}
                          placeholder="0.00"
                          onChange={(e) =>
                            updateCost(
                              r.productId,
                              e.target.value === "" ? null : parseFloat(e.target.value),
                            )
                          }
                          onFocus={(e) => e.target.select()}
                          className="w-full bg-transparent px-1 py-1.5 text-right text-sm tabular-nums outline-none"
                        />
                      </div>
                      <button
                        onClick={() => setOpenHistory(open ? null : r.productId)}
                        title="Histórico de custos"
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          open
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Clock className="h-4 w-4" />
                      </button>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {marginUnit == null ? "—" : formatCurrency(marginUnit, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    {marginPct == null ? (
                      "—"
                    ) : (
                      <span
                        className={cn(
                          "tabular-nums",
                          marginPct < 0
                            ? "text-red-400"
                            : marginPct > 0.3
                              ? "text-emerald-400"
                              : "text-amber-400",
                        )}
                      >
                        {formatPercent(marginPct)}
                      </span>
                    )}
                  </TableCell>
                </TableRow>
                {open && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/20">
                      <div className="space-y-3 px-2 py-1">
                        <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Histórico de custos · cada encomenda usa o custo em vigor na sua data
                        </p>
                        {r.costHistory.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            Sem custos datados. O campo acima grava o custo a partir de hoje;
                            aqui podes registar custos com outras datas.
                          </p>
                        ) : (
                          <ul className="space-y-1">
                            {[...r.costHistory].reverse().map((h) => (
                              <li key={h.effectiveFrom} className="flex items-center gap-3 text-sm">
                                <span className="text-xs text-muted-foreground">a partir de</span>
                                <span className="tabular-nums">{h.effectiveFrom}</span>
                                <span className="font-medium tabular-nums">
                                  {formatCurrency(h.cost, currency)}
                                </span>
                                <button
                                  onClick={() => removeDatedCost(r.productId, h.effectiveFrom)}
                                  className="text-muted-foreground hover:text-destructive"
                                  title="Remover"
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              </li>
                            ))}
                          </ul>
                        )}
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                            A partir de
                            <input
                              type="date"
                              value={addDate}
                              onChange={(e) => setAddDate(e.target.value)}
                              className="rounded-md border border-input bg-background px-2 py-1 text-sm"
                            />
                          </label>
                          <label className="flex flex-col gap-1 text-xs text-muted-foreground">
                            Custo ({currencySymbol(currency)})
                            <input
                              type="number"
                              step="0.01"
                              value={addValue}
                              onChange={(e) => setAddValue(e.target.value)}
                              placeholder="0.00"
                              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums outline-none"
                            />
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() =>
                              addValue !== "" &&
                              addDatedCost(r.productId, addDate, parseFloat(addValue))
                            }
                          >
                            <Plus className="h-4 w-4" /> Adicionar
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                </Fragment>
              );
            })}
            {filtered.length === 0 && (
              <TableRow>
                <TableCell colSpan={5} className="py-10 text-center text-sm text-muted-foreground">
                  Sem produtos. Liga o Shopify e sincroniza para os ver aqui.
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}

function currencySymbol(code: string): string {
  try {
    return (0)
      .toLocaleString("en", { style: "currency", currency: code })
      .replace(/[\d.,\s]/g, "");
  } catch {
    return code;
  }
}
