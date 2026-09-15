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
        "Re-importar as encomendas e os gastos de publicidade dos últimos ~6 meses? Atualiza as vendas e despesas do P&L e do ROAS. As notas são preservadas. Pode demorar alguns minutos.",
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
      setMsg("Encomendas e publicidade reimportadas. A atualizar…");
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
        Reimportar vendas e publicidade
      </Button>
      <p className="text-xs text-muted-foreground">
        Recupera vendas e gastos dos últimos seis meses para corrigir os totais.
      </p>
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
