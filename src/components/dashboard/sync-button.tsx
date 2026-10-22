"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { AUTO_REFRESH_MS } from "@/lib/sync/protocol";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { syncFeedback } from "@/lib/sync/feedback";

export function SyncButton({ className }: { className?: string }) {
  const { refreshing, reconciling, reloading, online, progress, error, updatedAt, refresh } = useDataRefresh();
  const [showError, setShowError] = useState(false);
  useEffect(() => { if (refreshing || !error) setShowError(false); }, [refreshing, error]);
  const feedback = error ? syncFeedback(error) : null;
  const status = !online ? "Sem ligação" : reconciling ? "Vendas atualizadas · a confirmar pagamentos e relatórios"
    : refreshing ? progress ?? "A atualizar…"
    : error ? "Atualização incompleta" : reloading ? "A carregar os dados atualizados…"
    : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "Atualização automática ativa";
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      <span aria-hidden="true" className="hidden max-w-44 truncate text-[11px] text-muted-foreground xl:inline" title={status}>{!online ? "Sem ligação" : refreshing || reloading ? "A atualizar" : error ? "Ver estado" : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : "Atualização automática"}</span>
      {error && (
        <button type="button" aria-label="Ver erro de atualização" aria-expanded={showError} onClick={() => setShowError(!showError)} className="flex h-9 w-9 items-center justify-center rounded-md text-amber-500 hover:bg-muted">
          <AlertCircle className="h-4 w-4" />
        </button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (refreshing) { setShowError(!showError); return; }
          setShowError(false); void refresh(true);
        }}
        className={cn("h-11 min-w-11 touch-manipulation px-3 sm:h-9 sm:min-w-9", className)}
        aria-label={refreshing ? "Ver progresso da atualização" : "Atualizar dados"}
        aria-expanded={showError && (refreshing || !!error)}
        aria-busy={refreshing}
        title={`${status}. Intervalo automático de ${AUTO_REFRESH_MS / 1000} segundos; clica para atualizar já.`}
      >
        {!online ? <WifiOff className="h-3.5 w-3.5" /> : reconciling ? <Check className="h-3.5 w-3.5 text-success" /> : !refreshing && !reloading && !error && updatedAt
          ? <Check className="h-3.5 w-3.5 text-success" />
          : <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />}
        <span className="hidden sm:inline">{refreshing ? "A atualizar…" : "Atualizar"}</span>
      </Button>
      {(refreshing || error) && showError && <div className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-4 text-xs leading-relaxed text-popover-foreground shadow-md">
        <div className="flex items-start gap-2">
          <p role="status" className="min-w-0 flex-1 font-medium">{refreshing ? progress ?? "A atualizar…" : "Estado da atualização"}</p>
          <button type="button" aria-label="Fechar estado da atualização" onClick={() => setShowError(false)} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center touch-manipulation"><X className="h-4 w-4" /></button>
        </div>
        {!refreshing && feedback && <div className="space-y-3">
          {feedback.notices.map(notice => <div key={notice.title}><p className="font-medium">{notice.title}</p><p className="mt-1 text-muted-foreground">{notice.detail}</p></div>)}
          <p className="text-muted-foreground">Alguns valores podem estar desatualizados.</p>
          <Link href={feedback.session ? "/login" : "/connections"} onClick={() => setShowError(false)} className="inline-flex min-h-9 items-center font-medium text-primary hover:underline">{feedback.session ? "Iniciar sessão" : feedback.reconnect ? "Rever ligação à Meta" : "Ver ligações"}</Link>
        </div>}
        {refreshing && <p className="mt-1 text-muted-foreground">{reconciling ? "As vendas já foram atualizadas. Os pagamentos estão a ser confirmados; o lucro pode ainda ser ajustado." : "Podes continuar a usar a app."}</p>}
      </div>}
    </div>
  );
}
