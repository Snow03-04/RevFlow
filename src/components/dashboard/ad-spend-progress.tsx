"use client";

import { useEffect, useState } from "react";
import { useDataRefresh } from "./data-refresh-provider";
import { formatCurrency } from "@/lib/utils";
import { pacingFraction, type PacingReport, type PacingTotal } from "@/lib/ads/pacing";

export function AdSpendProgressView({ total, currency, timeZone = "UTC" }: { total: PacingTotal | null; currency: string; timeZone?: string }) {
  const fraction = total ? pacingFraction(total) : null;
  const ready = total?.status === "ready";
  const title = ready
    ? `Gasto bruto de Meta + Google. Previsão baseada nos orçamentos ativos; Google a 2× no primeiro dia, a 1× nos seguintes. É uma estimativa, não um limite de gasto.${total.updatedAt ? ` Dados às ${new Date(total.updatedAt).toLocaleTimeString("pt-PT", { timeZone, hour: "2-digit", minute: "2-digit" })}.` : ""}`
    : "A previsão precisa dos orçamentos atuais e das datas de início das campanhas.";
  return <section aria-label="Progresso do ad spend de hoje" className="space-y-1.5 py-1" title={title}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
      <span>Ad spend hoje <span className="opacity-60">· Meta + Google</span></span>
      <span className="tabular-nums">{ready ? <>{formatCurrency(total.spent, currency)} <span className="opacity-60">/ {formatCurrency(total.forecast, currency)} previstos</span></> : total?.status === "empty" ? "Sem campanhas com orçamento" : "Previsão por apurar"}</span>
    </div>
    <div role="progressbar" aria-label="Gasto face à previsão diária" aria-valuemin={0} aria-valuemax={100}
      aria-valuenow={fraction == null ? undefined : Math.round(fraction * 100)}
      aria-valuetext={ready ? `${formatCurrency(total.spent, currency)} de ${formatCurrency(total.forecast, currency)} previstos` : "Previsão por apurar"}
      className="h-1 overflow-hidden rounded-full bg-muted">
      <div className="h-full rounded-full bg-primary/70 transition-[width] duration-700 motion-reduce:transition-none" style={{ width: `${(fraction ?? 0) * 100}%` }} />
    </div>
  </section>;
}

export function AdSpendProgress({ storeId }: { storeId?: string }) {
  const [report, setReport] = useState<PacingReport | null>(null);
  const { updatedAt } = useDataRefresh();
  useEffect(() => {
    let dead = false, busy = false, initial = true;
    const stop = new AbortController();
    async function read() {
      if (busy || document.hidden && !initial) return;
      initial = false;
      busy = true;
      try {
        const response = await fetch("/api/ads/pacing", { cache: "no-store", signal: AbortSignal.any([stop.signal, AbortSignal.timeout(25_000)]) });
        if (!response.ok) throw new Error("Unavailable");
        const data = await response.json() as PacingReport;
        if (!dead) setReport(data);
      } catch { if (!dead) setReport(null); }
      finally { busy = false; }
    }
    void read();
    const timer = setInterval(() => void read(), 60_000);
    document.addEventListener("visibilitychange", read);
    return () => { dead = true; stop.abort(); clearInterval(timer); document.removeEventListener("visibilitychange", read); };
  }, [updatedAt]);
  return <AdSpendProgressView total={report ? (storeId ? report.stores[storeId] ?? null : report.total) : null}
    currency={report?.currency ?? "EUR"} timeZone={report?.timeZone} />;
}
