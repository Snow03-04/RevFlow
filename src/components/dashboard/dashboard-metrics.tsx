import Link from "next/link";
import { BarChart3, ListChecks } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRangeComparison, getDailySeries } from "@/lib/queries";
import { dashboardRanges, lastNDays, todayYmd } from "@/lib/date";
import { getGoogleSpendEstimates, googleEstimateTotal, includeGoogleEstimate, includeGoogleEstimatesInSeries } from "@/lib/google/spend-estimates";
import { getGoogleScriptWarnings } from "@/lib/google/script-health";
import type { NamedStore } from "@/lib/google/store-labels";
import { cogsImpact } from "@/lib/profit";
import { KpiCard, type MetricFormat } from "@/components/dashboard/kpi-card";
import { CostBreakdown } from "@/components/dashboard/cost-breakdown";
import { AdPlatformBreakdown } from "@/components/dashboard/ad-platform-breakdown";
import { HeroMetric } from "@/components/dashboard/hero-metric";
import { ChartCard } from "@/components/charts/chart-card";
import { formatPercent } from "@/lib/utils";
import type { MetricsSummary } from "@/types";

// Hero KPIs — shown large at the top with accent colors
const HERO_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
}[] = [
  { key: "revenue", label: "Receita", format: "currency" },
  { key: "profit", label: "Lucro estimado", format: "currency" },
];

// Secondary KPIs — shown smaller below
const SECONDARY_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
}[] = [
  { key: "ordersCount", label: "Encomendas", format: "number" },
  { key: "unitsSold", label: "Itens encomendados", format: "number" },
  { key: "profitMargin", label: "Margem de lucro", format: "percent" },
  { key: "roas", label: "ROAS", format: "multiplier" },
  { key: "aov", label: "AOV", format: "currency" },
];

/**
 * The data-heavy part of the dashboard: reads the
 * range comparison + 30-day series, and renders the KPIs / cost breakdown /
 * charts. Rendered inside a keyed <Suspense> so switching period shows a skeleton
 * immediately and streams the fresh numbers in.
 */
export async function DashboardMetrics({
  userId,
  storeId,
  storeRates,
  currency,
  tz,
  period,
  from,
  to,
  showAdBreakdown,
  googleScriptStores = [],
}: {
  userId: string;
  storeId?: string; // undefined = all stores combined
  storeRates: Map<string, number>; // per-store base→display FX
  currency: string;
  tz: string;
  period: string;
  from?: string;
  to?: string;
  showAdBreakdown: boolean;
  googleScriptStores?: NamedStore[];
}) {
  const supabase = await createClient();
  const { current, previous } = dashboardRanges(period, tz, from, to);
  const chartRange = lastNDays(30, tz);
  const estimateRange = { from: [current.from, previous.from, chartRange.from].sort()[0], to: [current.to, previous.to, chartRange.to].sort().at(-1)! };

  // Rendering only reads rollups. The shared refresh recomputes after every
  // source has finished, so navigation cannot race with an in-progress import.
  const [rawComparison, rawSeries, googleWarnings, googleEstimates] = await Promise.all([
    getRangeComparison(
      supabase,
      userId,
      current,
      previous,
      storeRates,
      storeId,
    ),
    getDailySeries(supabase, userId, 30, tz, storeRates, storeId),
    getGoogleScriptWarnings(supabase, userId, googleScriptStores, current, todayYmd(tz), storeId),
    getGoogleSpendEstimates(supabase, userId, googleScriptStores, estimateRange, storeRates, storeId),
  ]);
  const googleEstimatedAmount = googleEstimateTotal(googleEstimates, current);
  const comparison = {
    current: includeGoogleEstimate(rawComparison.current, googleEstimatedAmount),
    previous: includeGoogleEstimate(rawComparison.previous, googleEstimateTotal(googleEstimates, previous)),
  };
  const series = includeGoogleEstimatesInSeries(rawSeries, googleEstimates);
  const hasAdBreakdown = showAdBreakdown || googleWarnings.length > 0 || comparison.current.adSpendGoogle !== 0;

  const revenueSeries = series.map((p) => ({ date: p.date, value: p.revenue }));
  const spendSeries = series.map((p) => ({ date: p.date, value: p.adSpend }));
  const profitSeries = series.map((p) => ({ date: p.date, value: p.profit }));
  const roasSeries = series.map((p) => ({ date: p.date, value: p.roas }));

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        {/* ── Hero KPIs: Revenue · Profit ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {HERO_KPIS.map((k) => (
            <HeroMetric
              key={k.key}
              value={Number(comparison.current[k.key])}
              currency={currency}
              profit={k.key === "profit"}
              daily={current.from === current.to}
            />
          ))}
        </div>

        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl border border-border bg-border md:grid-cols-3 xl:grid-cols-6">
          {SECONDARY_KPIS.map((k) => (
            <KpiCard
              key={k.key}
              label={k.label}
              value={Number(comparison.current[k.key])}
              format={k.format}
              currency={currency}
              compact
            />
          ))}
          <KpiCard
            label="COGS Impact"
            value={cogsImpact(comparison.current.productCost, comparison.current.revenue)}
            format="percent"
            compact
          />
        </div>

        {/* ── Costs: COGS + Ad Spend = Total Costs ── */}
        <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
          <h2 className="text-sm font-medium">Custos e publicidade</h2>
          <Link
            href={`/cogs-audit?range=${period === "today" || period === "yesterday" ? "today" : "last7"}`}
            className="inline-flex items-center gap-1.5 text-xs text-muted-foreground transition-colors hover:text-primary"
          >
            <ListChecks className="h-3.5 w-3.5" />
            Ver COGS por encomenda
          </Link>
        </div>
        <div className={hasAdBreakdown ? "grid items-stretch gap-4 xl:grid-cols-[1.6fr_1fr]" : ""}>
        <CostBreakdown
          cogs={Number(comparison.current.productCost)}
          adSpend={Number(comparison.current.adSpend)}
          paymentFees={Number(comparison.current.paymentFees)}
          shippingCost={Number(comparison.current.shippingCost)}
          currency={currency}
        />

        {/* ── Ad spend split by platform (Meta · Google · Total) ── */}
        {hasAdBreakdown && (
          <AdPlatformBreakdown
            meta={Number(comparison.current.adSpendMeta)}
            google={Number(comparison.current.adSpendGoogle)}
            currency={currency}
            googlePending={googleWarnings.length > 0}
            googleEstimated={googleEstimatedAmount > 0}
          />
        )}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          Últimos 30 dias
          <span className="ml-auto text-xs font-normal">Conversão do período · {formatPercent(comparison.current.conversionRate)}</span>
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Receita"
            subtitle="Receita líquida diária"
            data={revenueSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-1))"
          />

          <ChartCard
            title="Lucro estimado"
            subtitle="Após os custos registados"
            data={profitSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-3))"
          />
          <ChartCard
            title="Publicidade"
            subtitle="Meta + Google por dia"
            data={spendSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-2))"
          />
          <ChartCard
            title="ROAS"
            subtitle="Retorno da publicidade por dia"
            data={roasSeries}
            format="multiplier"
            type="bar"
            color="hsl(var(--chart-4))"
          />
        </div>
      </section>
    </div>
  );
}
