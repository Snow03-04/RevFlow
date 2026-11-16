"use client";

import { useState } from "react";
import { AlertCircle, Check, RefreshCw, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { AUTO_REFRESH_MS } from "@/lib/sync/protocol";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { syncFeedback } from "@/lib/sync/feedback";

export function SyncButton({ className }: { className?: string }) {
  const { refreshing, reconciling, publishedScope, reloading, online, progress, error, issue, failedTasks, updatedAt, refresh } = useDataRefresh();
  const [showStatus, setShowStatus] = useState(false);
  const feedback = error ? syncFeedback(error, issue, failedTasks) : null;
  const status = !online ? "Sem ligação" : reconciling ? publishedScope === "active"
    ? "Lojas ativas atualizadas · a concluir os restantes dados" : "Vendas atualizadas · a confirmar pagamentos e relatórios"
    : refreshing ? progress ?? "A atualizar…"
    : feedback ? feedback.notices[0].title : reloading ? "A carregar os dados atualizados…"
    : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "Pronto a atualizar";
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      <span role="status" aria-live="polite" className="sr-only">{status}</span>
      <span aria-hidden="true" className="hidden max-w-44 truncate text-[11px] text-muted-foreground xl:inline" title={status}>{!online ? "Sem ligação" : refreshing || reloading ? "A atualizar" : error ? "Ver estado" : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : ""}</span>
      {error && !refreshing && (
        <button type="button" aria-label="Ver estado da atualização" aria-expanded={showStatus} onClick={() => setShowStatus(!showStatus)} className="flex h-9 w-9 items-center justify-center rounded-md text-amber-500 hover:bg-muted">
          <AlertCircle className="h-4 w-4" />
        </button>
      )}
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => {
          if (refreshing) { setShowStatus(!showStatus); return; }
          setShowStatus(true); void refresh(true);
        }}
        className={cn("h-11 min-w-11 touch-manipulation px-3 sm:h-9 sm:min-w-9", className)}
        aria-label={refreshing ? "Ver progresso da atualização" : "Atualizar dados"}
        aria-expanded={showStatus}
        aria-busy={refreshing}
        title={`${status}. Clica para sincronizar os dados. O painel consulta o estado a cada ${AUTO_REFRESH_MS / 60_000} minutos.`}
      >
        {!online ? <WifiOff className="h-3.5 w-3.5" /> : !refreshing && !reloading && !error && updatedAt
          ? <Check className="h-3.5 w-3.5 text-success" />
          : <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />}
        <span className="hidden sm:inline">{refreshing ? "A atualizar…" : "Atualizar"}</span>
      </Button>
      {showStatus && <div className="absolute right-0 top-full z-50 mt-2 max-h-[60vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto overscroll-contain rounded-lg border border-border bg-popover p-4 text-xs leading-relaxed text-popover-foreground shadow-md">
        <div className="flex items-start gap-2">
          <p role="status" className="min-w-0 flex-1 font-medium">{refreshing ? progress ?? "A atualizar…" : "Estado da atualização"}</p>
          <button type="button" aria-label="Fechar estado da atualização" onClick={() => setShowStatus(false)} className="-mr-2 -mt-2 flex h-11 w-11 shrink-0 items-center justify-center touch-manipulation"><X className="h-4 w-4" /></button>
        </div>
        {!refreshing && feedback && <div className="space-y-3">
          {feedback.notices.map(notice => <div key={notice.title}><p className="font-medium">{notice.title}</p><p className="mt-1 text-muted-foreground">{notice.detail}</p></div>)}
          {(feedback.session || feedback.reconnect) && <Link href={feedback.session ? "/login" : "/connections"} onClick={() => setShowStatus(false)} className="inline-flex min-h-9 items-center font-medium text-primary hover:underline">{feedback.session ? "Iniciar sessão" : "Rever ligação à Meta"}</Link>}
        </div>}
        {!refreshing && !feedback && updatedAt && <p role="status" className="flex items-center gap-2 font-medium"><Check aria-hidden="true" className="h-4 w-4 text-success" />Atualização concluída às {new Date(updatedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}</p>}
        {refreshing && <p className="mt-1 text-muted-foreground">{reconciling ? publishedScope === "active"
          ? "As vendas e os custos disponíveis das lojas ativas já foram atualizados. Estamos a concluir pagamentos e as restantes lojas; o total ainda pode mudar."
          : "As vendas já foram atualizadas. Os pagamentos estão a ser confirmados; o lucro pode ainda ser ajustado." : "Podes continuar a usar a app."}</p>}
      </div>}
    </div>
  );
}
