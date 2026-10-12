"use client";

import { useState } from "react";
import { AlertCircle, Check, RefreshCw, WifiOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { cn } from "@/lib/utils";

export function SyncButton({ className }: { className?: string }) {
  const { refreshing, reloading, online, progress, error, updatedAt, refresh } = useDataRefresh();
  const [showError, setShowError] = useState(false);
  const status = !online ? "Sem ligação" : refreshing ? progress ?? "A atualizar…"
    : reloading ? "A carregar os dados atualizados…" : error ? "Atualização incompleta"
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
        onClick={() => { setShowError(true); void refresh(true); }}
        disabled={refreshing}
        className={className}
        aria-label={refreshing ? "A atualizar dados" : "Atualizar dados"}
        aria-busy={refreshing}
        title={`${status}. Atualiza automaticamente a cada minuto; clica para atualizar já.`}
      >
        {!online ? <WifiOff className="h-3.5 w-3.5" /> : !refreshing && !reloading && !error && updatedAt
          ? <Check className="h-3.5 w-3.5 text-success" />
          : <RefreshCw className={cn("h-3.5 w-3.5", (refreshing || reloading) && "animate-spin")} />}
        <span className="hidden sm:inline">{refreshing ? "A atualizar…" : "Atualizar"}</span>
      </Button>
      {error && showError && <div role="status" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md">{error}</div>}
    </div>
  );
}
