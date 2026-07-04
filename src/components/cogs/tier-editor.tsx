"use client";

import { useState } from "react";
import { Plus, Trash2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatCurrency, currencySymbol, parseCostInput, cn } from "@/lib/utils";

export interface Tier {
  minQty: number;
  total: number; // TOTAL cost for minQty units, in display currency
}

/**
 * Edits a bundle-pricing table: for each quantity, the TOTAL cost of buying
 * that many together. Shared by the per-product panel and the collection
 * manager — the parent supplies `onSave(minQty, total | null)` (null removes).
 */
export function TierEditor({
  tiers,
  currency,
  unitCost,
  onSave,
  afterChange,
}: {
  tiers: Tier[];
  currency: string;
  unitCost?: number | null;
  onSave: (minQty: number, total: number | null) => Promise<{ ok: boolean; error?: string }>;
  afterChange?: () => void;
}) {
  const [list, setList] = useState<Tier[]>(() =>
    [...tiers].sort((a, b) => a.minQty - b.minQty),
  );
  const [qtyText, setQtyText] = useState("2");
  const [totalText, setTotalText] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sym = currencySymbol(currency);

  async function commit(minQty: number, total: number | null) {
    setBusy(true);
    const res = await onSave(minQty, total);
    setBusy(false);
    if (!res.ok) {
      setError(res.error ?? "Falha ao guardar.");
      return false;
    }
    setError(null);
    afterChange?.();
    return true;
  }

  async function add() {
    const q = parseInt(qtyText, 10);
    const total = parseCostInput(totalText);
    if (!Number.isInteger(q) || q < 2) {
      setError("A quantidade tem de ser 2 ou mais.");
      return;
    }
    if (total == null) {
      setError("Indica o custo total do conjunto.");
      return;
    }
    const ok = await commit(q, total);
    if (ok) {
      setList((prev) =>
        [...prev.filter((t) => t.minQty !== q), { minQty: q, total }].sort(
          (a, b) => a.minQty - b.minQty,
        ),
      );
      setTotalText("");
      setQtyText(String(q + 1));
    }
  }

  async function remove(minQty: number) {
    const ok = await commit(minQty, null);
    if (ok) setList((prev) => prev.filter((t) => t.minQty !== minQty));
  }

  return (
    <div className="space-y-2">
      {list.length === 0 ? (
        <p className="text-xs text-muted-foreground">
          Sem escalões. Ex.: a partir de 2 unidades → custo total do conjunto.
        </p>
      ) : (
        <ul className="space-y-1">
          {list.map((t) => {
            const perUnit = t.total / t.minQty;
            return (
              <li key={t.minQty} className="flex items-center gap-3 text-sm">
                <span className="text-xs text-muted-foreground">a partir de</span>
                <span className="tabular-nums font-medium">{t.minQty} un.</span>
                <span className="text-muted-foreground">→</span>
                <span className="font-medium tabular-nums">
                  {formatCurrency(t.total, currency)}
                </span>
                <span className="text-xs text-muted-foreground tabular-nums">
                  (≈ {formatCurrency(perUnit, currency)}/u
                  {unitCost != null && unitCost > 0
                    ? `, poupa ${formatCurrency(unitCost - perUnit, currency)}/u`
                    : ""}
                  )
                </span>
                <button
                  onClick={() => remove(t.minQty)}
                  disabled={busy}
                  className="text-muted-foreground hover:text-destructive disabled:opacity-50"
                  title="Remover escalão"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <div className="flex flex-wrap items-end gap-2">
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          A partir de (un.)
          <input
            type="number"
            min={2}
            step={1}
            value={qtyText}
            onChange={(e) => setQtyText(e.target.value)}
            className="w-24 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums outline-none"
          />
        </label>
        <label className="flex flex-col gap-1 text-xs text-muted-foreground">
          Custo total do conjunto ({sym})
          <input
            type="text"
            inputMode="decimal"
            value={totalText}
            onChange={(e) => setTotalText(e.target.value.replace(/[^\d.,]/g, ""))}
            onKeyDown={(e) => e.key === "Enter" && add()}
            placeholder="0.00"
            className="w-32 rounded-md border border-input bg-background px-2 py-1 text-right text-sm tabular-nums outline-none"
          />
        </label>
        <Button size="sm" variant="outline" onClick={add} disabled={busy}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          Adicionar
        </Button>
      </div>

      {error && <p className={cn("text-xs text-red-400")}>⚠️ {error}</p>}
    </div>
  );
}
