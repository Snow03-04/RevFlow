import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <HeaderSkeleton />
        <Skeleton className="h-9 w-40 rounded-lg" />
      </div>
      <Skeleton className="h-16 w-full rounded-xl" />
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <Skeleton key={i} className="h-20 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-96 w-full rounded-xl" />
    </div>
  );
}
