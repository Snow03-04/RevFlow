"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { autofillRoasDay } from "@/lib/trackers/actions";
import { cn } from "@/lib/utils";
import { AUTO_REFRESH_MS } from "@/lib/sync/protocol";

/**
 * Refreshes the viewed day and its decision history on open and every five
 * minutes while visible. Imported campaigns use realised Shopify economics.
 */
export function RoasLive({
  year,
  month,
  day,
}: {
  year: number;
  month: number;
  day: number;
}) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "live" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState("syncing");
    try {
      const res = await autofillRoasDay(year, month, day);
      if (res.ok) { router.refresh(); setState("live"); setError(null); }
      else { setState("error"); setError(res.error ?? "Não foi possível atualizar o tracker."); }
    } catch {
      setState("error");
      setError("A atualização ficou incompleta. Tenta novamente.");
    } finally {
      running.current = false;
    }
  }, [year, month, day, router]);

  // Keep a ref to the latest `tick` so the effect below can call it without
  // depending on it directly. `tick` calls `router.refresh()`, and
  // `useRouter()`'s return value is not guaranteed stable across a refresh —
  // depending on `tick` (which depends on `router`) here previously let a
  // refresh give the effect a "new" tick, re-running it and rearming the
  // interval immediately. That turned the intended refresh cadence into a
  // tight back-to-back loop (confirmed in dev server logs: the same import
  // firing again within ~20s of the previous one finishing, never idling).
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    const refreshVisible = () => { if (document.visibilityState === "visible" && navigator.onLine) tickRef.current(); };
    refreshVisible();
    const id = setInterval(refreshVisible, AUTO_REFRESH_MS);
    return () => clearInterval(id);
  }, [year, month, day]);

  return (
    <button
      onClick={tick}
      disabled={state === "syncing"}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title={error ?? "Atualizar vendas, gastos e alterações de orçamento"}
    >
      <Activity
        className={cn(
          "h-3.5 w-3.5",
          state === "syncing"
            ? "animate-pulse text-amber-400"
            : state === "error" ? "text-red-400" : "text-emerald-400",
        )}
      />
      {state === "syncing" ? "A atualizar tracker…" : state === "error" ? "Atualização incompleta — tentar novamente" : "Atualizar tracker"}
    </button>
  );
}
