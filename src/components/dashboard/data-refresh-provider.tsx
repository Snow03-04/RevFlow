"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { observeRefreshLifecycle } from "@/lib/sync/lifecycle";
import { requestRefresh, RefreshRequestError, RefreshSessionExpired } from "@/lib/sync/client";
import { AUTO_REFRESH_MS, refreshRetryDelay, REFRESH_TIMEOUT_MS } from "@/lib/sync/protocol";

type RefreshContext = {
  refreshing: boolean;
  reconciling: boolean;
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
  const [reconciling, setReconciling] = useState(false);
  const [reloading, startTransition] = useTransition();
  const [online, setOnline] = useState(true);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [updatedAt, setUpdatedAt] = useState<string | null>(null);
  const running = useRef<Promise<void> | null>(null);
  const lastFinished = useRef(0);
  const failures = useRef(0);
  const sessionExpired = useRef(false);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const startedAt = useRef(0);
  const disconnected = useRef(false);
  const pageReadPending = useRef(false);

  const readPage = useCallback(() => {
    if (!mounted.current) return;
    // Keep the mobile keyboard, edited fields and hidden tabs undisturbed.
    if ((typeof document !== "undefined" && (document.visibilityState === "hidden" ||
      document.activeElement?.matches("input, textarea, [contenteditable='true']"))) || navigator.onLine === false) {
      pageReadPending.current = true;
      return;
    }
    pageReadPending.current = false;
    startTransition(() => router.refresh());
  }, [router]);

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
    setReconciling(false);
    setProgress("A verificar ligações…");
    // Keep the last warning visible until the next result actually resolves it.
    const abort = new AbortController();
    controller.current = abort;
    startedAt.current = Date.now();
    disconnected.current = false;
    const current = () => mounted.current && controller.current === abort;
    const timeout = setTimeout(() => abort.abort(), REFRESH_TIMEOUT_MS);
    const operation = (async () => {
      let shouldReadPage = true;
      try {
        const result = await requestRefresh(force, abort.signal, (message) => {
          if (current()) setProgress(message);
        }, () => {
          if (current() && !abort.signal.aborted) { setReconciling(true); readPage(); }
        });
        if (!current() || abort.signal.aborted) return;
        sessionExpired.current = false;
        failures.current = result.ok ? 0 : failures.current + 1;
        if (!result.ok) setError(result.error ?? "Atualização incompleta. Será tentada novamente automaticamente.");
        else {
          setError(null);
          setUpdatedAt(result.completedAt ?? new Date().toISOString());
        }
      } catch (cause) {
        if (!current()) return;
        failures.current++;
        sessionExpired.current = cause instanceof RefreshSessionExpired;
        shouldReadPage = !sessionExpired.current && navigator.onLine !== false;
        setError(sessionExpired.current ? (cause as Error).message
          : navigator.onLine === false ? OFFLINE_MESSAGE
          : abort.signal.aborted ? "A atualização demorou demasiado. Será tentada novamente automaticamente."
          : cause instanceof RefreshRequestError ? `${cause.message} Será tentada novamente automaticamente.`
          : "Não foi possível concluir a atualização. Será tentada novamente automaticamente.");
      } finally {
        clearTimeout(timeout);
        if (controller.current === abort) {
          running.current = null;
          controller.current = null;
          lastFinished.current = disconnected.current || navigator.onLine === false ? 0 : Date.now();
          if (mounted.current) {
            setRefreshing(false);
            setReconciling(false);
            setProgress(null);
            // Import completion and rendering are separate states: a slow page
            // never locks the button, nor claims that new values are visible yet.
            if (shouldReadPage) readPage();
          }
        }
      }
    })();
    running.current = operation;
    return operation;
  }, [readPage]);

  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;
  useEffect(() => {
    mounted.current = true;
    const connectionChanged = () => {
      setOnline(navigator.onLine !== false);
      if (navigator.onLine === false) {
        lastFinished.current = 0; disconnected.current = true;
        setError(OFFLINE_MESSAGE); controller.current?.abort();
      }
    };
    const resumed = () => {
      // Timers may have been frozen by iOS/Android. Check wall-clock time on wake.
      if (controller.current && Date.now() - startedAt.current >= REFRESH_TIMEOUT_MS) controller.current.abort();
      if (pageReadPending.current && document.visibilityState === "visible") readPage();
    };
    let focusTimer: ReturnType<typeof setTimeout>;
    const editFinished = () => { clearTimeout(focusTimer); focusTimer = setTimeout(resumed, 300); };
    connectionChanged();
    window.addEventListener("online", connectionChanged);
    window.addEventListener("offline", connectionChanged);
    window.addEventListener("pageshow", resumed);
    window.addEventListener("online", resumed);
    document.addEventListener("visibilitychange", resumed);
    document.addEventListener("focusout", editFinished);
    let firstRefresh = true;
    const stop = observeRefreshLifecycle(() => {
      const force = firstRefresh;
      firstRefresh = false;
      return refreshRef.current(force);
    }, () => {
      if (sessionExpired.current) return AUTO_REFRESH_MS;
      if (!lastFinished.current) return 0;
      return lastFinished.current + (failures.current ? refreshRetryDelay(failures.current) : AUTO_REFRESH_MS) - Date.now();
    });
    return () => {
      mounted.current = false;
      stop();
      window.removeEventListener("online", connectionChanged);
      window.removeEventListener("offline", connectionChanged);
      window.removeEventListener("pageshow", resumed);
      window.removeEventListener("online", resumed);
      document.removeEventListener("visibilitychange", resumed);
      document.removeEventListener("focusout", editFinished);
      clearTimeout(focusTimer);
      controller.current?.abort();
      controller.current = null;
      running.current = null;
    };
  }, [readPage]);

  return <DataRefreshContext.Provider value={{ refreshing, reconciling, reloading, online, progress, error, updatedAt, refresh }}>{children}</DataRefreshContext.Provider>;
}

export function useDataRefresh() {
  const value = useContext(DataRefreshContext);
  if (!value) throw new Error("useDataRefresh requires DataRefreshProvider");
  return value;
}
