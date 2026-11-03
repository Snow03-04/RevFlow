"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { flushSync } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { DashboardMetricsSkeleton } from "@/components/dashboard/skeletons";
import { dashboardPeriodUrl } from "@/lib/dashboard-navigation";
import { LiveSpend } from "@/components/dashboard/live-spend";
import { DashboardLayoutContext } from "./dashboard-layouts";
import styles from "./store-overview.module.css";

/**
 * Client shell around the period buttons + the (server-rendered) metrics.
 * Picking a period flips `isPending` synchronously, so the skeleton replaces the
 * numbers the INSTANT you click — no waiting for the server round-trip. When the
 * navigation lands, the fresh `children` render and the skeleton disappears.
 */
export function DashboardView({
  period,
  from,
  to,
  rangeLabel,
  children,
  footer,
  storeCount = 0,
}: {
  period: string;
  from?: string;
  to?: string;
  rangeLabel: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
  storeCount?: number;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const requestedOverview = searchParams.get("view") === "stores";
  const [showStores, setShowStores] = useState(requestedOverview);
  const transitionRef = useRef<{ skipTransition: () => void } | null>(null);
  const active = optimistic ?? period;

  useEffect(() => { setShowStores(requestedOverview); }, [requestedOverview]);
  useEffect(() => () => transitionRef.current?.skipTransition(), []);

  function toggleLayout() {
    const next = !showStores;
    const update = () => {
      flushSync(() => setShowStores(next));
      const url = new URL(window.location.href);
      if (next) url.searchParams.set("view", "stores");
      else url.searchParams.delete("view");
      // Native history updates Next's search params without fetching the same
      // financial data again. The original store selection remains in the URL.
      window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
    };
    transitionRef.current?.skipTransition();
    const doc = document as Document & { startViewTransition?: (update: () => void) => {
      skipTransition: () => void; ready: Promise<void>; finished: Promise<void>;
    } };
    if (doc.startViewTransition && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      const transition = doc.startViewTransition(update);
      transitionRef.current = transition;
      // A rapid second click can skip the preceding visual transition safely.
      void transition.ready.catch(() => {});
      void transition.finished.catch(() => {});
    } else update();
  }

  // Drop the optimistic value once the navigation has committed.
  useEffect(() => {
    setOptimistic(null);
  }, [period, from, to]);

  function pick(value: string) {
    if (value === active) return;
    setOptimistic(value);
    startTransition(() =>
      router.push(dashboardPeriodUrl(searchParams.toString(), value)),
    );
  }

  function applyCustom(f: string, t: string) {
    setOptimistic("custom");
    startTransition(() =>
      router.push(dashboardPeriodUrl(searchParams.toString(), "custom", f, t)),
    );
  }

  return (
    <DashboardLayoutContext.Provider value={showStores}>
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex flex-wrap items-center gap-4">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 xl:flex-col xl:items-start">
          <h2 className="text-xs text-muted-foreground">{rangeLabel}</h2>
          <LiveSpend />
        </div>
        {storeCount > 0 && <button type="button" className={styles.toggle} aria-pressed={showStores}
          aria-controls="dashboard-results" onClick={toggleLayout}>
          <span className={styles.toggleIcon} aria-hidden="true"><i /><i /><i /><i /></span>
          {showStores ? "Voltar ao dashboard" : "Vista por lojas"}
        </button>}
        </div>
        <PeriodSelector
          active={active}
          from={from}
          to={to}
          onPick={pick}
          onCustom={applyCustom}
        />
      </div>

      <div id="dashboard-results" aria-busy={isPending}>
        {isPending ? (showStores ? <StoreOverviewSkeleton count={storeCount} /> : <DashboardMetricsSkeleton />) : children}
      </div>
      {!showStores && footer}
    </DashboardLayoutContext.Provider>
  );
}

function StoreOverviewSkeleton({ count }: { count: number }) {
  return <div role="status" aria-label="A atualizar os resultados das lojas" className="space-y-6 py-4">
    <div className="h-28 animate-pulse rounded-xl bg-muted/40" />
    <div className={styles.grid}>{Array.from({ length: count }, (_, index) => <div key={index} className="h-[370px] animate-pulse rounded-2xl border border-border bg-muted/20" />)}</div>
    <span className="sr-only">A atualizar os resultados das lojas…</span>
  </div>;
}
