import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Megaphone, Chrome, type LucideIcon } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getCampaignPerformance,
  resolveFxRate,
} from "@/lib/queries";
import { resolveRange } from "@/lib/date";
import type { CampaignPerformance } from "@/types";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelect } from "@/components/dashboard/range-select";
import { CampaignSearch } from "@/components/ads/campaign-search";
import { EmptyState } from "@/components/dashboard/empty-state";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatCurrency,
  formatMultiplier,
  formatPercent,
} from "@/lib/utils";

export const metadata: Metadata = { title: "Ads" };
export const dynamic = "force-dynamic";

export default async function AdsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; q?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const fxRate = await resolveFxRate(supabase, user.id, currency);

  const range = resolveRange(sp.range, tz);
  const [metaRows, googleRows] = await Promise.all([
    getCampaignPerformance(supabase, user.id, range, sp.q, fxRate, "campaigns"),
    getCampaignPerformance(supabase, user.id, range, sp.q, fxRate, "google_campaigns"),
  ]);
  const hasAny = metaRows.length + googleRows.length > 0;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Ads"
        description="Performance por campanha — Meta + Google Ads."
        actions={
          <>
            <CampaignSearch />
            <RangeSelect />
          </>
        }
      />

      {!hasAny ? (
        <EmptyState
          icon={Megaphone}
          title="No campaign data in this range"
          description="Connect Meta or Google Ads, or widen the date range, to see spend, ROAS and ad contribution by campaign."
          ctaHref="/connections"
          ctaLabel="Connect ad accounts"
        />
      ) : (
        <div className="space-y-6">
          {metaRows.length > 0 && (
            <CampaignTable
              title="Meta Ads"
              icon={Megaphone}
              color="#1877F2"
              rows={metaRows}
              currency={currency}
            />
          )}
          {googleRows.length > 0 && (
            <CampaignTable
              title="Google Ads"
              icon={Chrome}
              color="#4285F4"
              rows={googleRows}
              currency={currency}
            />
          )}
        </div>
      )}
    </div>
  );
}

function CampaignTable({
  title,
  icon: Icon,
  color,
  rows,
  currency,
}: {
  title: string;
  icon: LucideIcon;
  color: string;
  rows: CampaignPerformance[];
  currency: string;
}) {
  const totals = rows.reduce(
    (a, c) => {
      a.spend += c.spend;
      a.revenue += c.revenue;
      a.profit += c.profit;
      return a;
    },
    { spend: 0, revenue: 0, profit: 0 },
  );

  return (
    <Card>
      <div className="flex items-center gap-2 border-b border-border px-5 py-3">
        <span
          className="flex h-6 w-6 items-center justify-center rounded"
          style={{ backgroundColor: `${color}26`, color }}
        >
          <Icon className="h-3.5 w-3.5" />
        </span>
        <h3 className="text-sm font-medium">{title}</h3>
        <span className="ml-auto text-xs text-muted-foreground">
          {rows.length} campanhas
        </span>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Campaign</TableHead>
            <TableHead className="text-right">Spend</TableHead>
            <TableHead className="text-right">Revenue</TableHead>
            <TableHead className="text-right">Contribution</TableHead>
            <TableHead className="text-right">CPA</TableHead>
            <TableHead className="text-right">ROAS</TableHead>
            <TableHead className="text-right">CTR</TableHead>
            <TableHead className="text-right">CPM</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((c) => (
            <TableRow key={c.campaignId}>
              <TableCell className="max-w-[260px]">
                <p className="truncate text-sm font-medium">{c.name}</p>
                <p className="text-xs text-muted-foreground">
                  {c.purchases} purchases
                </p>
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(c.spend, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums">
                {formatCurrency(c.revenue, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums font-medium">
                {formatCurrency(c.profit, currency)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCurrency(c.cpa, currency)}
              </TableCell>
              <TableCell className="text-right">
                <Badge variant={c.roas >= 1 ? "success" : "destructive"}>
                  {formatMultiplier(c.roas)}
                </Badge>
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatPercent(c.ctr / 100)}
              </TableCell>
              <TableCell className="text-right tabular-nums text-muted-foreground">
                {formatCurrency(c.cpm, currency)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <div className="flex flex-wrap items-center justify-end gap-6 border-t border-border px-4 py-3 text-sm">
        <span className="text-muted-foreground">
          Spend{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(totals.spend, currency)}
          </span>
        </span>
        <span className="text-muted-foreground">
          Revenue{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(totals.revenue, currency)}
          </span>
        </span>
        <span className="text-muted-foreground">
          Contribution{" "}
          <span className="font-medium text-foreground">
            {formatCurrency(totals.profit, currency)}
          </span>
        </span>
      </div>
    </Card>
  );
}
