"use client";

import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { cn } from "@/lib/utils";

/** Both page and header reflect the same request, including partial failures. */
export function LiveSpend() {
  const { refreshing, reloading, online, error, updatedAt } = useDataRefresh();
  return (
    <span role="status" className="inline-flex min-w-0 max-w-full items-center gap-1.5 break-words text-[11px] text-muted-foreground" title={error ? "Atualização incompleta. Consulta o estado no topo." : (updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT")}` : "A verificar os dados mais recentes")}>
      <span aria-hidden="true" className={cn("h-1.5 w-1.5 shrink-0 rounded-full", !online ? "bg-muted-foreground" : refreshing ? "animate-pulse bg-primary" : error ? "bg-amber-500" : reloading ? "animate-pulse bg-primary" : updatedAt ? "bg-success" : "bg-muted-foreground")} />
      {!online ? "Sem ligação" : refreshing || reloading ? "A atualizar" : error ? "Dados por confirmar · detalhes no topo" : updatedAt ? `Atualizado às ${new Date(updatedAt).toLocaleTimeString("pt-PT", { hour: "2-digit", minute: "2-digit" })}` : "A verificar dados"}
    </span>
  );
}
