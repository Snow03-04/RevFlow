import { BarChart3 } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getRangeComparison, getDailySeries } from "@/lib/queries";
import { dashboardRanges } from "@/lib/date";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { KpiCard, type MetricFormat } from "@/components/dashboard/kpi-card";
import { CostBreakdown } from "@/components/dashboard/cost-breakdown";
import { AdPlatformBreakdown } from "@/components/dashboard/ad-platform-breakdown";
import { CountUp } from "@/components/dashboard/count-up";
import { ChartCard } from "@/components/charts/chart-card";
import { SUBLABEL } from "@/lib/dashboard-labels";
import { cn } from "@/lib/utils";
import type { MetricsSummary } from "@/types";
import type { Tables } from "@/types/database";

// Hero KPIs — shown large at the top with accent colors
const HERO_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
}[] = [
  { key: "revenue", label: "Revenue", format: "currency" },
  { key: "profit", label: "Profit", format: "currency" },
];

// Secondary KPIs — shown smaller below
const SECONDARY_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
}[] = [
  { key: "profitMargin", label: "Profit Margin", format: "percent" },
  { key: "roas", label: "ROAS (real)", format: "multiplier" },
  { key: "ordersCount", label: "Orders", format: "number" },
  { key: "aov", label: "AOV", format: "currency" },
  { key: "conversionRate", label: "Conv. Rate", format: "percent" },
];

// Hero number colours. Revenue follows the themeable accent (text-primary →
// purple or gold); Profit is semantic: lightning green when positive, red when
// negative.
const PROFIT_POS = "#3DF88B"; // lightning green
const PROFIT_NEG = "#F87171"; // red-400

/**
 * The data-heavy part of the dashboard: recomputes the visible window, reads the
 * range comparison + 30-day series, and renders the KPIs / cost breakdown /
 * charts. Rendered inside a keyed <Suspense> so switching period shows a skeleton
 * immediately and streams the fresh numbers in.
 */
export async function DashboardMetrics({
  userId,
  storeId,
  settings,
  currency,
  tz,
  fxRate,
  period,
  from,
  to,
  showAdBreakdown,
}: {
  userId: string;
  storeId?: string; // undefined = all stores combined
  settings: Tables<"settings"> | null;
  currency: string;
  tz: string;
  fxRate: number;
  period: string;
  from?: string;
  to?: string;
  showAdBreakdown: boolean;
}) {
  const supabase = await createClient();
  const { current, previous } = dashboardRanges(period, tz, from, to);

  // Only TODAY's orders can still be changing. Past days are kept fresh by the
  // Shopify webhooks, the 15-min cron and COGS/settings edits (which each
  // recompute 90 days). So recompute just today's slice — and only for SHORT
  // views that actually include today (today / yesterday+today / last7 / week).
  // Long ranges (last30 / month / year) read the stored values directly: a
  // few-minutes lag on today is invisible there and it avoids extra DB work.
  const today = dashboardRanges("today", tz).current;
  const spanMs =
    new Date(current.to).getTime() - new Date(current.from).getTime();
  const includesToday = current.from <= today.to && today.from <= current.to;
  if (includesToday && spanMs <= 8 * 86_400_000) {
    try {
      // Pass the already-loaded settings so the recompute skips a duplicate fetch.
      await recomputeDailyMetrics(supabase, userId, today, { settings });
    } catch {
      /* best-effort — fall back to the stored values */
    }
  }

  const [comparison, series] = await Promise.all([
    getRangeComparison(supabase, userId, current, previous, fxRate, storeId),
    getDailySeries(supabase, userId, 30, tz, fxRate, storeId),
  ]);

  const revenueSeries = series.map((p) => ({ date: p.date, value: p.revenue }));
  const spendSeries = series.map((p) => ({ date: p.date, value: p.adSpend }));
  const profitSeries = series.map((p) => ({ date: p.date, value: p.profit }));
  const roasSeries = series.map((p) => ({ date: p.date, value: p.roas }));

  return (
    <div className="space-y-8">
      <section className="space-y-4">
        {/* ── Hero KPIs: Revenue · Profit ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {HERO_KPIS.map((k) => {
            const value = Number(comparison.current[k.key]);
            const prev = Number(comparison.previous[k.key]);
            const delta = prev !== 0 ? ((value - prev) / Math.abs(prev)) * 100 : 0;
            const positive = delta >= 0;

            const isProfit = k.key === "profit";
            const numberStyle: React.CSSProperties | undefined = isProfit
              ? { color: value < 0 ? PROFIT_NEG : PROFIT_POS }
              : undefined;
            const dotStyle: React.CSSProperties | undefined = isProfit
              ? { backgroundColor: value < 0 ? PROFIT_NEG : PROFIT_POS }
              : undefined;
            const cardAccent = isProfit
              ? value < 0
                ? "var(--destructive)"
                : "var(--chart-3)"
              : "var(--primary)";

            return (
              <div
                key={k.key}
                style={
                  {
                    "--card-accent": cardAccent,
                    backgroundImage:
                      "linear-gradient(135deg, hsl(var(--card-accent) / 0.13) 0%, hsl(var(--card-accent) / 0.04) 42%, transparent 72%)",
                    borderColor: "hsl(var(--card-accent) / 0.32)",
                  } as React.CSSProperties
                }
                className="group relative overflow-hidden rounded-2xl border bg-card p-5 transition-colors"
              >
                <div
                  aria-hidden
                  className="pointer-events-none absolute -right-6 -top-12 h-32 w-32 rounded-full blur-2xl"
                  style={{
                    background:
                      "radial-gradient(circle, hsl(var(--card-accent) / 0.30) 0%, transparent 70%)",
                  }}
                />
                <div className="relative z-10">
                  <div className="flex items-center gap-2">
                    <span
                      className={cn("h-1.5 w-1.5 rounded-full", !isProfit && "bg-primary")}
                      style={dotStyle}
                    />
                    <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                      {k.label}
                    </p>
                  </div>

                  <CountUp
                    value={value}
                    format={k.format}
                    currency={currency}
                    className={cn(
                      "mt-3 block text-3xl font-semibold tabular-nums leading-none",
                      !isProfit && "text-primary metric-gold",
                    )}
                    style={numberStyle}
                  />

                  <span
                    className={cn(
                      "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                      positive
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-red-500/15 text-red-400",
                    )}
                  >
                    {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%{" "}
                    <span className="font-normal opacity-70">
                      {SUBLABEL[period] ?? "vs anterior"}
                    </span>
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* ── Costs: COGS + Ad Spend = Total Costs ── */}
        <CostBreakdown
          cogs={Number(comparison.current.productCost)}
          adSpend={Number(comparison.current.adSpend)}
          prevCogs={Number(comparison.previous.productCost)}
          prevAdSpend={Number(comparison.previous.adSpend)}
          currency={currency}
          periodLabel={SUBLABEL[period] ?? "vs anterior"}
        />

        {/* ── Ad spend split by platform (Meta · Google · Total) ── */}
        {showAdBreakdown && (
          <AdPlatformBreakdown
            meta={Number(comparison.current.adSpendMeta)}
            google={Number(comparison.current.adSpendGoogle)}
            roasTotal={Number(comparison.current.roas)}
            currency={currency}
          />
        )}

        {/* ── Secondary KPIs ── */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {SECONDARY_KPIS.map((k) => (
            <KpiCard
              key={k.key}
              label={k.label}
              value={Number(comparison.current[k.key])}
              previous={Number(comparison.previous[k.key])}
              format={k.format}
              currency={currency}
            />
          ))}
        </div>
      </section>

      <section className="space-y-4">
        <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
          <BarChart3 className="h-4 w-4" />
          Last 30 days
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <ChartCard
            title="Revenue"
            subtitle="Net revenue per day"
            data={revenueSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-1))"
          />
          <ChartCard
            title="Ad spend"
            subtitle="Meta Ads spend per day"
            data={spendSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-2))"
          />
          <ChartCard
            title="Profit"
            subtitle="True profit per day"
            data={profitSeries}
            format="currency"
            currency={currency}
            color="hsl(var(--chart-3))"
          />
          <ChartCard
            title="ROAS"
            subtitle="Return on ad spend per day"
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
