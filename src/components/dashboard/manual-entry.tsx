"use client";

import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import {
  PlusCircle,
  X,
  Trash2,
  TrendingUp,
  TrendingDown,
  Loader2,
} from "lucide-react";
import {
  addManualEntry,
  deleteManualEntry,
  getManualEntries,
  type ManualEntry,
} from "@/lib/adjustments/actions";
import { currencySymbol, formatCurrency, parseCostInput, cn } from "@/lib/utils";

function todayYmd(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

function daysAgoYmd(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(
    d.getDate(),
  ).padStart(2, "0")}`;
}

/**
 * Add ad-hoc profit / expense amounts (from outside Shopify/Meta) on a specific
 * day. Each entry shifts that day's profit and flows through every dashboard KPI
 * and the chart.
 */
export function ManualEntry({ currency = "USD" }: { currency?: string }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);

  const [kind, setKind] = useState<"profit" | "expense">("expense");
  const [date, setDate] = useState(todayYmd());
  const [amount, setAmount] = useState("");
  const [label, setLabel] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [entries, setEntries] = useState<ManualEntry[]>([]);
  const [loadingList, setLoadingList] = useState(false);

  useEffect(() => setMounted(true), []);

  const reload = useCallback(async () => {
    setLoadingList(true);
    try {
      setEntries(await getManualEntries(daysAgoYmd(120), todayYmd()));
    } finally {
      setLoadingList(false);
    }
  }, []);

  useEffect(() => {
    if (open) reload();
  }, [open, reload]);

  // Esc closes.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  const sym = currencySymbol(currency);

  const save = useCallback(async () => {
    const value = parseCostInput(amount);
    if (value == null || value <= 0) {
      setError("Escreve um valor válido.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const res = await addManualEntry({ date, kind, amount: value, label });
      if (!res.ok) {
        setError(res.error ?? "Falha ao guardar.");
        return;
      }
      setAmount("");
      setLabel("");
      await reload();
      router.refresh();
    } catch {
      setError("Falha ao guardar.");
    } finally {
      setSaving(false);
    }
  }, [amount, date, kind, label, reload, router]);

  const remove = useCallback(
    async (id: string) => {
      const res = await deleteManualEntry(id);
      if (res.ok) {
        await reload();
        router.refresh();
      }
    },
    [reload, router],
  );

  const modal = open && (
    <div className="fixed inset-0 z-[120] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-background/60 backdrop-blur-sm"
        onClick={() => setOpen(false)}
      />
      <div className="relative flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl">
        <header className="flex items-center justify-between border-b border-border px-5 py-3.5">
          <h2 className="text-sm font-semibold">Lucro ou despesa manual</h2>
          <button
            onClick={() => setOpen(false)}
            className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </header>

        <div className="space-y-4 overflow-y-auto px-5 py-4 scrollbar-thin">
          {/* Type toggle */}
          <div className="grid grid-cols-2 gap-2">
            <button
              onClick={() => setKind("profit")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                kind === "profit"
                  ? "border-emerald-500/50 bg-emerald-500/10 text-emerald-500"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              <TrendingUp className="h-4 w-4" /> Lucro
            </button>
            <button
              onClick={() => setKind("expense")}
              className={cn(
                "flex items-center justify-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
                kind === "expense"
                  ? "border-rose-500/50 bg-rose-500/10 text-rose-500"
                  : "border-border text-muted-foreground hover:bg-accent",
              )}
            >
              <TrendingDown className="h-4 w-4" /> Despesa
            </button>
          </div>

          {/* Date + amount */}
          <div className="grid grid-cols-2 gap-3">
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Dia</span>
              <input
                type="date"
                value={date}
                max={todayYmd()}
                onChange={(e) => setDate(e.target.value)}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </label>
            <label className="space-y-1">
              <span className="text-xs text-muted-foreground">Valor ({sym})</span>
              <input
                inputMode="decimal"
                placeholder="0,00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && save()}
                className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
              />
            </label>
          </div>

          {/* Label */}
          <label className="block space-y-1">
            <span className="text-xs text-muted-foreground">Descrição (opcional)</span>
            <input
              type="text"
              placeholder="ex.: venda no Vinted, fatura fornecedor…"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && save()}
              className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
            />
          </label>

          {error && <p className="text-xs text-rose-500">{error}</p>}

          <button
            onClick={save}
            disabled={saving}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            Adicionar
          </button>

          {/* Existing entries */}
          <div className="space-y-2 border-t border-border pt-3">
            <p className="text-xs font-medium text-muted-foreground">
              Registos recentes
            </p>
            {loadingList ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                A carregar…
              </p>
            ) : entries.length === 0 ? (
              <p className="py-2 text-center text-xs text-muted-foreground">
                Ainda não há registos manuais.
              </p>
            ) : (
              <ul className="space-y-1.5">
                {entries.map((e) => (
                  <li
                    key={e.id}
                    className="flex items-center justify-between gap-2 rounded-lg border border-border bg-background/50 px-3 py-2"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm">
                        {e.label || (e.kind === "profit" ? "Lucro" : "Despesa")}
                      </p>
                      <p className="text-[11px] text-muted-foreground">{e.date}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span
                        className={cn(
                          "text-sm font-medium tabular-nums",
                          e.kind === "profit"
                            ? "text-emerald-500"
                            : "text-rose-500",
                        )}
                      >
                        {e.kind === "profit" ? "+" : "−"}
                        {formatCurrency(e.amount, e.currency ?? currency)}
                      </span>
                      <button
                        onClick={() => remove(e.id)}
                        className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-rose-500"
                        title="Apagar"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
        title="Adicionar lucro ou despesa manual"
      >
        <PlusCircle className="h-3.5 w-3.5 text-primary" />
        Lucro / Despesa
      </button>
      {mounted && open && createPortal(modal, document.body)}
    </>
  );
}
