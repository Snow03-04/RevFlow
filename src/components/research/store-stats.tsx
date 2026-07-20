import { CountUp } from "@/components/dashboard/count-up";
import type { StoreStats } from "@/lib/research/store-queries";

export function StoreStatsBar({ stats }: { stats: StoreStats }) {
  const tiles: { label: string; value: number; cls?: string }[] = [
    { label: "Total", value: stats.total },
    { label: "A observar", value: stats.byStatus.watching },
    { label: "Interessantes", value: stats.byStatus.interesting, cls: "text-sky-400" },
    { label: "Top Stores", value: stats.byStatus.winner, cls: "text-emerald-400" },
    { label: "Concorrentes", value: stats.byStatus.competitor, cls: "text-amber-400" },
    { label: "Arquivadas", value: stats.byStatus.archived },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
      {tiles.map((t) => (
        <div
          key={t.label}
          className="rounded-xl border border-border/60 bg-card p-3"
        >
          <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
            {t.label}
          </p>
          <CountUp
            value={t.value}
            format="number"
            className={`mt-1 block text-2xl font-semibold tabular-nums ${t.cls ?? ""}`}
          />
        </div>
      ))}
    </div>
  );
}
