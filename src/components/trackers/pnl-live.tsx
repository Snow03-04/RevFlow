"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { autofillPnlMonth } from "@/lib/trackers/actions";
import { cn } from "@/lib/utils";

/**
 * Keeps the P&L month filling itself in: on open and every couple of minutes it
 * re-projects the sheet from the metrics the 15-minute sync has already stored,
 * then soft-refreshes. Click to refresh now.
 *
 * This runs the CHEAP projection (no Shopify/Meta calls), so it can't stall the
 * page or hit the serverless time limit — the merchant never has to sit and
 * watch an import. Manually entered fields (Notes) are preserved by the
 * projection itself.
 */
export function PnlLive({ year, month }: { year: number; month: number }) {
  const router = useRouter();
  const [state, setState] = useState<"idle" | "syncing" | "live">("idle");
  const running = useRef(false);

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState("syncing");
    try {
      const res = await autofillPnlMonth(year, month);
      if (res.ok) router.refresh();
      setState("live");
    } catch {
      setState("idle");
    } finally {
      running.current = false;
    }
  }, [year, month, router]);

  // Keep a ref to the latest `tick` so the effect below doesn't depend on it.
  // `tick` calls `router.refresh()`, and useRouter()'s value isn't guaranteed
  // stable across a refresh — depending on `tick` here would let each refresh
  // re-run the effect and rearm the interval immediately, turning the 2-minute
  // cadence into a tight back-to-back loop (the same bug fixed in roas-live).
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    tickRef.current();
    const id = setInterval(() => tickRef.current(), 2 * 60 * 1000); // every 2 min
    return () => clearInterval(id);
  }, [year, month]);

  return (
    <button
      onClick={() => tickRef.current()}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title="Atualiza sozinho ao abrir e a cada 2 min. Clica para atualizar já."
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
