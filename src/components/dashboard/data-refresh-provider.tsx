"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { observeRefreshLifecycle } from "@/lib/sync/lifecycle";
import { requestRefresh, RefreshSessionExpired } from "@/lib/sync/client";
import { AUTO_REFRESH_MS, REFRESH_RETRY_MS, REFRESH_TIMEOUT_MS } from "@/lib/sync/protocol";

type RefreshContext = {
  refreshing: boolean;
  reloading: boolean;
  online: boolean;
  progress: string | null;
  error: string | null;
  updatedAt: string | null;
  refresh: (force?: boolean) => Promise<void>;
};
const DataRefreshContext = createContext<RefreshContext | null>(null);
const OFFLINE_MESSAGE = "Sem ligação. A atualização retoma automaticamente quando voltares a estar online.";

export function DataRefreshProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [refreshing, setRefreshing] = useState(false);
  const [reloading, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const lastFinished = useRef(0);
  const failed = useRef(false);
  const sessionExpired = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);

  const refresh = useCallback((force = false): Promise<void> => {
    if (!mounted.current) return Promise.resolve();
    if (running.current) return running.current;
    if (!force && sessionExpired.current) return Promise.resolve();
    if (navigator.onLine === false) {
      setOnline(false);
      setError(OFFLINE_MESSAGE);
      lastFinished.current = 0;
      return Promise.resolve();
    }
    setOnline(true);
    setRefreshing(true);
    setProgress("A verificar ligações…");
    // Keep the last warning visible until the next result actually resolves it.
    const abort = new AbortController();
    controller.current = abort;
    const current = () => mounted.current && controller.current === abort;
    const timeout = setTimeout(() => abort.abort(), REFRESH_TIMEOUT_MS);
    const operation = (async () => {
      let readPage = true;
      try {
        const result = await requestRefresh(force, abort.signal, (message) => {
          if (current()) setProgress(message);
        });
        if (!current() || abort.signal.aborted) return;
        sessionExpired.current = false;
        failed.current = !result.ok;
        if (!result.ok) setError(result.error ?? "Atualização incompleta. Nova tentativa automática em 30 segundos.");
        else {
          setError(null);
          setUpdatedAt(result.completedAt ?? new Date().toISOString());
        }
      } catch (cause) {
        if (!current()) return;
        failed.current = true;
        sessionExpired.current = cause instanceof RefreshSessionExpired;
        readPage = !sessionExpired.current && navigator.onLine !== false;
        setError(sessionExpired.current ? (cause as Error).message
          : navigator.onLine === false ? OFFLINE_MESSAGE
          : abort.signal.aborted ? "A atualização demorou demasiado. Será tentada novamente automaticamente."
          : "Não foi possível concluir a atualização. Nova tentativa automática em 30 segundos.");
      } finally {
        clearTimeout(timeout);
        if (controller.current === abort) {
          running.current = null;
          controller.current = null;
          lastFinished.current = navigator.onLine === false ? 0 : Date.now();
          if (mounted.current) {
            setRefreshing(false);
            setProgress(null);
            // Import completion and rendering are separate states: a slow page
            // never locks the button, nor claims that new values are visible yet.
            if (readPage) startTransition(() => router.refresh());
          }
        }
      }
    })();
    running.current = operation;
    return operation;
  }, [router]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    const connectionChanged = () => {
      setOnline(navigator.onLine !== false);
      if (navigator.onLine === false) { lastFinished.current = 0; setError(OFFLINE_MESSAGE); }
    };
    connectionChanged();
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    const stop = observeRefreshLifecycle(() => refreshRef.current(), () => {
      if (sessionExpired.current) return AUTO_REFRESH_MS;
      if (!lastFinished.current) return 0;
      return lastFinished.current + (failed.current ? REFRESH_RETRY_MS : AUTO_REFRESH_MS) - Date.now();
    });
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      controller.current?.abort();
      controller.current = null;
      running.current = null;
    };
  }, []);

  return <DataRefreshContext.Provider value={{ refreshing, reloading, online, progress, error, updatedAt, refresh }}>{children}</DataRefreshContext.Provider>;
}

export function useDataRefresh() {
  const value = useContext(DataRefreshContext);
  if (!value) throw new Error("useDataRefresh requires DataRefreshProvider");
  return value;
}
