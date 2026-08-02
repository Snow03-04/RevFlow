"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2 } from "lucide-react";
import { reimportOrdersAction } from "@/lib/connections/actions";
import { Button } from "@/components/ui/button";

/**
 * Repair a store whose past months synced with too few orders: re-imports every
 * order from the last ~6 months by created_at and recomputes. Slow (seconds), so
 * the button shows a spinner and blocks re-clicks while it runs.
 */
export function ReimportOrders() {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function run() {
    if (
      !confirm(
        "Re-importar todas as encomendas dos últimos ~6 meses do Shopify? Corrige meses com encomendas em falta. Pode demorar alguns segundos.",
      )
    )
      return;
    setMsg(null);
    start(async () => {
      const res = await reimportOrdersAction();
      if (!res.ok) {
        setMsg(res.error ?? "Falha ao re-importar.");
        return;
      }
      setMsg("Encomendas re-importadas. A atualizar…");
      router.refresh();
    });
  }

  return (
    <div className="space-y-1">
      <Button
        variant="outline"
        size="sm"
        onClick={run}
        disabled={pending}
        className="w-full"
      >
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <RefreshCw className="h-4 w-4" />
        )}
        Re-importar encomendas (histórico)
      </Button>
      <p className="text-xs text-muted-foreground">
        Usa isto se faltarem encomendas/receita num mês passado.
      </p>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
