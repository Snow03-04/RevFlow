import type { Tables } from "@/types/database";

export type DailyMetric = Tables<"daily_metrics">;
export type Order = Tables<"orders">;
export type Product = Tables<"products">;
export type Campaign = Tables<"campaigns">;
export type GoogleCampaign = Tables<"google_campaigns">;
export type Settings = Tables<"settings">;
export type ShopifyConnection = Tables<"shopify_connections">;
export type MetaConnection = Tables<"meta_connections">;
export type GoogleConnection = Tables<"google_connections">;

/** A single headline KPI shown on the dashboard. */
export interface KpiValue {
  key: string;
  label: string;
  value: number;
  previous: number;
  format: "currency" | "number" | "percent" | "multiplier";
  /** When true, a *decrease* is good (e.g. CPA, ad spend in some views). */
  invertTrend?: boolean;
}

/** Aggregated P&L over an arbitrary date range. */
export interface MetricsSummary {
  revenue: number;
  grossRevenue: number;
  refunds: number;
  adSpend: number; // total (Meta + Google)
  adSpendMeta: number;
  adSpendGoogle: number;
  productCost: number;
  shippingCost: number;
  paymentFees: number;
  profit: number;
  profitMargin: number;
  roas: number;
  mer: number;
  ordersCount: number;
  unitsSold: number;
  aov: number;
  conversionRate: number;
  conversionValue: number;
}

export interface DateRange {
  from: string; // ISO date (yyyy-mm-dd)
  to: string; // ISO date (yyyy-mm-dd)
}

/** Per-product profitability row used by the Products page. */
export interface ProductPerformance {
  productId: string;
  variantId: string;
  title: string;
  sku: string | null;
  imageUrl: string | null;
  unitsSold: number;
  revenue: number;
  cost: number;
  profit: number;
  margin: number;
}

/** Per-campaign performance row used by the Ads page. */
export interface CampaignPerformance {
  campaignId: string;
  name: string;
  spend: number;
  impressions: number;
  clicks: number;
  ctr: number;
  cpm: number;
  cpc: number;
  cpa: number;
  purchases: number;
  revenue: number;
  profit: number;
  roas: number;
}
