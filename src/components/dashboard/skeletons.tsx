import { Skeleton } from "@/components/ui/skeleton";

/** A generic table placeholder (header row + N body rows). */
export function TableSkeleton({
  rows = 10,
  cols = 8,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <div className="flex gap-3 border-b border-border bg-card px-3 py-3">
        {Array.from({ length: cols }).map((_, i) => (
          <Skeleton key={i} className="h-3.5 flex-1" />
        ))}
      </div>
      <div className="divide-y divide-border/50">
        {Array.from({ length: rows }).map((_, r) => (
          <div key={r} className="flex gap-3 px-3 py-3.5">
            {Array.from({ length: cols }).map((_, c) => (
              <Skeleton key={c} className="h-3.5 flex-1" />
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/** Page title + subtitle placeholder. */
export function HeaderSkeleton() {
  return (
    <div className="space-y-2">
      <Skeleton className="h-7 w-56" />
      <Skeleton className="h-4 w-64" />
    </div>
  );
}

/** Tracker pages: header + tab bar + wide table (ROAS, P&L). */
export function TrackerSkeleton() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="flex gap-1 rounded-lg border border-border bg-card p-1">
        {Array.from({ length: 12 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-14 shrink-0 rounded-md" />
        ))}
      </div>
      <TableSkeleton rows={12} cols={11} />
    </div>
  );
}

/** Dashboard metrics area: hero KPIs, cost breakdown, secondary KPIs, charts.
 *  Shown while a new period's data streams in (keyed Suspense fallback). */
export function DashboardMetricsSkeleton() {
  return (
    <div className="space-y-8">
      <section className="space-y-4">
        {/* Hero KPIs */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-2xl border border-border bg-card p-5"
            >
              <Skeleton className="h-3 w-24" />
              <Skeleton className="h-8 w-40" />
              <Skeleton className="h-5 w-28 rounded-full" />
            </div>
          ))}
        </div>
        {/* Cost breakdown */}
        <div className="space-y-3 rounded-2xl border border-border bg-card p-5">
          <Skeleton className="h-4 w-32" />
          <div className="grid grid-cols-3 gap-4">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12" />
            ))}
          </div>
        </div>
        {/* Secondary KPIs */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div
              key={i}
              className="space-y-2 rounded-xl border border-border bg-card p-4"
            >
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-24" />
            </div>
          ))}
        </div>
      </section>
      <section className="space-y-4">
        <Skeleton className="h-4 w-28" />
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="space-y-3 rounded-xl border border-border bg-card p-4"
            >
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-40 w-full" />
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** List pages: header (+ actions) and a table (Products, Costs, Ads). */
export function ListPageSkeleton({ cols = 6 }: { cols?: number }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <HeaderSkeleton />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <TableSkeleton rows={10} cols={cols} />
    </div>
  );
}
