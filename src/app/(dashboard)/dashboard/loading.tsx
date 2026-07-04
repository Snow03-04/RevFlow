import { Skeleton } from "@/components/ui/skeleton";
import {
  HeaderSkeleton,
  DashboardMetricsSkeleton,
} from "@/components/dashboard/skeletons";

export default function Loading() {
  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <HeaderSkeleton />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Skeleton className="h-5 w-64" />
        <Skeleton className="h-10 w-80 rounded-lg" />
      </div>
      <DashboardMetricsSkeleton />
    </div>
  );
}
