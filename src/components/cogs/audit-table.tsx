"use client";

import { useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  CheckCircle2,
  AlertTriangle,
  FileSpreadsheet,
  Calculator,
} from "lucide-react";
import type { CogsAudit } from "@/lib/cogs/audit";
import { COST_SOURCE_LABEL } from "@/lib/cogs/order-cost";
import { formatCurrency, cn } from "@/lib/utils";

export function AuditTable({
  audit,
  rangeLabel,
}: {
  audit: CogsAudit | null;
  rangeLabel: string;
}) {
  const [open, setOpen] = useState<string | null>(null);

  if (!audit) {
    return (
      <p className="rounded-xl border border-border bg-card p-5 text-sm text-muted-foreground">
        Liga uma loja para veres a auditoria de COGS.
      </p>
    );
  }

  const { currency } = audit;
  const margin = audit.totalRevenue - audit.totalCost;

  return (
    <div className="space-y-4">
      {/* Reconciliation banner — proves these rows add up to the dashboard. */}
      <div
        className={cn(
          "flex flex-col gap-1 rounded-xl border p-4 text-sm",
          audit.reconciles
            ? "border-emerald-500/30 bg-emerald-500/5"
            : "border-amber-500/40 bg-amber-500/5",
        )}
      >
        <span className="flex items-center gap-2 font-medium">
          {audit.reconciles ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-500" />
              Confere com o dashboard
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-500" />
              Diferença face ao dashboard
            </>
          )}
        </span>
        <span className="text-xs text-muted-foreground">
          {audit.storeName} · {rangeLabel} · soma das encomendas{" "}
          <b className="text-foreground">
            {formatCurrency(audit.totalCost, currency)}
          </b>{" "}
          · guardado no dashboard{" "}
          <b className="text-foreground">
            {formatCurrency(audit.storedTotal, currency)}
          </b>
          {!audit.reconciles &&
            " — faz uma sincronização para o dashboard recalcular."}
        </span>
      </div>

      {/* Totals */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Receita ({audit.orders.length} encomendas)
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums">
            {formatCurrency(audit.totalRevenue, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            COGS
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-rose-400">
            {formatCurrency(audit.totalCost, currency)}
          </p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Margem bruta
          </p>
          <p className="mt-1 text-xl font-semibold tabular-nums text-emerald-400">
            {formatCurrency(margin, currency)}
          </p>
        </div>
      </div>

      {/* Orders */}
      <div className="overflow-hidden rounded-xl border border-border bg-card">
        <div className="hidden grid-cols-[1fr_auto_auto_auto_auto] gap-4 border-b border-border px-4 py-2.5 text-xs font-medium uppercase tracking-wide text-muted-foreground sm:grid">
          <span>Encomenda</span>
          <span className="text-right">Receita</span>
          <span className="text-right">COGS</span>
          <span className="text-right">Origem</span>
          <span />
        </div>
        <ul className="divide-y divide-border/60">
          {audit.orders.map((o) => {
            const isOpen = open === o.orderNumber;
            return (
              <li key={o.orderNumber}>
                <button
                  onClick={() => setOpen(isOpen ? null : o.orderNumber)}
                  className="grid w-full grid-cols-[1fr_auto] items-center gap-4 px-4 py-3 text-left transition-colors hover:bg-accent/40 sm:grid-cols-[1fr_auto_auto_auto_auto]"
                >
                  <span className="min-w-0">
                    <span className="text-sm font-medium">#{o.orderNumber}</span>
                    <span className="ml-2 text-xs text-muted-foreground">
                      {o.date}
                    </span>
                  </span>
                  <span className="hidden text-right text-sm tabular-nums text-muted-foreground sm:block">
                    {formatCurrency(o.revenue, currency)}
                  </span>
                  <span className="text-right text-sm font-medium tabular-nums">
                    {formatCurrency(o.cost, currency)}
                  </span>
                  <span className="hidden justify-self-end sm:block">
                    <span
                      className={cn(
                        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium",
                        o.source === "sheet"
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      {o.source === "sheet" ? (
                        <>
                          <FileSpreadsheet className="h-3 w-3" /> Sheet
                        </>
                      ) : (
                        <>
                          <Calculator className="h-3 w-3" /> Calculado
                        </>
                      )}
                    </span>
                  </span>
                  <span className="hidden justify-self-end text-muted-foreground sm:block">
                    {isOpen ? (
                      <ChevronDown className="h-4 w-4" />
                    ) : (
                      <ChevronRight className="h-4 w-4" />
                    )}
                  </span>
                </button>

                {isOpen && (
                  <div className="space-y-2 border-t border-border/60 bg-background/40 px-4 py-3">
                    {o.source === "sheet" && (
                      <p className="rounded-lg border border-primary/25 bg-primary/5 px-3 py-2 text-xs">
                        Custo exato da sheet do fornecedor:{" "}
                        <b>{formatCurrency(o.cost, currency)}</b>. Pelas regras
                        por produto daria{" "}
                        {formatCurrency(o.computedCost, currency)} — a sheet já
                        inclui descontos de volume, por isso manda ela.
                      </p>
                    )}
                    <ul className="space-y-1.5">
                      {o.lines.map((l, i) => (
                        <li
                          key={i}
                          className="flex flex-wrap items-center justify-between gap-2 text-xs"
                        >
                          <span className="min-w-0 flex-1 truncate">
                            {l.qty}× {l.title ?? l.productId ?? "—"}
                          </span>
                          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                            {COST_SOURCE_LABEL[l.source]}
                          </span>
                          <span className="tabular-nums text-muted-foreground">
                            {formatCurrency(l.lineCostDisplay, currency)}
                          </span>
                        </li>
                      ))}
                      {o.lines.length === 0 && (
                        <li className="text-xs text-muted-foreground">
                          Sem linhas com quantidade ativa.
                        </li>
                      )}
                    </ul>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
        {audit.orders.length === 0 && (
          <p className="p-5 text-sm text-muted-foreground">
            Sem encomendas neste período.
          </p>
        )}
      </div>
    </div>
  );
}
