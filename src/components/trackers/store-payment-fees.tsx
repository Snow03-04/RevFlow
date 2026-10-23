"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ChevronDown, Loader2 } from "lucide-react";
import { refreshStorePaymentFees, saveStorePaymentFees } from "@/lib/settings/payment-fee-actions";
import { Button } from "@/components/ui/button";

export interface StorePaymentFeeView {
  id: string; name: string; mode: "inherit" | "shopify" | "manual";
  percent: number; fixed: number; currency: string; actualOrders: number; estimatedOrders: number;
}

export function StorePaymentFees({ stores }: { stores: StorePaymentFeeView[] }) {
  return <details className="group rounded-xl border border-border bg-card" open={stores.length === 1}>
    <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-4 py-3">
      <div><h3 className="text-sm font-medium">Taxas Shopify por loja</h3>
        <p className="mt-1 text-xs text-muted-foreground">Pagamentos reais da Shopify ou taxas definidas por ti.</p></div>
      <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" />
    </summary>
    <div className="divide-y divide-border border-t border-border">
      {stores.map(store => <StoreFee key={store.id} store={store} />)}
    </div>
    <p className="border-t border-border px-4 py-3 text-xs leading-relaxed text-muted-foreground">
      No modo Shopify, cada encomenda usa a taxa cobrada quando o pagamento está confirmado. Até lá, ou para outros meios de pagamento, aplica-se a estimativa indicada. As alterações afetam apenas os relatórios do RevFlow e recalculam o histórico desta loja.
    </p>
  </details>;
}

function StoreFee({ store }: { store: StorePaymentFeeView }) {
  const router = useRouter();
  const [mode, setMode] = useState(store.mode);
  const [percent, setPercent] = useState(String(store.percent));
  const [fixed, setFixed] = useState(String(store.fixed));
  const [currency, setCurrency] = useState(store.currency);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const [pending, start] = useTransition();
  const [progress, setProgress] = useState(0);
  useEffect(() => { setMode(store.mode); setPercent(String(store.percent)); setFixed(String(store.fixed)); setCurrency(store.currency); },
    [store.mode, store.percent, store.fixed, store.currency]);
  const inputClass = "mt-1 h-9 w-full rounded-md border border-input bg-background px-2 text-sm text-foreground disabled:opacity-50";
  return <form className="space-y-3 p-4" aria-label={`Taxas Shopify — ${store.name}`} onSubmit={event => {
    event.preventDefault(); setMessage(""); setProgress(0);
    start(async () => {
      let saved = false;
      try {
        if (!percent.trim() || !fixed.trim()) { setFailed(true); setMessage("Preenche a percentagem e a taxa fixa, mesmo que sejam zero."); return; }
        const result = await saveStorePaymentFees({ storeId: store.id, mode, percent: Number(percent.replace(",", ".")),
          fixed: Number(fixed.replace(",", ".")), currency });
        if (!result.ok) { setFailed(true); setMessage(result.error ?? "Não foi possível guardar."); return; }
        saved = true;
        const steps = result.steps ?? [];
        for (let i = 0; i < steps.length; i++) {
          const refreshed = await refreshStorePaymentFees({ storeId: store.id, ...steps[i] });
          if (!refreshed.ok) { setFailed(true); setMessage(refreshed.error ?? "Taxas guardadas; volta a guardar para concluir o histórico."); return; }
          setProgress(Math.round((i + 1) / steps.length * 100));
        }
        setFailed(false); setMessage("Guardado. Taxas e lucros atualizados."); router.refresh();
      } catch { setFailed(true); setMessage(saved ? "Taxas guardadas; volta a guardar para concluir o histórico." : "Não foi possível concluir. Tenta guardar novamente."); }
    });
  }}>
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm font-medium">{store.name}</p>
      <p className="text-xs text-muted-foreground">{mode === "shopify"
        ? `${store.actualOrders} encomendas com pagamento confirmado · ${store.estimatedOrders} por confirmar, no período`
        : mode === "inherit" ? "Usa as definições gerais do P&L" : "Estimativa própria desta loja"}</p>
    </div>
    <div className="grid items-end gap-3 sm:grid-cols-[minmax(190px,2fr)_1fr_1fr_90px_auto]">
      <label className="text-xs text-muted-foreground">Cálculo
        <select aria-label={`Cálculo — ${store.name}`} className={inputClass} value={mode} disabled={pending}
          onChange={event => { setMode(event.target.value as typeof mode); setMessage(""); }}>
          <option value="shopify">Automático — Shopify</option><option value="manual">Taxa manual da loja</option><option value="inherit">Definições gerais do P&L</option>
        </select>
      </label>
      <label className="text-xs text-muted-foreground">{mode === "shopify" ? "Estimativa (%)" : "Percentagem (%)"}
        <input aria-label={`Percentagem — ${store.name}`} className={inputClass} value={percent} inputMode="decimal" disabled={pending || mode === "inherit"}
          onChange={event => { setPercent(event.target.value); setMessage(""); }} />
      </label>
      <label className="text-xs text-muted-foreground">{mode === "shopify" ? "Estimativa fixa" : "Taxa fixa"}
        <input aria-label={`Taxa fixa — ${store.name}`} className={inputClass} value={fixed} inputMode="decimal" disabled={pending || mode === "inherit"}
          onChange={event => { setFixed(event.target.value); setMessage(""); }} />
      </label>
      <label className="text-xs text-muted-foreground">Moeda
        <select aria-label={`Moeda — ${store.name}`} className={inputClass} value={currency} disabled={pending || mode === "inherit"} onChange={event => setCurrency(event.target.value)}>
          {["EUR", "USD", "GBP", "CAD", "RON", "HUF", "PLN", "CZK", "SEK"].map(value => <option key={value}>{value}</option>)}
        </select>
      </label>
      <Button size="sm" disabled={pending} type="submit">{pending && <Loader2 className="mr-1 h-4 w-4 animate-spin" />}{pending ? `A recalcular… ${progress}%` : "Guardar taxas"}</Button>
    </div>
    <p role="status" aria-live="polite" className={`text-xs ${failed ? "text-amber-400" : "text-primary"}`}>{message}</p>
  </form>;
}
