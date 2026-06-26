import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getProductPerformance,
  resolveFxRate,
  type ProductSort as SortKey,
} from "@/lib/queries";
import { resolveRange } from "@/lib/date";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelect } from "@/components/dashboard/range-select";
import { ProductSort } from "@/components/products/product-sort";
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
import { formatCurrency, formatNumber, formatPercent } from "@/lib/utils";

export const metadata: Metadata = { title: "Products" };
export const dynamic = "force-dynamic";

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; sort?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const fallbackPct = Number(settings?.default_product_cost_pct ?? 30);
  const fxRate = await resolveFxRate(supabase, user.id, currency);

  const range = resolveRange(sp.range, tz);
  const sort = (sp.sort as SortKey) ?? "best";
  const rows = await getProductPerformance(
    supabase,
    user.id,
    range,
    sort,
    tz,
    fallbackPct,
    fxRate,
  );

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Units, revenue and true profit by product."
        actions={
          <>
            <ProductSort />
            <RangeSelect />
          </>
        }
      />

      {rows.length === 0 ? (
        <EmptyState
          icon={Package}
          title="No product sales in this range"
          description="Once orders sync from Shopify, your best and worst performers will appear here. Try widening the date range."
          ctaHref="/connections"
          ctaLabel="Check connections"
        />
      ) : (
        <Card>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Product</TableHead>
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((p) => (
                <TableRow key={p.variantId || p.title}>
                  <TableCell>
                    <div className="flex items-center gap-3">
                      {p.imageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={p.imageUrl}
                          alt=""
                          className="h-9 w-9 shrink-0 rounded-md border border-border object-cover"
                        />
                      ) : (
                        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-border bg-muted">
                          <Package className="h-4 w-4 text-muted-foreground" />
                        </div>
                      )}
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">
                          {p.title}
                        </p>
                        {p.sku && (
                          <p className="truncate text-xs text-muted-foreground">
                            {p.sku}
                          </p>
                        )}
                      </div>
                    </div>
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatNumber(p.unitsSold)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {formatCurrency(p.revenue, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {formatCurrency(p.cost, currency)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums font-medium">
                    {formatCurrency(p.profit, currency)}
                  </TableCell>
                  <TableCell className="text-right">
                    <Badge
                      variant={
                        p.margin >= 0.3
                          ? "success"
                          : p.margin >= 0
                            ? "muted"
                            : "destructive"
                      }
                    >
                      {formatPercent(p.margin)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
