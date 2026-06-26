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
import { ChartCard } from "@/components/charts/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
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
  {
    key: "adSpend",
    label: "Ad Spend",
    format: "currency",
    accent: "#0ea5e9",   // sky-500
    accentTo: "#7dd3fc", // sky-300
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

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings   = await getSettings(supabase, user.id);
  const currency   = settings?.currency ?? "USD";
  const tz         = settings?.timezone ?? "UTC";
  const fxRate     = await resolveFxRate(supabase, user.id, currency);

  const { shopify, meta } = await getConnections(supabase, user.id);
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
    <div className="space-y-8">
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

        {/* ── Hero KPIs: Revenue · Profit · Ad Spend ── */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          {HERO_KPIS.map((k) => {
            const value    = Number(comparison.current[k.key]);
            const previous = Number(comparison.previous[k.key]);
            const delta    = previous !== 0 ? ((value - previous) / Math.abs(previous)) * 100 : 0;
            const positive = delta >= 0;

            // Para Profit, usar cores vermelhas quando negativo
            let accentColor = k.accent;
            let accentColorTo = k.accentTo;
            if (k.key === "profit" && value < 0) {
              accentColor = "#dc2626";   // red-600
              accentColorTo = "#ef4444"; // red-500
            }

            return (
              <div
                key={k.key}
                style={{
                  background: `linear-gradient(135deg, ${accentColor}18 0%, ${accentColorTo}10 100%)`,
                  borderColor: `${accentColor}40`,
                }}
                className="relative overflow-hidden rounded-2xl border p-5 backdrop-blur-sm"
              >
                {/* Glow orb */}
                <div
                  style={{
                    background: `radial-gradient(circle at 80% 20%, ${accentColor}30 0%, transparent 60%)`,
                  }}
                  className="pointer-events-none absolute inset-0"
                />

                <p className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
                  {k.label}
                </p>

                {/* Value — delegate formatting to KpiCard but hide its shell,
                    OR just render the number directly for full control */}
                <p
                  style={{ color: accentColor }}
                  className="mt-2 text-3xl font-bold tabular-nums leading-none"
                >
                  <KpiCardValue
                    value={value}
                    format={k.format}
                    currency={currency}
                    metricKey={k.key}
                  />
                </p>

                {/* Delta badge */}
                <span
                  className={[
                    "mt-3 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                    positive
                      ? "bg-emerald-500/15 text-emerald-400"
                      : "bg-red-500/15 text-red-400",
                  ].join(" ")}
                >
                  {positive ? "▲" : "▼"} {Math.abs(delta).toFixed(1)}%{" "}
                  <span className="font-normal opacity-70">
                    {SUBLABEL[period] ?? "vs anterior"}
                  </span>
                </span>
              </div>
            );
          })}
        </div>

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
            color="hsl(263 70% 60%)"
          />
          <ChartCard
            title="Ad spend"
            subtitle="Meta Ads spend per day"
            data={spendSeries}
            format="currency"
            currency={currency}
            color="hsl(199 89% 48%)"
          />
          <ChartCard
            title="Profit"
            subtitle="True profit per day"
            data={profitSeries}
            format="currency"
            currency={currency}
            color="hsl(152 69% 48%)"
          />
          <ChartCard
            title="ROAS"
            subtitle="Return on ad spend per day"
            data={roasSeries}
            format="multiplier"
            type="bar"
            color="hsl(38 92% 55%)"
          />
        </div>
      </section>
    </div>
  );
}

// ── Inline helper: format a raw number for display ──────────────────────────
// Keeps the hero cards self-contained without a new file.
function KpiCardValue({
  value,
  format,
  currency,
  metricKey,
}: {
  value: number;
  format: MetricFormat;
  currency: string;
  metricKey: string;
}) {
  if (format === "currency") {
    return (
      <>
        {new Intl.NumberFormat("en-US", {
          style: "currency",
          currency,
          maximumFractionDigits: 2,
        }).format(value)}
      </>
    );
  }
  if (format === "percent") {
    return <>{value.toFixed(1)}%</>;
  }
  if (format === "multiplier") {
    return <>{value.toFixed(2)}x</>;
  }
  return <>{value}</>;
}
