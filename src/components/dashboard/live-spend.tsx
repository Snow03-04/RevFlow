"use client";

import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { AUTO_REFRESH_MS } from "@/lib/sync/protocol";
import { cn } from "@/lib/utils";

/** Both page and header reflect the same request, including partial failures. */
export function LiveSpend() {
  const { refreshing, reloading, online, progress, error, updatedAt } = useDataRefresh();
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={error ?? (updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "A verificar os dados mais recentes")}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !online ? "bg-muted-foreground" : refreshing ? "animate-pulse bg-primary" : error ? "bg-destructive" : reloading ? "animate-pulse bg-primary" : updatedAt ? "bg-success" : "bg-muted-foreground")} />
      {!online ? "Sem ligação · retoma automaticamente" : refreshing ? progress ?? "A atualizar dados…" : error ? "Atualização incompleta" : reloading ? "A carregar os dados atualizados…" : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")} · automático: ${AUTO_REFRESH_MS / 1000}s entre atualizações` : "A verificar dados…"}
    </span>
  );
}
