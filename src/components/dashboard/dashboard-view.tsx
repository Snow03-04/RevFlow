"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { DashboardMetricsSkeleton } from "@/components/dashboard/skeletons";
import { dashboardPeriodUrl } from "@/lib/dashboard-navigation";
import { LiveSpend } from "@/components/dashboard/live-spend";

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
}: {
  period: string;
  from?: string;
  to?: string;
  rangeLabel: string;
  children: React.ReactNode;
}) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();
  const [optimistic, setOptimistic] = useState<string | null>(null);
  const active = optimistic ?? period;

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
    <>
      <div className="flex min-w-0 flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
        <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 xl:flex-col xl:items-start">
          <h2 className="text-xs text-muted-foreground">{rangeLabel}</h2>
          <LiveSpend />
        </div>
        <PeriodSelector
          active={active}
          from={from}
          to={to}
          onPick={pick}
          onCustom={applyCustom}
        />
      </div>

      {isPending ? <DashboardMetricsSkeleton /> : children}
    </>
  );
}
