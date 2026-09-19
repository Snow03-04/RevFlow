"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import type { RefreshResult } from "@/lib/sync/recent";
import { observeRefreshLifecycle } from "@/lib/sync/lifecycle";

type RefreshContext = { refreshing: boolean; error: string | null; updatedAt: string | null; refresh: (force?: boolean) => Promise<void> };
const DataRefreshContext = createContext<RefreshContext | null>(null);

export function DataRefreshProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const running = useRef(false);
  const lastAttempt = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback(async (force = false) => {
    if (running.current) return;
    // Coalesce focus + pageshow + visibility events, without suppressing a retry.
    if (!force && Date.now() - lastAttempt.current < 5_000) return;
    if (!navigator.onLine) {
      setError("Sem ligação. Os dados serão atualizados quando voltares a estar online.");
      return;
    }
    lastAttempt.current = Date.now();
    running.current = true;
    setRefreshing(true);
    setError(null);
    const abort = new AbortController();
    controller.current = abort;
    const timeout = setTimeout(() => abort.abort(), 65_000);
    try {
      const response = await fetch("/api/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force }),
        cache: "no-store",
        signal: abort.signal,
      });
      if (response.status === 401 || response.redirected) {
        setError("Sessão expirada. Inicia sessão novamente.");
        return;
      }
      const result: RefreshResult = await response.json();
      if (!response.ok || !result.ok) setError(result.error ?? "Atualização incompleta. Tenta novamente.");
      else setUpdatedAt(result.completedAt ?? new Date().toISOString());
    } catch {
      setError("Não foi possível concluir a atualização. Tenta novamente.");
    } finally {
      clearTimeout(timeout);
      running.current = false;
      lastAttempt.current = Date.now();
      controller.current = null;
      if (mounted.current) {
      setRefreshing(false);
      // Read fresh data even when one integration failed or the browser had an
      // old bfcache snapshot. Keep filters, navigation and component state intact.
      startTransition(() => router.refresh());
      }
    }
  }, [router]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    const stop = observeRefreshLifecycle(() => void refreshRef.current());
    return () => {
      mounted.current = false;
      stop();
      controller.current?.abort();
    };
  }, []);

  return <DataRefreshContext.Provider value={{ refreshing: refreshing || pending, error, updatedAt, refresh }}>{children}</DataRefreshContext.Provider>;
}

export function useDataRefresh() {
  const value = useContext(DataRefreshContext);
  if (!value) throw new Error("useDataRefresh requires DataRefreshProvider");
  return value;
}
