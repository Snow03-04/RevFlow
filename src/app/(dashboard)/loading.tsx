import { Skeleton } from "@/components/ui/skeleton";

/**
 * Instant loading state shown on every dashboard navigation while the page's
 * server data loads — so switching tabs feels immediate instead of frozen.
 */
export default function DashboardLoading() {
  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <Skeleton className="h-7 w-44" />
        <Skeleton className="h-4 w-72" />
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-28 rounded-2xl" />
        ))}
      </div>

      {/* Big content block (table/chart) */}
      <Skeleton className="h-[60vh] w-full rounded-2xl" />
    </div>
  );
}
