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
import { KpiCard, type MetricFormat } from "@/components/dashboard/kpi-card";
import { ChartCard } from "@/components/charts/chart-card";
import { EmptyState } from "@/components/dashboard/empty-state";
import type { MetricsSummary } from "@/types";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";

const KPIS: {
  key: keyof MetricsSummary;
  label: string;
  format: MetricFormat;
  highlight?: boolean;
}[] = [
  { key: "revenue", label: "Revenue", format: "currency" },
  { key: "adSpend", label: "Ad Spend", format: "currency" },
  { key: "profit", label: "Profit", format: "currency", highlight: true },
  { key: "profitMargin", label: "Profit Margin", format: "percent" },
  { key: "roas", label: "ROAS", format: "multiplier" },
  { key: "mer", label: "MER", format: "multiplier" },
  { key: "ordersCount", label: "Orders", format: "number" },
  { key: "aov", label: "AOV", format: "currency" },
  { key: "conversionRate", label: "Conversion Rate", format: "percent" },
];

const SUBLABEL: Record<string, string> = {
  today: "vs ontem",
  yesterday: "vs anteontem",
  last7: "vs 7 dias anteriores",
  last30: "vs 30 dias anteriores",
  week: "vs semana passada",
  month: "vs mês passado",
  year: "vs período anterior",
  custom: "vs período anterior",
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

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const fxRate = await resolveFxRate(supabase, user.id, currency);

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
  const spendSeries = series.map((p) => ({ date: p.date, value: p.adSpend }));
  const profitSeries = series.map((p) => ({ date: p.date, value: p.profit }));
  const roasSeries = series.map((p) => ({ date: p.date, value: p.roas }));

  const rangeLabel =
    current.from === current.to
      ? current.from
      : `${current.from} → ${current.to}`;

  return (
    <div className="space-y-8">
      <PageHeader
        title="Dashboard"
        description="Your real-time profit command center."
      />

      <section className="space-y-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-sm font-medium text-muted-foreground">
            Performance · {SUBLABEL[period] ?? "vs período anterior"} · {rangeLabel}
          </h2>
          <PeriodSelector period={period} from={sp.from} to={sp.to} />
        </div>

        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {KPIS.map((k) => (
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
            color="hsl(var(--primary))"
          />
          <ChartCard
            title="Ad spend"
            subtitle="Meta Ads spend per day"
            data={spendSeries}
            format="currency"
            currency={currency}
            color="hsl(330 80% 60%)"
          />
          <ChartCard
            title="Profit"
            subtitle="True profit per day"
            data={profitSeries}
            format="currency"
            currency={currency}
            color="hsl(142 69% 48%)"
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
