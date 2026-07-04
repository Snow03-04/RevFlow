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
  Layers,
} from "lucide-react";
import type { CogsProduct } from "@/lib/queries";
import {
  saveProductCost,
  deleteProductCostEntry,
  saveProductTier,
  addProductToCollection,
  removeProductFromCollection,
  recomputeAllMetricsAction,
} from "@/lib/cogs/actions";
import { TierEditor } from "@/components/cogs/tier-editor";
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
  costText: string; // raw text as typed (accepts "," or "."), so digits never "leave"
  dirty: boolean;
}

/** Parse a cost the way a person types it: accept comma OR dot as the decimal. */
function parseCost(text: string): number | null {
  const t = text.trim().replace(",", ".");
  if (t === "") return null;
  const n = parseFloat(t);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

export function CogsTable({
  products,
  currency,
  collections = [],
}: {
  products: CogsProduct[];
  currency: string;
  collections?: { id: string; name: string }[];
}) {
  const collectionName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of collections) m.set(c.id, c.name);
    return m;
  }, [collections]);
  const debounce = useDebouncedSave(600);
  const debounceRecalc = useDebouncedSave(2500);
  const [rows, setRows] = useState<Row[]>(() =>
    products.map((p) => ({
      ...p,
      costInput: p.cost,
      costText: p.cost != null ? String(p.cost) : "",
      dirty: false,
    })),
  );
  const [saveError, setSaveError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [mode, setMode] = useState<"sold" | "all" | "missing">("sold");
  const [hasEdits, setHasEdits] = useState(false);
  const [autoStatus, setAutoStatus] = useState<"idle" | "running" | "done">(
    "idle",
  );
  const [recomputing, startRecompute] = useTransition();
  const [openHistory, setOpenHistory] = useState<string | null>(null);
  const [openTiers, setOpenTiers] = useState<string | null>(null);
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

  async function persistCost(productId: string, value: number | null) {
    const res = await saveProductCost(productId, value);
    if (!res.ok) setSaveError(res.error ?? "Falha ao guardar o custo.");
    else setSaveError(null);
    return res;
  }

  /** Inline edit = set the CURRENT cost (effective today). Keeps the raw text so
   *  what you type never gets reformatted/removed mid-typing. */
  function updateCost(productId: string, raw: string) {
    const text = raw.replace(/[^\d.,]/g, ""); // keep digits + one decimal mark
    const value = parseCost(text);
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
          costText: text,
          costInput: value,
          costHistory: hist,
          costSource: value == null ? "shopify" : "manual",
          dirty: true,
        };
      }),
    );
    debounce(`cost-${productId}`, () => persistCost(productId, value));
    triggerRecalc();
  }

  /** Save immediately on blur — guarantees the last edit lands even if the
   *  debounce hasn't fired before you click away or leave the page. */
  function flushCost(productId: string, raw: string) {
    void persistCost(productId, parseCost(raw));
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
        const latest = hist[hist.length - 1].cost;
        return {
          ...r,
          costHistory: hist,
          costInput: latest,
          costText: String(latest),
          costSource: "manual",
          dirty: true,
        };
      }),
    );
    saveProductCost(productId, value, effectiveFrom).then((res) => {
      if (!res.ok) setSaveError(res.error ?? "Falha ao guardar o custo.");
      else setSaveError(null);
    });
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
        const latest = hist.length ? hist[hist.length - 1].cost : null;
        return {
          ...r,
          costHistory: hist,
          costInput: latest,
          costText: latest != null ? String(latest) : "",
          costSource: hist.length ? "manual" : "shopify",
          dirty: true,
        };
      }),
    );
    deleteProductCostEntry(productId, effectiveFrom).then((res) => {
      if (!res.ok) setSaveError(res.error ?? "Falha ao remover o custo.");
      else setSaveError(null);
    });
    triggerRecalc();
  }

  /** Assign a product to a collection (or remove it), then recompute. */
  function assignCollection(productId: string, collectionId: string | null) {
    setHasEdits(true);
    setRows((prev) =>
      prev.map((r) =>
        r.productId === productId ? { ...r, collectionId } : r,
      ),
    );
    const p =
      collectionId == null
        ? removeProductFromCollection(productId)
        : addProductToCollection(collectionId, productId);
    p.then((res) => {
      if (!res.ok) setSaveError(res.error ?? "Falha ao mudar a coleção.");
      else setSaveError(null);
    });
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
          ) : saveError ? (
            <span className="text-xs text-red-400">Erro ao guardar</span>
          ) : hasEdits ? (
            <span className="text-xs text-emerald-400">Custos guardados ✓</span>
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

      {saveError && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm">
          <span className="text-red-300">
            ⚠️ Não foi possível guardar o custo: {saveError}
          </span>
          <button
            onClick={() => setSaveError(null)}
            className="rounded-md border border-red-500/40 px-2.5 py-1 text-xs font-medium text-red-200 transition-colors hover:bg-red-500/15"
          >
            Fechar
          </button>
        </div>
      )}

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
              const openT = openTiers === r.productId;
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
                        <div className="flex items-center gap-2 truncate text-xs text-muted-foreground">
                          <span className="truncate">
                            {r.variantCount > 1
                              ? `${r.variantCount} variantes`
                              : r.sku || "—"}
                          </span>
                          {r.costSource === "manual" && cost != null && !r.collectionId && (
                            <Badge variant="muted">manual</Badge>
                          )}
                          {r.costHistory.length > 1 && (
                            <Badge variant="muted">{r.costHistory.length} datas</Badge>
                          )}
                          {r.tiers.length > 0 && !r.collectionId && (
                            <Badge variant="muted">
                              {r.tiers.length} escalã{r.tiers.length === 1 ? "o" : "os"}
                            </Badge>
                          )}
                          {r.collectionId && (
                            <Badge variant="default">
                              {collectionName.get(r.collectionId) ?? "coleção"}
                            </Badge>
                          )}
                        </div>
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
                          type="text"
                          inputMode="decimal"
                          value={r.costText}
                          placeholder="0.00"
                          onChange={(e) => updateCost(r.productId, e.target.value)}
                          onBlur={(e) => flushCost(r.productId, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          className="w-full bg-transparent px-1 py-1.5 text-right text-sm tabular-nums outline-none"
                        />
                      </div>
                      <button
                        onClick={() => {
                          setOpenTiers(openT ? null : r.productId);
                          setOpenHistory(null);
                        }}
                        title="Escalões por quantidade / coleção"
                        className={cn(
                          "rounded-md p-1.5 transition-colors",
                          openT || r.tiers.length > 0 || r.collectionId
                            ? "bg-primary/15 text-primary"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        <Layers className="h-4 w-4" />
                      </button>
                      <button
                        onClick={() => {
                          setOpenHistory(open ? null : r.productId);
                          setOpenTiers(null);
                        }}
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
                              type="text"
                              inputMode="decimal"
                              value={addValue}
                              onChange={(e) =>
                                setAddValue(e.target.value.replace(/[^\d.,]/g, ""))
                              }
                              placeholder="0.00"
                              className="w-28 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums outline-none"
                            />
                          </label>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              const v = parseCost(addValue);
                              if (v != null) addDatedCost(r.productId, addDate, v);
                            }}
                          >
                            <Plus className="h-4 w-4" /> Adicionar
                          </Button>
                        </div>
                      </div>
                    </TableCell>
                  </TableRow>
                )}
                {openT && (
                  <TableRow>
                    <TableCell colSpan={5} className="bg-muted/20">
                      <div className="space-y-4 px-2 py-2">
                        {/* Collection assignment */}
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                            Coleção
                          </span>
                          <select
                            value={r.collectionId ?? ""}
                            onChange={(e) =>
                              assignCollection(
                                r.productId,
                                e.target.value === "" ? null : e.target.value,
                              )
                            }
                            className="rounded-md border border-input bg-background px-2 py-1.5 text-sm outline-none"
                          >
                            <option value="">— Sem coleção (preços próprios) —</option>
                            {collections.map((c) => (
                              <option key={c.id} value={c.id}>
                                {c.name}
                              </option>
                            ))}
                          </select>
                          {collections.length === 0 && (
                            <span className="text-xs text-muted-foreground">
                              Cria uma coleção na secção em baixo para poder escolher.
                            </span>
                          )}
                        </div>

                        {/* Per-product tiers — hidden when the product is in a
                            collection, since the collection's prices win. */}
                        {r.collectionId ? (
                          <p className="rounded-md border border-primary/30 bg-primary/5 px-3 py-2 text-xs text-muted-foreground">
                            Este produto usa os preços da coleção{" "}
                            <span className="font-medium text-foreground">
                              {collectionName.get(r.collectionId) ?? ""}
                            </span>
                            . Edita os escalões na secção “Coleções de custos”, em baixo.
                          </p>
                        ) : (
                          <div>
                            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                              Escalões por quantidade · custo total ao levar N deste produto
                            </p>
                            <TierEditor
                              key={r.productId}
                              tiers={r.tiers}
                              currency={currency}
                              unitCost={r.costInput}
                              onSave={(minQty, total) =>
                                saveProductTier(r.productId, minQty, total)
                              }
                              afterChange={triggerRecalc}
                            />
                          </div>
                        )}
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
