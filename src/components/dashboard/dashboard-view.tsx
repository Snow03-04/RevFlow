"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { DashboardMetricsSkeleton } from "@/components/dashboard/skeletons";
import { SUBLABEL } from "@/lib/dashboard-labels";

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
    startTransition(() => router.push(`/dashboard?period=${value}`));
  }

  function applyCustom(f: string, t: string) {
    setOptimistic("custom");
    startTransition(() =>
      router.push(`/dashboard?period=custom&from=${f}&to=${t}`),
    );
  }

  return (
    <>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h2 className="text-sm font-medium text-muted-foreground">
          Performance · {SUBLABEL[active] ?? "vs período anterior"} · {rangeLabel}
        </h2>
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
