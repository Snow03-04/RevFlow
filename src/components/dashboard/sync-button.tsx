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

  // Global auto-sync: fresh on app open, then every 15 min while the tab is
  // visible. Because this lives in the layout, it applies to every page.
  useEffect(() => {
    void run(true);
    const id = setInterval(() => {
      if (document.visibilityState === "visible") void run(true);
    }, AUTO_SYNC_MS);
    return () => clearInterval(id);
  }, [run]);

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
