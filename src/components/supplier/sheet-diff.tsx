"use client";

import { useState, useTransition } from "react";
import {
  GitCompareArrows,
  CheckCircle2,
  Loader2,
  PlusCircle,
  ArrowRight,
  MinusCircle,
  HelpCircle,
  BadgeCheck,
} from "lucide-react";
import {
  getSupplierDiff,
  type SupplierDiff,
  type SupplierDiffRow,
} from "@/lib/supplier/actions";
import { formatCurrency, cn } from "@/lib/utils";

function Group({
  icon: Icon,
  tone,
  title,
  hint,
  rows,
  currency,
  render,
}: {
  icon: typeof PlusCircle;
  tone: string;
  title: string;
  hint: string;
  rows: SupplierDiffRow[];
  currency: string;
  render: (r: SupplierDiffRow) => React.ReactNode;
}) {
  if (rows.length === 0) return null;
  return (
    <div className="rounded-lg border border-border bg-background/40 p-3">
      <p className={cn("flex items-center gap-1.5 text-xs font-medium", tone)}>
        <Icon className="h-3.5 w-3.5" /> {title} ({rows.length})
      </p>
      <p className="mt-0.5 text-[11px] text-muted-foreground">{hint}</p>
      <ul className="mt-2 max-h-44 space-y-1 overflow-y-auto scrollbar-thin">
        {rows.map((r) => (
          <li
            key={r.order}
            className="flex items-center justify-between gap-2 text-xs"
          >
            <span className="text-muted-foreground">#{r.order}</span>
            <span className="tabular-nums">{render(r)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** "O que está na sheet vs o que a RevFlow aplicou" — surfaces supplier price
 *  changes and newly added rows before they quietly skew profit. */
export function SheetDiff({ currency }: { currency: string }) {
  const [diff, setDiff] = useState<SupplierDiff | null>(null);
  const [pending, start] = useTransition();

  function run() {
    start(async () => setDiff(await getSupplierDiff()));
  }

  return (
    <div className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="flex items-center gap-2 text-sm font-medium">
            <GitCompareArrows className="h-4 w-4 text-primary" /> Comparar com a
            sheet
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Vê o que mudou na sheet e ainda não foi aplicado aos COGS.
          </p>
        </div>
        <button
          onClick={run}
          disabled={pending}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-border px-4 py-2 text-sm font-medium transition-colors hover:bg-accent disabled:opacity-50"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <GitCompareArrows className="h-4 w-4" />
          )}
          Comparar
        </button>
      </div>

      {diff && (
        <>
          <p className="text-xs text-muted-foreground">
            Sheet: <b className="text-foreground">{diff.sheetCount}</b>{" "}
            encomendas · Aplicado:{" "}
            <b className="text-foreground">{diff.appliedCount}</b>
          </p>

          {diff.inSync ? (
            <p className="flex items-center gap-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3 text-sm text-emerald-500">
              <CheckCircle2 className="h-4 w-4" />
              Tudo sincronizado — os COGS correspondem à sheet.
            </p>
          ) : (
            <>
              <p className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-2.5 text-xs text-amber-500">
                Há diferenças. Clica em <b>&quot;Aplicar custos&quot;</b> em cima
                para as passar aos COGS.
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Group
                  icon={PlusCircle}
                  tone="text-sky-400"
                  title="Novas na sheet"
                  hint="Ainda não aplicadas — vão passar a contar."
                  rows={diff.pending}
                  currency={diff.currency}
                  render={(r) => formatCurrency(r.sheetCost ?? 0, diff.currency)}
                />
                <Group
                  icon={ArrowRight}
                  tone="text-amber-400"
                  title="Preço alterado"
                  hint="O fornecedor mudou o valor destas encomendas."
                  rows={diff.changed}
                  currency={diff.currency}
                  render={(r) => (
                    <span className="flex items-center gap-1.5">
                      <span className="text-muted-foreground line-through">
                        {formatCurrency(r.appliedCost ?? 0, diff.currency)}
                      </span>
                      <ArrowRight className="h-3 w-3" />
                      <b>{formatCurrency(r.sheetCost ?? 0, diff.currency)}</b>
                    </span>
                  )}
                />
                <Group
                  icon={BadgeCheck}
                  tone="text-emerald-400"
                  title="Estado de pagamento mudou"
                  hint="Pago / por pagar diferente do aplicado."
                  rows={diff.paidChanged}
                  currency={diff.currency}
                  render={(r) => (
                    <span>
                      {r.appliedPaid ? "pago" : "por pagar"} →{" "}
                      <b>{r.sheetPaid ? "pago" : "por pagar"}</b>
                    </span>
                  )}
                />
                <Group
                  icon={MinusCircle}
                  tone="text-rose-400"
                  title="Removidas da sheet"
                  hint="Aplicadas antes, já não estão na sheet."
                  rows={diff.removed}
                  currency={diff.currency}
                  render={(r) =>
                    formatCurrency(r.appliedCost ?? 0, diff.currency)
                  }
                />
              </div>
            </>
          )}

          {diff.unknownOrders.length > 0 && (
            <div className="rounded-lg border border-border bg-background/40 p-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <HelpCircle className="h-3.5 w-3.5" /> Sem encomenda
                correspondente ({diff.unknownOrders.length})
              </p>
              <p className="mt-0.5 text-[11px] text-muted-foreground">
                Estão na sheet mas não existem no Shopify — número errado ou
                ainda por sincronizar. Não contam para os COGS.
              </p>
              <p className="mt-2 break-words font-mono text-[11px] text-muted-foreground">
                {diff.unknownOrders.slice(0, 40).map((o) => `#${o}`).join("  ")}
                {diff.unknownOrders.length > 40 && " …"}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
