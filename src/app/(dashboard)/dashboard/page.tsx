import type { Metadata } from "next";
import { BarChart3 } from "lucide-react";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getRangeComparison,
  getDailySeries,
  getConnections,
  resolveFxRate,
} from "@/lib/queries";
import { dashboardRanges } from "@/lib/date";
import { PageHeader } from "@/components/dashboard/page-header";
import { PeriodSelector } from "@/components/dashboard/period-selector";
import { LiveSpend } from "@/components/dashboard/live-spend";
import { KpiCard, type MetricFormat } from "@/components/dashboard/kpi-card";
import { CostBreakdown } from "@/components/dashboard/cost-breakdown";
import { CountUp } from "@/components/dashboard/count-up";
import { ChartCard } from "@/components/charts/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import { cn } from "@/lib/utils";
import type { MetricsSummary } from "@/types";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

// Hero KPIs — shown large at the top with accent colors
const HERO_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
  accent: string;          // gradient-from color
  accentTo: string;        // gradient-to color
  highlight?: boolean;
}[] = [
  {
    key: "revenue",
    label: "Revenue",
    format: "currency",
    accent: "#7c3aed",   // violet-700
    accentTo: "#a78bfa", // violet-400
  },
  {
    key: "profit",
    label: "Profit",
    format: "currency",
    accent: "#059669",   // emerald-600
    accentTo: "#34d399", // emerald-400
    highlight: true,
  },
];

// Secondary KPIs — shown smaller below
const SECONDARY_KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
  highlight?: boolean;
}[] = [
  { key: "profitMargin", label: "Profit Margin", format: "percent" },
  { key: "roas",         label: "ROAS",          format: "multiplier" },
  { key: "mer",          label: "MER",            format: "multiplier" },
  { key: "ordersCount",  label: "Orders",         format: "number" },
  { key: "aov",          label: "AOV",            format: "currency" },
  { key: "conversionRate", label: "Conv. Rate",   format: "percent" },
];

const SUBLABEL: Record<string, string> = {
  today:     "vs ontem",
  yesterday: "vs anteontem",
  last7:     "vs 7 dias anteriores",
  last30:    "vs 30 dias anteriores",
  week:      "vs semana passada",
  month:     "vs mês passado",
  year:      "vs período anterior",
  custom:    "vs período anterior",
};

// Hero number colours. Revenue follows the themeable accent (text-primary →
// purple or gold); Profit is semantic: lightning green when positive, red when
// negative. Kept as CSS values so only the number carries colour (clean cards).
const PROFIT_POS = "#3DF88B"; // lightning green
const PROFIT_NEG = "#F87171"; // red-400

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  // Independent queries in parallel — faster first paint.
  const [settings, { shopify, meta }] = await Promise.all([
    getSettings(supabase, user.id),
    getConnections(supabase, user.id),
  ]);
  const currency   = settings?.currency ?? "USD";
  const tz         = settings?.timezone ?? "UTC";
  const fxRate     = await resolveFxRate(supabase, user.id, currency);
  const hasConnections = shopify.length > 0 || meta.length > 0;

  if (!hasConnections) {
    return (
      <>
        <PageHeader
          title="Dashboard"
          description="Your real-time profit command center."
        />
        <EmptyState
          title="Connect a store to get started"
          description="Link your Shopify store and Meta Ads account to start tracking revenue, ad spend and true profit in real time."
          ctaHref="/connections"
          ctaLabel="Connect Shopify & Meta"
        />
      </>
    );
  }

  const period = sp.period ?? "today";
  const { current, previous } = dashboardRanges(period, tz, sp.from, sp.to);

  const [comparison, series] = await Promise.all([
    getRangeComparison(supabase, user.id, current, previous, fxRate),
    getDailySeries(supabase, user.id, 30, tz, fxRate),
  ]);

  const revenueSeries = series.map((p) => ({ date: p.date, value: p.revenue }));
  const spendSeries   = series.map((p) => ({ date: p.date, value: p.adSpend }));
  const profitSeries  = series.map((p) => ({ date: p.date, value: p.profit }));
  const roasSeries    = series.map((p) => ({ date: p.date, value: p.roas }));

  const rangeLabel =
    current.from === current.to
      ? current.from
      : `${current.from} → ${current.to}`;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        title="Dashboard"
        description="Your real-time profit command center."
        actions={<LiveSpend />}
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Performance · {SUBLABEL[period] ?? "vs período anterior"} · {rangeLabel}
          </h2>
          <PeriodSelector period={period} from={sp.from} to={sp.to} />
        </div>

        {/* ── Hero KPIs: Revenue · Profit ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {HERO_KPIS.map((k) => {
            const value    = Number(comparison.current[k.key]);
            const previous = Number(comparison.previous[k.key]);
            const delta    = previous !== 0 ? ((value - previous) / Math.abs(previous)) * 100 : 0;
            const positive = delta >= 0;

            // Accent lives ONLY on the number. Revenue = themeable accent;
            // Profit = green/red. The card itself stays clean & neutral.
            const isProfit = k.key === "profit";
            const numberStyle: React.CSSProperties | undefined = isProfit
              ? { color: value < 0 ? PROFIT_NEG : PROFIT_POS }
              : undefined;
            const dotStyle: React.CSSProperties | undefined = isProfit
              ? { backgroundColor: value < 0 ? PROFIT_NEG : PROFIT_POS }
              : undefined;
            // Themeable accent for the card tint + glow. Revenue follows --primary
            // (purple → gold with the theme); Profit is green (red when negative).
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
                {/* Soft accent glow — follows the theme via --card-accent. */}
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
                      !isProfit && "text-primary",
                    )}
                    style={numberStyle}
                  />

                  {/* Delta badge */}
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
              highlight={k.highlight}
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

