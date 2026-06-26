import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Megaphone } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getCampaignPerformance,
  resolveFxRate,
} from "@/lib/queries";
import { resolveRange } from "@/lib/date";
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
  const rows = await getCampaignPerformance(
    supabase,
    user.id,
    range,
    sp.q,
    fxRate,
  );

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
    <div className="space-y-6">
      <PageHeader
        title="Ads"
        description="Meta Ads performance and contribution by campaign."
        actions={
          <>
            <CampaignSearch />
            <RangeSelect />
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="No campaign data in this range"
          description="Connect Meta Ads or widen the date range to see spend, ROAS and ad contribution by campaign."
          ctaHref="/connections"
          ctaLabel="Connect Meta Ads"
        />
      ) : (
        <Card>
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
      )}
    </div>
  );
}
