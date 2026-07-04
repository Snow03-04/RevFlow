import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="space-y-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <Skeleton key={i} className="h-16 w-full rounded-xl" />
        ))}
      </div>
    </div>
  );
}
