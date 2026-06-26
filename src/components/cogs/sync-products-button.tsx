"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncProductsAction } from "@/lib/connections/actions";

export function SyncProductsButton() {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await syncProductsAction();
      if (!res.ok) setError(res.error ?? "Falha ao sincronizar produtos.");
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button variant="outline" size="sm" onClick={onClick} disabled={isPending}>
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        {isPending ? "A sincronizar…" : "Sincronizar produtos"}
      </Button>
    </div>
  );
}
