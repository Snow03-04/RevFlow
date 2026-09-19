"use client";

import { useState } from "react";
import { AlertCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { cn } from "@/lib/utils";

export function SyncButton({ className }: { className?: string }) {
  const { refreshing, error, refresh } = useDataRefresh();
  const [showError, setShowError] = useState(false);
  return (
    <div className="relative flex shrink-0 items-center gap-2">
      {error && (
        <button type="button" aria-label="Ver erro de atualização" aria-expanded={showError} onClick={() => setShowError(!showError)} className="text-destructive">
          <AlertCircle className="h-4 w-4" />
        </button>
      )}
      <Button
        variant="outline"
        size="sm"
        onClick={() => { setShowError(false); void refresh(true); }}
        disabled={refreshing}
        className={className}
        aria-label={refreshing ? "A atualizar dados" : "Atualizar dados"}
        title="Atualiza vendas, custos e publicidade em todas as páginas"
      >
        <RefreshCw className={cn("h-3.5 w-3.5", refreshing && "animate-spin")} />
        <span className="hidden sm:inline">{refreshing ? "A atualizar…" : "Atualizar"}</span>
      </Button>
      {error && showError && <div role="status" className="absolute right-0 top-full z-50 mt-2 w-64 max-w-[calc(100vw-2rem)] rounded-lg border border-border bg-popover p-3 text-xs leading-relaxed text-popover-foreground shadow-md">{error}</div>}
    </div>
  );
}
