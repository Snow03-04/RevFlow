import { CountUp } from "@/components/dashboard/count-up";
import type { ResearchStats } from "@/lib/research/queries";

export function ResearchStatsBar({ stats }: { stats: ResearchStats }) {
  const tiles: { label: string; value: number; cls?: string }[] = [
    { label: "Total", value: stats.total },
    { label: "Não testados", value: stats.byStatus.untested },
    { label: "Em teste", value: stats.byStatus.testing, cls: "text-sky-400" },
    { label: "Vencedores", value: stats.byStatus.winner, cls: "text-emerald-400" },
    { label: "Perdedores", value: stats.byStatus.loser, cls: "text-red-400" },
    { label: "Escalar", value: stats.byStatus.scaling, cls: "text-primary" },
    { label: "Arquivados", value: stats.byStatus.archived },
    { label: "Anúncios", value: stats.totalAds, cls: "text-primary" },
  ];

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 xl:grid-cols-8">
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
