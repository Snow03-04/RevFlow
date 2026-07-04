import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {Array.from({ length: 2 }).map((_, i) => (
          <Skeleton key={i} className="h-72 rounded-2xl" />
        ))}
      </div>
      <Skeleton className="h-64 rounded-2xl" />
    </div>
  );
}
