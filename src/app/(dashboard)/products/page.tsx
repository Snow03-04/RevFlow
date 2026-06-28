import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Package } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getProductPerformance,
  getStoreCurrency,
  resolveFxRate,
  type ProductSort as SortKey,
} from "@/lib/queries";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { resolveRange } from "@/lib/date";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelect } from "@/components/dashboard/range-select";
import { ProductSort } from "@/components/products/product-sort";
import { LocalizeProducts } from "@/components/products/localize-products";
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

type PerfRow = Awaited<ReturnType<typeof getProductPerformance>>[number];
interface GroupedProduct extends PerfRow {
  variantCount: number;
}

/**
 * Collapse the per-variant rows into one row per product (same idea as the
 * COGS page) so a product with several variants shows up once, with its
 * units / revenue / cost / profit summed across variants.
 */
function groupByProduct(rows: PerfRow[], sort: SortKey): GroupedProduct[] {
  const map = new Map<string, GroupedProduct>();
  for (const r of rows) {
    const key = r.productId || r.variantId || r.title;
    const ex = map.get(key);
    if (!ex) {
      map.set(key, { ...r, variantCount: 1 });
    } else {
      ex.unitsSold += r.unitsSold;
      ex.revenue += r.revenue;
      ex.cost += r.cost;
      ex.profit += r.profit;
      ex.variantCount += 1;
      if (!ex.imageUrl && r.imageUrl) ex.imageUrl = r.imageUrl;
    }
  }
  const grouped = [...map.values()];
  for (const g of grouped) g.margin = g.revenue > 0 ? g.profit / g.revenue : 0;
  grouped.sort((a, b) => {
    if (sort === "best") return b.unitsSold - a.unitsSold;
    if (sort === "worst") return a.profit - b.profit;
    return b.profit - a.profit;
  });
  return grouped;
}

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; sort?: string; lang?: string }>;
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
  const products = groupByProduct(rows, sort);

  // Localization overlay (translated title + suggested price) for ?lang=.
  const lang = sp.lang?.trim() || undefined;
  const storeCurrency = (await getStoreCurrency(supabase, user.id)) ?? currency;
  const locByProduct = new Map<
    string,
    { title: string | null; price: number | null; currency: string | null }
  >();
  if (lang) {
    const locs = await selectAllByUser<{
      shopify_product_id: string;
      title: string | null;
      converted_price: number | null;
      target_currency: string | null;
    }>(
      supabase,
      "product_localizations",
      "shopify_product_id, title, converted_price, target_currency",
      user.id,
      (q) => q.eq("lang", lang),
    );
    for (const l of locs) {
      locByProduct.set(l.shopify_product_id, {
        title: l.title,
        price: l.converted_price != null ? Number(l.converted_price) : null,
        currency: l.target_currency,
      });
    }
  }
  const showLocalized = !!lang;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Products"
        description="Units, revenue and true profit by product."
        actions={
          <>
            <LocalizeProducts
              defaultFrom={storeCurrency}
              defaultTo={currency}
              currentLang={lang}
            />
            <ProductSort />
            <RangeSelect />
          </>
        }
      />

      {products.length === 0 ? (
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
                {showLocalized && (
                  <TableHead className="text-right">Preço sugerido</TableHead>
                )}
                <TableHead className="text-right">Units</TableHead>
                <TableHead className="text-right">Revenue</TableHead>
                <TableHead className="text-right">Cost</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {products.map((p) => {
                const loc = locByProduct.get(p.productId);
                return (
                <TableRow key={p.productId || p.variantId || p.title}>
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
                          {loc?.title || p.title}
                        </p>
                        {p.variantCount > 1 ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {p.variantCount} variantes
                          </p>
                        ) : p.sku ? (
                          <p className="truncate text-xs text-muted-foreground">
                            {p.sku}
                          </p>
                        ) : null}
                      </div>
                    </div>
                  </TableCell>
                  {showLocalized && (
                    <TableCell className="text-right font-medium tabular-nums whitespace-nowrap">
                      {loc?.price != null
                        ? formatCurrency(loc.price, loc.currency ?? currency)
                        : "—"}
                    </TableCell>
                  )}
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
                );
              })}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
}
