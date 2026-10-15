"use client";

import { useState } from "react";
import { AlertCircle, Check, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { AUTO_REFRESH_MS } from "@/lib/sync/protocol";
import { cn } from "@/lib/utils";

export function SyncButton({ className }: { className?: string }) {
  const { refreshing, reconciling, reloading, online, progress, error, updatedAt, refresh } = useDataRefresh();
  const [showError, setShowError] = useState(false);
  const status = !online ? "Sem ligação" : reconciling ? "Vendas atualizadas · a confirmar pagamentos e relatórios"
    : refreshing ? progress ?? "A atualizar…"
    : error ? "Atualização incompleta" : reloading ? "A carregar os dados atualizados…"
    : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "Atualização automática ativa";
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      <span aria-hidden="true" className={cn("hidden max-w-52 truncate text-[11px] xl:inline", error || !online ? "text-destructive" : "text-muted-foreground")} title={status}>{status}</span>
      {error && (
        <button type="button" aria-label="Ver erro de atualização" aria-expanded={showError} onClick={() => setShowError(!showError)} className="text-destructive">
          <AlertCircle className="h-4 w-4" />
        </button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (refreshing) { setShowError(!showError); return; }
          setShowError(true); void refresh(true);
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
        <span className="hidden sm:inline">{reconciling ? "A confirmar custos…" : refreshing ? "A atualizar…" : "Atualizar"}</span>
      </Button>
      {(refreshing || error) && showError && <div className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-64 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md">
        <div className="flex items-start gap-2">
          <p role="status" className="min-w-0 flex-1 break-words">{refreshing ? progress ?? "A atualizar…" : error}</p>
          <button type="button" aria-label="Fechar estado da atualização" onClick={() => setShowError(false)} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center touch-manipulation"><X className="h-4 w-4" /></button>
        </div>
        {refreshing && <p className="mt-1 text-muted-foreground">{reconciling ? "As vendas já foram atualizadas. Os pagamentos estão a ser confirmados; o lucro pode ainda ser ajustado." : "Podes continuar a usar a app."}</p>}
      </div>}
    </div>
  );
}
