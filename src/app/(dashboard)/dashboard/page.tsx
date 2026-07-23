import type { Metadata } from "next";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getConnections,
  getStoreFxRates,
} from "@/lib/queries";
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
  searchParams: Promise<{
    period?: string;
    from?: string;
    to?: string;
    store?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  // Light queries only — the shell (header + period buttons) paints immediately.
  const [settings, { shopify, meta, google }] = await Promise.all([
    getSettings(supabase, user.id),
    getConnections(supabase, user.id),
  ]);
  // Resolve the selected store from the URL; an unknown/stale id falls back to
  // "all stores" (undefined) so a bad link never shows an empty dashboard.
  const storeId = shopify.some((s) => s.id === sp.store) ? sp.store : undefined;
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  // Per-store base→display rates — each store's rows are converted by its own
  // rate before summing, so a EUR + HUF mix totals correctly.
  const storeRates = await getStoreFxRates(
    supabase,
    user.id,
    currency,
    settings?.fx_rate_override,
  );
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
          key={`${period}:${sp.from ?? ""}:${sp.to ?? ""}:${storeId ?? "all"}`}
          fallback={<DashboardMetricsSkeleton />}
        >
          <DashboardMetrics
            userId={user.id}
            storeId={storeId}
            storeRates={storeRates}
            settings={settings}
            currency={currency}
            tz={tz}
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
