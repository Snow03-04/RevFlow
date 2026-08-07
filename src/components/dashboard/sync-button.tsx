"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncNowAction } from "@/lib/connections/actions";
import { cn } from "@/lib/utils";

/** Full sync (Shopify orders + Meta + recompute) auto-runs on this interval. */
const AUTO_SYNC_MS = 15 * 60 * 1000; // 15 minutes
/** Don't auto-sync more often than this (covers remounts / page reloads). */
const MIN_GAP_MS = 10 * 60 * 1000; // 10 minutes

// Module-level: survives client-side navigation so navigating between pages
// doesn't re-trigger a sync. This component lives in the dashboard layout, so
// the auto-sync is global — it runs on every page, not just one.
let lastSyncAt = 0;

export function SyncButton({ className }: { className?: string }) {
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const router = useRouter();

  const run = useCallback(
    async (auto = false) => {
      if (running.current) return; // never overlap
      if (auto && Date.now() - lastSyncAt < MIN_GAP_MS) return; // throttle auto
      running.current = true;
      setSyncing(true);
      setError(null);
      try {
        const res = await syncNowAction();
        if (!res.ok) {
          setError(res.error ?? "Sync failed");
        } else {
          lastSyncAt = Date.now();
          router.refresh(); // updates whatever page you're on
        }
      } catch {
        setError("Sync failed");
      } finally {
        running.current = false;
        setSyncing(false);
      }
    },
    [router],
  );

  // Keep a ref to the latest `run` so the effect below doesn't depend on it
  // directly. `run` calls `router.refresh()`, and `useRouter()`'s return value
  // isn't guaranteed stable across a refresh — depending on `run` (which
  // depends on `router`) here would let a refresh hand the effect a "new" run,
  // rearming the timers immediately. The MIN_GAP_MS throttle above happens to
  // mask the effect (see the matching, unmasked version of this bug fixed in
  // roas-live.tsx), but the timers still churn for nothing; scope the effect
  // to mount-only instead.
  const runRef = useRef(run);
  runRef.current = run;

  // Client fallback sync (the 15-min server cron is the primary). The first run
  // is DEFERRED so opening the dashboard — and the first clicks — is never
  // blocked by a heavy external sync sitting in the server-action queue.
  useEffect(() => {
    const first = setTimeout(() => {
      if (document.visibilityState === "visible") void runRef.current(true);
    }, 15_000);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void runRef.current(true);
    }, AUTO_SYNC_MS);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={() => void run(false)}
        disabled={syncing}
        className={className}
        title="Auto-sync em todas as páginas: ao abrir e a cada 15 min. Clica para sincronizar já."
      >
        <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
        {syncing ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
