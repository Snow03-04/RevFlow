import { TrackerSkeleton } from "@/components/dashboard/skeletons";

export default function Loading() {
  return <div role="status" aria-label="A carregar Finance"><span className="sr-only">A carregar os dados financeiros…</span><TrackerSkeleton /></div>;
}
