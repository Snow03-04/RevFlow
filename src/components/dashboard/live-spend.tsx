"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle } from "lucide-react";
import { refreshMetaSpendAction } from "@/lib/connections/actions";
import { cn } from "@/lib/utils";

/**
 * Keeps the dashboard's Ad Spend near real-time: forces a Meta pull on open and
 * every couple of minutes, soft-refreshing the page. Click to force a refresh.
 */
export function LiveSpend() {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "live">("idle");
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const tick = useCallback(
    async (force: boolean) => {
      if (running.current) return;
      running.current = true;
      setState("syncing");
      try {
        const res = await refreshMetaSpendAction(force);
        if (!res.ok) {
          setError(res.error ?? "Falha ao atualizar gastos.");
          setState("idle");
          return;
        }
        setError(null);
        if (res.synced) router.refresh();
        setState("live");
      } catch {
        setError("Falha ao atualizar gastos.");
        setState("idle");
      } finally {
        running.current = false;
      }
    },
    [router],
  );

  useEffect(() => {
    tick(true); // force a fresh pull whenever the dashboard opens
    const id = setInterval(() => tick(false), 2 * 60 * 1000);
    return () => clearInterval(id);
  }, [tick]);

  if (error) {
    return (
      <button
        onClick={() => tick(true)}
        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
        title={error}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Meta: erro — tentar de novo
      </button>
    );
  }

  return (
    <button
      onClick={() => tick(true)}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title="Clica para atualizar os gastos da Meta agora"
    >
      <Activity
        className={cn(
          "h-3.5 w-3.5",
          state === "syncing"
            ? "animate-pulse text-amber-400"
            : "text-emerald-400",
        )}
      />
      {state === "syncing" ? "A atualizar gastos…" : "Gastos ao vivo"}
    </button>
  );
}
