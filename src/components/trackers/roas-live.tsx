"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity } from "lucide-react";
import { autofillRoasDay } from "@/lib/trackers/actions";
import { cn } from "@/lib/utils";

/**
 * Keeps the ROAS day grid near real-time: on open and every couple of minutes
 * it pulls live Meta spend and re-imports the viewed day (Spend/CPC/PUR/ATC +
 * COG from the Custos page), then soft-refreshes. Click to refresh now.
 * Manual Price/Units edits are preserved by the import.
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
  const [state, setState] = useState<"idle" | "syncing" | "live">("idle");
  const running = useRef(false);

  const tick = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setState("syncing");
    try {
      const res = await autofillRoasDay(year, month, day);
      if (res.ok) router.refresh();
      setState("live");
    } catch {
      setState("idle");
    } finally {
      running.current = false;
    }
  }, [year, month, day, router]);

  // Keep a ref to the latest `tick` so the effect below can call it without
  // depending on it directly. `tick` calls `router.refresh()`, and
  // `useRouter()`'s return value is not guaranteed stable across a refresh —
  // depending on `tick` (which depends on `router`) here previously let a
  // refresh give the effect a "new" tick, re-running it and rearming the
  // interval immediately. That turned the intended 2-minute cadence into a
  // tight back-to-back loop (confirmed in dev server logs: the same import
  // firing again within ~20s of the previous one finishing, never idling).
  const tickRef = useRef(tick);
  tickRef.current = tick;

  useEffect(() => {
    tickRef.current();
    const id = setInterval(() => tickRef.current(), 2 * 60 * 1000); // every 2 min
    return () => clearInterval(id);
  }, [year, month, day]);

  return (
    <button
      onClick={tick}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title="Clica para atualizar o spend da Meta agora"
    >
      <Activity
        className={cn(
          "h-3.5 w-3.5",
          state === "syncing"
            ? "animate-pulse text-amber-400"
            : "text-emerald-400",
        )}
      />
      {state === "syncing" ? "A atualizar spend…" : "Spend ao vivo"}
    </button>
  );
}
