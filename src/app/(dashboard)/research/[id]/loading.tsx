import { Skeleton } from "@/components/ui/skeleton";
import { HeaderSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="space-y-6">
      <HeaderSkeleton />
      <div className="grid gap-6 md:grid-cols-[320px_1fr]">
        <div className="space-y-2">
          <Skeleton className="aspect-square w-full rounded-xl" />
          <Skeleton className="h-9 w-full rounded-lg" />
        </div>
        <div className="space-y-3">
          <Skeleton className="h-6 w-2/3" />
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      </div>
    </div>
  );
}
