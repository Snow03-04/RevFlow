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
