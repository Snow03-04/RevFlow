"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Loader2,
  RefreshCw,
  ExternalLink,
  CheckCircle2,
  AlertCircle,
  Wallet,
  Save,
} from "lucide-react";
import {
  saveSupplierSheetUrl,
  applySupplierCosts,
  type SupplierData,
  type SupplierActionResult,
} from "@/lib/supplier/actions";
import { RangeCalculator } from "@/components/supplier/range-calculator";
import { SheetDiff } from "@/components/supplier/sheet-diff";
import { formatCurrency, cn } from "@/lib/utils";

export function SupplierPanel({ data }: { data: SupplierData | null }) {
  const router = useRouter();
  const currency = data?.currency ?? "EUR";
  const [url, setUrl] = useState(data?.url ?? "");
  const [saving, startSave] = useTransition();
  const [applying, startApply] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<SupplierActionResult | null>(null);

  const hasCosts = !!data?.url && (data.paidCount > 0 || data.unpaidCount > 0);
  const total = (data?.paidTotal ?? 0) + (data?.unpaidTotal ?? 0);

  function save() {
    setError(null);
    setMsg(null);
    startSave(async () => {
      const r = await saveSupplierSheetUrl(url);
      if (!r.ok) setError(r.error ?? "Falhou a gravar.");
      else {
        setMsg("Link guardado.");
        router.refresh();
      }
    });
  }

  function apply() {
    setError(null);
    setApplied(null);
    startApply(async () => {
      const r = await applySupplierCosts();
      if (!r.ok) setError(r.error ?? "Falhou a aplicar.");
      else {
        setApplied(r);
        router.refresh();
      }
    });
  }

  return (
    <div className="space-y-6">
      {/* Sheet link */}
      <div className="space-y-3 rounded-xl border border-border bg-card p-5">
        <label className="text-sm font-medium">Link da Google Sheet</label>
        <p className="text-xs text-muted-foreground">
          Partilha a sheet como <b>Qualquer pessoa com o link → Visualizador</b>.
          Colunas: <code>order</code>, <code>cost</code>, <code>states</code>{" "}
          (vazio = por pagar). Sem linha de cabeçalho, assume-se essa mesma
          ordem: encomenda, custo, estado.
        </p>
        <div className="flex flex-col gap-2 sm:flex-row">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder="https://docs.google.com/spreadsheets/d/…"
            className="flex-1 rounded-lg border border-border bg-background px-3 py-2 text-sm outline-none focus:border-primary/50"
          />
          <button
            onClick={save}
            disabled={saving}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Guardar
          </button>
        </div>
        {data?.url && (
          <a
            href={data.url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir a sheet
          </a>
        )}
        {msg && <p className="text-xs text-emerald-500">{msg}</p>}
        {error && (
          <p className="flex items-start gap-1.5 text-xs text-rose-500">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {error}
          </p>
        )}
      </div>

      {hasCosts && data && (
        <>
          {/* Totals */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Pago
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-emerald-500">
                {formatCurrency(data.paidTotal, currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.paidCount} encomendas
              </p>
            </div>
            <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Por pagar
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums text-rose-500">
                {formatCurrency(data.unpaidTotal, currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.unpaidCount} encomendas
              </p>
            </div>
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Total custo fornecedor
              </p>
              <p className="mt-2 text-2xl font-semibold tabular-nums">
                {formatCurrency(total, currency)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {data.paidCount + data.unpaidCount} encomendas
              </p>
            </div>
          </div>

          {/* What the sheet says vs what was applied */}
          <SheetDiff currency={currency} />

          {/* COGS spent between two order numbers */}
          <RangeCalculator orders={data.orders} currency={currency} />

          {/* Apply to COGS */}
          <div className="space-y-3 rounded-xl border border-border bg-card p-5">
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="text-sm font-medium">Atualizar COGS a partir da sheet</p>
                <p className="text-xs text-muted-foreground">
                  Deriva o custo por produto (com datas) do que o fornecedor
                  cobrou e recalcula o lucro.
                </p>
              </div>
              <button
                onClick={apply}
                disabled={applying}
                className="inline-flex items-center justify-center gap-2 rounded-lg border border-primary/40 bg-primary/10 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/20 disabled:opacity-50"
              >
                {applying ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <RefreshCw className="h-4 w-4" />
                )}
                Aplicar custos
              </button>
            </div>

            {applied?.ok && (
              <div className="space-y-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-3">
                <p className="flex items-center gap-1.5 text-sm text-emerald-500">
                  <CheckCircle2 className="h-4 w-4" />
                  {applied.productsUpdated} produtos atualizados ·{" "}
                  {applied.matchedOrders} encomendas cruzadas
                </p>
                {applied.priceTiers && applied.priceTiers.length > 0 && (
                  <div className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">
                      Preço por par detetado:
                    </span>{" "}
                    {applied.priceTiers
                      .map(
                        (t) =>
                          `${formatCurrency(t.cost, currency)} desde ${
                            t.from === "2000-01-01" ? "sempre" : t.from
                          }`,
                      )
                      .join("  ·  ")}
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Unpaid orders */}
          {data.unpaidOrders.length > 0 && (
            <div className="rounded-xl border border-border bg-card p-5">
              <p className="mb-3 flex items-center gap-2 text-sm font-medium">
                <Wallet className="h-4 w-4 text-rose-500" /> Encomendas por pagar
                <span className="text-muted-foreground">
                  ({data.unpaidOrders.length})
                </span>
              </p>
              <div className="max-h-80 overflow-y-auto scrollbar-thin">
                <ul className="divide-y divide-border/60">
                  {data.unpaidOrders.map((o) => (
                    <li
                      key={o.order}
                      className="flex items-center justify-between py-2 text-sm"
                    >
                      <span className="text-muted-foreground">#{o.order}</span>
                      <span className="font-medium tabular-nums">
                        {formatCurrency(o.cost, currency)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
