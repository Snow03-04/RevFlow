"use client";

import { useMemo, useState, useTransition } from "react";
import { Package, RefreshCw, Search, Loader2 } from "lucide-react";
import type { CogsProduct } from "@/lib/queries";
import {
  saveProductCost,
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
  const [mode, setMode] = useState<"sold" | "all">("sold");
  const [hasEdits, setHasEdits] = useState(false);
  const [autoStatus, setAutoStatus] = useState<"idle" | "running" | "done">(
    "idle",
  );
  const [recomputing, startRecompute] = useTransition();

  const soldCount = useMemo(() => rows.filter((r) => r.sold).length, [rows]);

  function updateCost(productId: string, value: number | null) {
    setHasEdits(true);
    setRows((prev) =>
      prev.map((r) =>
        r.productId === productId ? { ...r, costInput: value, dirty: true } : r,
      ),
    );
    debounce(`cost-${productId}`, () => {
      saveProductCost(productId, value);
    });
    // Auto-recompute the dashboard/P&L a few seconds after edits settle.
    debounceRecalc("recalc", async () => {
      setAutoStatus("running");
      await recomputeAllMetricsAction();
      setAutoStatus("done");
    });
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
              return (
                <TableRow key={r.productId}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {r.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={r.imageUrl}
                          alt=""
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
                        </p>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(r.price, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="ml-auto flex w-[130px] items-center rounded-lg border border-input bg-sky-500/10 px-2 focus-within:ring-1 focus-within:ring-sky-400/50">
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
