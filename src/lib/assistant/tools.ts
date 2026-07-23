import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import {
  getRangeComparison,
  getDailySeries,
  getProductPerformance,
  getCampaignPerformance,
  getProductsForCogs,
  getConnections,
  type ProductSort,
} from "@/lib/queries";
import { dashboardRanges } from "@/lib/date";
import { syncNowAction, refreshMetaSpendAction } from "@/lib/connections/actions";
import { recomputeAllMetricsAction } from "@/lib/cogs/actions";
import { autofillRoasAllDays } from "@/lib/trackers/actions";

type DB = SupabaseClient<Database>;

/** Everything a tool needs, resolved once per request. */
export interface AssistantContext {
  supabase: DB;
  userId: string;
  currency: string; // display currency (e.g. EUR)
  timezone: string;
  fxRate: number; // store -> display (single, for user-wide product/campaign reads)
  storeRates: Map<string, number>; // per-store base->display (for daily_metrics)
  fallbackCostPct: number;
}

/** A mutating action the model proposes; executed only after the user confirms. */
export interface PendingAction {
  type: "set_product_cost";
  productId: string;
  title: string;
  cost: number;
  currency: string;
}

export interface ToolOutcome {
  result: string; // JSON/text returned to the model
  pendingAction?: PendingAction; // surfaced to the UI for human confirmation
  activity?: string; // short label for the "thinking" UI ("Consultei Revenue…")
}

const PERIOD_ENUM = [
  "today",
  "yesterday",
  "last7",
  "last30",
  "week",
  "month",
  "year",
  "custom",
];

/* ------------------------------------------------------------------ */
/* Tool schemas (what Claude sees)                                     */
/* ------------------------------------------------------------------ */

export const ASSISTANT_TOOLS: Anthropic.Tool[] = [
  {
    name: "get_metrics",
    description:
      "Get the store's KPIs for a period vs the previous comparable period: revenue, ad spend, profit, profit margin, ROAS, MER, orders, AOV, conversion rate, COGS, shipping cost, payment fees. Use this for any question about how the business is doing.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_ENUM, description: "Time period" },
        from: { type: "string", description: "Custom start yyyy-mm-dd (period=custom)" },
        to: { type: "string", description: "Custom end yyyy-mm-dd (period=custom)" },
      },
      required: ["period"],
    },
  },
  {
    name: "get_daily_series",
    description:
      "Daily breakdown (revenue, ad spend, profit, ROAS, orders) for the last N days. Use to explain trends or find which day something changed.",
    input_schema: {
      type: "object",
      properties: {
        days: { type: "integer", description: "How many days back (1-90)", minimum: 1, maximum: 90 },
      },
      required: ["days"],
    },
  },
  {
    name: "get_top_products",
    description:
      "Best / most profitable / worst products for a period, with units sold, revenue, cost, profit and margin. Use for product questions.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_ENUM },
        sort: { type: "string", enum: ["best", "profit", "worst"], description: "best=revenue, profit=profit, worst=losing money" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["period", "sort"],
    },
  },
  {
    name: "get_campaigns",
    description:
      "Meta ad campaign performance for a period: spend, clicks, CTR, CPC, CPA, purchases, revenue, profit, ROAS. Use for ad / campaign questions.",
    input_schema: {
      type: "object",
      properties: {
        period: { type: "string", enum: PERIOD_ENUM },
        search: { type: "string", description: "Optional campaign name filter" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
      required: ["period"],
    },
  },
  {
    name: "get_cogs_products",
    description:
      "List products with their current COGS (cost). Shows which products have a manual cost set and which are missing one. Use before proposing a cost change.",
    input_schema: {
      type: "object",
      properties: {
        only_sold: { type: "boolean", description: "Only products that have sold" },
        search: { type: "string", description: "Filter by name/SKU" },
        limit: { type: "integer", minimum: 1, maximum: 25 },
      },
    },
  },
  {
    name: "get_connections_status",
    description:
      "Status of the Shopify and Meta connections: active/error, last sync time, last error. Use when the user asks why data is stale or a connection is failing.",
    input_schema: { type: "object", properties: {} },
  },
  /* ---- safe actions (auto-run, idempotent: they only re-pull data) ---- */
  {
    name: "sync_now",
    description:
      "Re-sync recent orders (Shopify) + ad spend (Meta) for the last 60 days and recompute metrics. Safe; only refreshes data. Can take a few seconds.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "refresh_ad_spend",
    description:
      "Quickly pull the latest Meta ad spend (last 7 days) and recompute. Faster than sync_now. Use when the user says today's ad spend looks old.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "recompute_metrics",
    description:
      "Recompute the last 90 days of profit/metrics from current orders + costs (e.g. after costs changed). Safe.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "import_roas_month",
    description:
      "Import this month's Meta campaigns into the Daily ROAS tracker with live spend and real Shopify sales. Safe; fills the tracker.",
    input_schema: { type: "object", properties: {} },
  },
  /* ---- sensitive action (requires explicit user confirmation) ---- */
  {
    name: "set_product_cost",
    description:
      "Propose setting a product's COGS (unit cost) in the display currency. This does NOT apply immediately — it shows the user a confirmation button. Always look up the product first with get_cogs_products to get its productId.",
    input_schema: {
      type: "object",
      properties: {
        product_id: { type: "string", description: "shopify_product_id from get_cogs_products" },
        title: { type: "string", description: "Product title (for the confirmation card)" },
        cost: { type: "number", description: "Unit cost in display currency (e.g. EUR)" },
      },
      required: ["product_id", "cost"],
    },
  },
];

/* ------------------------------------------------------------------ */
/* Gemini function declarations (converted from the schemas above)     */
/* ------------------------------------------------------------------ */

function toGeminiSchema(s: any): any {
  const out: Record<string, unknown> = {};
  if (s.type) out.type = s.type; // lowercase types already match Gemini's SchemaType
  if (s.description) out.description = s.description;
  if (s.enum) out.enum = s.enum;
  if (s.items) out.items = toGeminiSchema(s.items);
  if (s.properties) {
    const props: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(s.properties)) props[k] = toGeminiSchema(v);
    out.properties = props;
  }
  if (s.required) out.required = s.required;
  // `minimum`/`maximum` are intentionally dropped — unsupported by Gemini schemas.
  return out;
}

/** Tools shaped for the Google Gemini SDK's `functionDeclarations`. */
export const GEMINI_FUNCTION_DECLARATIONS: any[] = ASSISTANT_TOOLS.map((t) => {
  const schema = t.input_schema as any;
  const hasProps = schema?.properties && Object.keys(schema.properties).length > 0;
  return {
    name: t.name,
    description: t.description,
    ...(hasProps ? { parameters: toGeminiSchema(schema) } : {}),
  };
});

/** Tool names that mutate or sync; the UI shows a distinct "running action" state. */
export const ACTION_TOOLS = new Set([
  "sync_now",
  "refresh_ad_spend",
  "recompute_metrics",
  "import_roas_month",
  "set_product_cost",
]);

/* ------------------------------------------------------------------ */
/* Executor                                                            */
/* ------------------------------------------------------------------ */

function num(v: unknown, d = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}
function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

const KPI_KEYS = [
  "revenue",
  "adSpend",
  "profit",
  "profitMargin",
  "roas",
  "mer",
  "ordersCount",
  "aov",
  "conversionRate",
  "productCost",
  "shippingCost",
  "paymentFees",
] as const;

function pickKpis(s: Record<string, unknown>) {
  const out: Record<string, number> = {};
  for (const k of KPI_KEYS) out[k] = num(s[k]);
  return out;
}

export async function executeAssistantTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AssistantContext,
): Promise<ToolOutcome> {
  const { supabase, userId, currency, timezone, fxRate, storeRates } = ctx;

  switch (name) {
    case "get_metrics": {
      const period = str(input.period) ?? "today";
      const { current, previous } = dashboardRanges(
        period,
        timezone,
        str(input.from),
        str(input.to),
      );
      const cmp = await getRangeComparison(supabase, userId, current, previous, storeRates);
      return {
        activity: "Consultei os KPIs",
        result: JSON.stringify({
          period,
          range: current,
          currency,
          current: pickKpis(cmp.current as unknown as Record<string, unknown>),
          previous: pickKpis(cmp.previous as unknown as Record<string, unknown>),
        }),
      };
    }

    case "get_daily_series": {
      const days = Math.min(90, Math.max(1, num(input.days, 30)));
      const series = await getDailySeries(supabase, userId, days, timezone, storeRates);
      return {
        activity: `Consultei ${days} dias`,
        result: JSON.stringify({ currency, days, series }),
      };
    }

    case "get_top_products": {
      const period = str(input.period) ?? "last30";
      const sort = (str(input.sort) ?? "best") as ProductSort;
      const limit = Math.min(25, Math.max(1, num(input.limit, 10)));
      const { current } = dashboardRanges(period, timezone);
      const rows = await getProductPerformance(
        supabase,
        userId,
        current,
        sort,
        timezone,
        ctx.fallbackCostPct,
        fxRate,
      );
      return {
        activity: "Consultei os produtos",
        result: JSON.stringify({
          currency,
          period,
          sort,
          products: rows.slice(0, limit).map((p) => ({
            title: p.title,
            sku: p.sku,
            unitsSold: p.unitsSold,
            revenue: p.revenue,
            cost: p.cost,
            profit: p.profit,
            margin: p.margin,
          })),
        }),
      };
    }

    case "get_campaigns": {
      const period = str(input.period) ?? "last30";
      const limit = Math.min(25, Math.max(1, num(input.limit, 15)));
      const { current } = dashboardRanges(period, timezone);
      const rows = await getCampaignPerformance(
        supabase,
        userId,
        current,
        str(input.search),
        fxRate,
      );
      return {
        activity: "Consultei as campanhas",
        result: JSON.stringify({
          currency,
          period,
          campaigns: rows.slice(0, limit).map((c) => ({
            name: c.name,
            spend: c.spend,
            clicks: c.clicks,
            ctr: c.ctr,
            cpc: c.cpc,
            cpa: c.cpa,
            purchases: c.purchases,
            revenue: c.revenue,
            profit: c.profit,
            roas: c.roas,
          })),
        }),
      };
    }

    case "get_cogs_products": {
      const limit = Math.min(25, Math.max(1, num(input.limit, 15)));
      const search = str(input.search)?.toLowerCase();
      const onlySold = input.only_sold === true;
      const rows = await getProductsForCogs(supabase, userId, storeRates);
      const filtered = rows.filter((p) => {
        if (onlySold && !p.sold) return false;
        if (search && !p.title.toLowerCase().includes(search) && !(p.sku ?? "").toLowerCase().includes(search))
          return false;
        return true;
      });
      return {
        activity: "Consultei os custos",
        result: JSON.stringify({
          currency,
          total: filtered.length,
          products: filtered.slice(0, limit).map((p) => ({
            productId: p.productId,
            title: p.title,
            sku: p.sku,
            price: p.price,
            cost: p.cost,
            costSource: p.costSource,
            sold: p.sold,
          })),
        }),
      };
    }

    case "get_connections_status": {
      const { shopify, meta } = await getConnections(supabase, userId);
      return {
        activity: "Verifiquei as ligações",
        result: JSON.stringify({
          shopify: shopify.map((c) => ({
            shop: c.shop_domain,
            status: c.status,
            lastSyncedAt: c.last_synced_at,
            lastError: c.last_sync_error,
          })),
          meta: meta.map((c) => ({
            adAccount: c.ad_account_id,
            currency: c.account_currency,
            status: c.status,
            lastSyncedAt: c.last_synced_at,
            lastError: c.last_sync_error,
          })),
        }),
      };
    }

    case "sync_now": {
      const res = await syncNowAction();
      return { activity: "Sincronizei tudo", result: JSON.stringify(res) };
    }
    case "refresh_ad_spend": {
      const res = await refreshMetaSpendAction(true);
      return { activity: "Atualizei o ad spend", result: JSON.stringify(res) };
    }
    case "recompute_metrics": {
      const res = await recomputeAllMetricsAction();
      return { activity: "Recalculei as métricas", result: JSON.stringify(res) };
    }
    case "import_roas_month": {
      const res = await autofillRoasAllDays();
      return { activity: "Importei o ROAS do mês", result: JSON.stringify(res) };
    }

    case "set_product_cost": {
      const productId = str(input.product_id);
      const cost = num(input.cost, NaN);
      if (!productId || !Number.isFinite(cost) || cost < 0) {
        return { result: JSON.stringify({ error: "product_id and a non-negative cost are required" }) };
      }
      const title = str(input.title) ?? productId;
      return {
        activity: "Preparei a alteração de custo",
        result: JSON.stringify({
          status: "awaiting_user_confirmation",
          note: "A confirmation button was shown to the user. The change is NOT applied until they click it.",
          productId,
          title,
          cost,
          currency,
        }),
        pendingAction: { type: "set_product_cost", productId, title, cost, currency },
      };
    }

    default:
      return { result: JSON.stringify({ error: `Unknown tool: ${name}` }) };
  }
}
