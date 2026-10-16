"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";
import { reprojectRoasDay } from "@/lib/trackers/actions";
import { cn } from "@/lib/utils";

/** Share source imports and the automatic timer with the rest of the app. */
export function RoasLive({ year, month, day }: { year: number; month: number; day: number }) {
  const router = useRouter();
  const shared = useDataRefresh();
  const running = useRef(false);
  const [projecting, setProjecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = shared.refreshing || projecting;
  const warning = error ?? shared.error;
  async function tick() {
    if (running.current) return;
    running.current = true;
    setProjecting(true);
    setError(null);
    try {
      await shared.refresh(true);
      // Also refresh an older viewed month, using already-imported facts only.
      const result = await reprojectRoasDay(year, month, day);
      if (!result.ok) setError(result.error ?? "Não foi possível atualizar o tracker.");
      router.refresh();
    } catch {
      setError("A atualização ficou incompleta. Tenta novamente.");
    } finally {
      running.current = false;
      setProjecting(false);
    }
  }
  return <button onClick={tick} disabled={busy || !shared.online}
    className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
    title={warning ?? shared.progress ?? "Atualizar vendas, gastos e alterações de orçamento"}>
    <Activity className={cn("h-3.5 w-3.5", busy ? "animate-pulse text-amber-400" : warning ? "text-red-400" : "text-emerald-400")} />
    {busy ? "A atualizar tracker…" : warning ? "Atualização incompleta — tentar novamente" : "Atualizar tracker"}
  </button>;
}
