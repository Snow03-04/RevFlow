import { Flame } from "lucide-react";
import type { MetaRoasSignal } from "@/lib/trackers/meta-roas";
import { mult } from "@/lib/trackers/format";

export function MetaRoasBadge({ signal }: { signal?: MetaRoasSignal | null }) {
  if (!signal) return null;
  const date = (value: string) => `${value.slice(8, 10)}/${value.slice(5, 7)}`;
  const label = `ROAS estável: ≥ ${signal.threshold}x em cada um dos últimos ${signal.days} dias completos (${date(signal.from)}–${date(signal.to)}). ROAS do intervalo: ${mult(signal.roas)}. O dia de hoje não conta.`;
  return <span role="img" aria-label={label} title={label} className="inline-flex shrink-0 items-center justify-center rounded-md border border-orange-500/25 bg-orange-500/10 p-1 text-orange-600 dark:text-orange-400">
    <Flame aria-hidden className="h-3.5 w-3.5 fill-orange-500/20" />
  </span>;
}
