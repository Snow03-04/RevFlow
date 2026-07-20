import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getConnections,
  getStoreCurrency,
} from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { dashboardRanges } from "@/lib/date";
import { PageHeader } from "@/components/dashboard/page-header";
import { DashboardView } from "@/components/dashboard/dashboard-view";
import { LiveSpend } from "@/components/dashboard/live-spend";
import { ShareWin } from "@/components/dashboard/share-win";
import { ManualEntry } from "@/components/dashboard/manual-entry";
import { DashboardMetrics } from "@/components/dashboard/dashboard-metrics";
import { DashboardMetricsSkeleton } from "@/components/dashboard/skeletons";
import { EmptyState } from "@/components/dashboard/empty-state";

export const metadata: Metadata = { title: "Dashboard" };
export const dynamic = "force-dynamic";
// The "Atualizar" server action runs on this route; give it headroom above the
// platform default so a live refresh (orders + Meta spend + recompute) isn't cut
// off in production.
export const maxDuration = 30;

export default async function DashboardPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; from?: string; to?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  // Light queries only — the shell (header + period buttons) paints immediately.
  // The store currency is fetched in parallel (not after) to save a round-trip.
  const [settings, { shopify, meta, google }, storeCurrency] = await Promise.all([
    getSettings(supabase, user.id),
    getConnections(supabase, user.id),
    getStoreCurrency(supabase, user.id),
  ]);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const fxRate = await resolveFx(storeCurrency, currency, {
    storeCurrency,
    displayCurrency: currency,
    override: settings?.fx_rate_override,
  });
  const hasConnections =
    shopify.length > 0 || meta.length > 0 || google.length > 0;

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
  // Pure date math (no DB) — cheap enough to label the header in the shell.
  const { current } = dashboardRanges(period, tz, sp.from, sp.to);
  const rangeLabel =
    current.from === current.to
      ? current.from
      : `${current.from} → ${current.to}`;

  return (
    <div className="mx-auto max-w-7xl space-y-8">
      <PageHeader
        title="Dashboard"
        description="Your real-time profit command center."
        actions={
          <div className="flex items-center gap-4">
            <ManualEntry currency={currency} />
            <LiveSpend />
            <ShareWin period={period} from={sp.from} to={sp.to} />
          </div>
        }
      />

      {/* The client view owns the period buttons + pending state: clicking a
          period swaps to the skeleton instantly (no server wait). The <Suspense>
          keyed on the range streams the first load and each fresh navigation. */}
      <DashboardView
        period={period}
        from={sp.from}
        to={sp.to}
        rangeLabel={rangeLabel}
      >
        <Suspense
          key={`${period}:${sp.from ?? ""}:${sp.to ?? ""}`}
          fallback={<DashboardMetricsSkeleton />}
        >
          <DashboardMetrics
            userId={user.id}
            settings={settings}
            currency={currency}
            tz={tz}
            fxRate={fxRate}
            period={period}
            from={sp.from}
            to={sp.to}
            showAdBreakdown={meta.length > 0 || google.length > 0}
          />
        </Suspense>
      </DashboardView>
    </div>
  );
}
