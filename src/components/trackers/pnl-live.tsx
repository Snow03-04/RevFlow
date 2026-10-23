"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { cn } from "@/lib/utils";
import { useDataRefresh } from "@/components/dashboard/data-refresh-provider";

/**
 * Refresh the single read-only P&L on open and every five minutes. The shared
 * refresh provider imports new data; this component only rereads the metrics.
 */
export function PnlLive({ year, month, storeId }: { year: number; month: number; storeId?: string }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "live">("idle");
  const running = useRef(false);
  const { refreshing } = useDataRefresh();
  const sharedRefresh = useRef(refreshing);
  sharedRefresh.current = refreshing;

  const tick = useCallback(async () => {
    if (running.current || sharedRefresh.current || navigator.onLine === false || document.visibilityState === "hidden"
      || document.activeElement?.matches("input, textarea, [contenteditable='true']")) return;
    running.current = true;
    setState("syncing");
    try {
      router.refresh();
      setState("live");
    } catch {
      setState("idle");
    } finally {
      running.current = false;
    }
  }, [router]);

  // Keep a ref to the latest `tick` so the effect below doesn't depend on it.
  // `tick` calls `router.refresh()`, and useRouter()'s value isn't guaranteed
  // stable across a refresh — depending on `tick` here would let each refresh
  // re-run the effect and rearm the interval immediately, turning the 2-minute
  // cadence into a tight back-to-back loop (the same bug fixed in roas-live).
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    tickRef.current();
    const id = setInterval(() => tickRef.current(), 5 * 60 * 1000);
    return () => clearInterval(id);
  }, [year, month, storeId]);

  return (
    <button
      onClick={() => tickRef.current()}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title="Atualiza sozinho ao abrir e a cada 5 min. Clica para atualizar já."
    >
      <Activity
        className={cn(
          "h-3.5 w-3.5",
          state === "syncing"
            ? "animate-pulse text-amber-400"
            : "text-emerald-400",
        )}
      />
      {state === "syncing" ? "A atualizar…" : "Atualiza sozinho"}
    </button>
  );
}
