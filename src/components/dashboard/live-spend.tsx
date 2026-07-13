"use client";

import { useCallback, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Activity, AlertCircle } from "lucide-react";
import { refreshMetaSpendAction } from "@/lib/connections/actions";
import { cn } from "@/lib/utils";

/**
 * Manual "Atualizar" button: on click, pulls recent Shopify orders (revenue) +
 * Meta ad spend for a short window and recomputes, then soft-refreshes the page
 * so every KPI is fresh — quickly (3-day window, no product catalogue).
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
          setError(res.error ?? "Falha ao atualizar.");
          setState("idle");
          return;
        }
        setError(null);
        if (res.synced) router.refresh();
        setState("live");
      } catch {
        setError("Falha ao atualizar.");
        setState("idle");
      } finally {
        running.current = false;
      }
    },
    [router],
  );

  // No auto-pull on open. Forcing a Meta Graph sync on every dashboard mount
  // (an external, multi-second call) blocked the first clicks and re-rendered
  // the whole page. Meta spend is kept fresh by the 15-min server cron; this
  // button is now a manual "refresh spend now".

  if (error) {
    return (
      <button
        onClick={() => tick(true)}
        className="flex items-center gap-1.5 text-xs text-red-400 hover:text-red-300"
        title={error}
      >
        <AlertCircle className="h-3.5 w-3.5" />
        Erro ao atualizar — tentar de novo
      </button>
    );
  }

  return (
    <button
      onClick={() => tick(true)}
      className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground"
      title="Clica para atualizar vendas + gastos agora"
    >
      <Activity
        className={cn(
          "h-3.5 w-3.5",
          state === "syncing"
            ? "animate-pulse text-amber-400"
            : "text-emerald-400",
        )}
      />
      {state === "syncing" ? "A atualizar…" : "Atualizar"}
    </button>
  );
}
