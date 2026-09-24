"use client";

import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { cn } from "@/lib/utils";

/** Both page and header reflect the same request, including partial failures. */
export function LiveSpend() {
  const { refreshing, error, updatedAt } = useDataRefresh();
  return (
    <span role="status" className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground" title={error ?? (updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "A verificar os dados mais recentes")}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 rounded-full", refreshing ? "animate-pulse bg-primary" : error ? "bg-destructive" : updatedAt ? "bg-success" : "bg-muted-foreground")} />
      {refreshing ? "A atualizar dados…" : error ? "Atualização incompleta" : updatedAt ? "Sincronização concluída" : "A verificar dados…"}
    </span>
  );
}
