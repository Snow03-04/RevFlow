"use client";

import { useMemo, useState } from "react";
import { Calculator, ArrowRight } from "lucide-react";
import type { SupplierOrderRow } from "@/lib/supplier/actions";
import { formatCurrency } from "@/lib/utils";

/**
 * "How much COGS did I spend from order #X to order #Y?" — sums the exact
 * supplier cost of every order in the range. Runs entirely in the browser off
 * the already-loaded order list, so it answers as you type.
 */
export function RangeCalculator({
  orders,
  currency,
}: {
  orders: SupplierOrderRow[];
  currency: string;
}) {
  const first = orders[0]?.order ?? "";
  const last = orders[orders.length - 1]?.order ?? "";
  const [from, setFrom] = useState(first);
  const [to, setTo] = useState(last);

  const result = useMemo(() => {
    const lo = parseInt(from.replace(/\D/g, ""), 10);
    const hi = parseInt(to.replace(/\D/g, ""), 10);
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) return null;
    const [min, max] = lo <= hi ? [lo, hi] : [hi, lo];

    let total = 0;
    let paid = 0;
    let unpaid = 0;
    let count = 0;
    for (const o of orders) {
      const n = Number(o.order);
      if (n < min || n > max) continue;
      total += o.cost;
      count++;
      if (o.paid) paid += o.cost;
      else unpaid += o.cost;
    }
    return { total, paid, unpaid, count, min, max };
  }, [from, to, orders]);

  if (orders.length === 0) return null;

  return (
    <div className="space-y-4 rounded-xl border border-border bg-card p-5">
      <div>
        <p className="flex items-center gap-2 text-sm font-medium">
          <Calculator className="h-4 w-4 text-primary" /> Custo por intervalo de
          encomendas
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Quanto gastaste em COGS entre duas encomendas (usa o custo exato da
          sheet, já com os descontos de volume).
        </p>
      </div>

      <div className="flex flex-wrap items-end gap-3">
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Da encomenda</span>
          <input
            inputMode="numeric"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            placeholder={first}
            className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-primary/50"
          />
        </label>
        <ArrowRight className="mb-2.5 h-4 w-4 shrink-0 text-muted-foreground" />
        <label className="space-y-1">
          <span className="text-xs text-muted-foreground">Até à encomenda</span>
          <input
            inputMode="numeric"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            placeholder={last}
            className="w-32 rounded-lg border border-border bg-background px-3 py-2 text-sm tabular-nums outline-none focus:border-primary/50"
          />
        </label>
        <button
          onClick={() => {
            setFrom(first);
            setTo(last);
          }}
          className="mb-0.5 rounded-lg border border-border px-3 py-2 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          Tudo
        </button>
      </div>

      {result && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-lg border border-primary/30 bg-primary/5 p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Total COGS
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums text-primary">
              {formatCurrency(result.total, currency)}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Encomendas
            </p>
            <p className="mt-1 text-xl font-semibold tabular-nums">
              {result.count}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Já pago
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-emerald-500">
              {formatCurrency(result.paid, currency)}
            </p>
          </div>
          <div className="rounded-lg border border-border p-3">
            <p className="text-[11px] uppercase tracking-wide text-muted-foreground">
              Por pagar
            </p>
            <p className="mt-1 text-lg font-semibold tabular-nums text-rose-500">
              {formatCurrency(result.unpaid, currency)}
            </p>
          </div>
        </div>
      )}

      {result && result.count === 0 && (
        <p className="text-xs text-muted-foreground">
          Nenhuma encomenda com custo entre #{result.min} e #{result.max}.
        </p>
      )}
    </div>
  );
}
