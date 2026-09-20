import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/types/database";
import { round2, round4 } from "@/lib/profit";
import { eachDay, todayYmd } from "@/lib/date";
import { searchStream } from "@/lib/google/client";
import type { DateRange } from "@/types";
import { GOOGLE_BUDGET_QUERY, googleChangeQuery, readCampaignChanges } from "./change-events";
import { saveGoogleChanges } from "./change-history";

type DB = SupabaseClient<Database>;

export interface GoogleSyncCtx {
  supabase: DB;
  userId: string;
  connectionId: string;
  customerId: string; // digits only
  accessToken: string; // fresh OAuth access token (unused by the mock seeder)
  // Manager (MCC) account id when accessed through a manager; null for a
  // standalone account (queried directly).
  loginCustomerId?: string | null;
  // Multiplier from the ad-account currency to the store's base currency.
  fxToStore?: number;
}

async function upsertRows(
  ctx: GoogleSyncCtx,
  rows: TablesInsert<"google_campaigns">[],
): Promise<number> {
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.supabase
      .from("google_campaigns")
      .upsert(rows.slice(i, i + 500), { onConflict: "user_id,campaign_id,date" });
    if (error) throw error;
  }
  return rows.length;
}

/**
 * REAL sync — pull campaign-level daily metrics from the Google Ads API via
 * GAQL and upsert them as a per-day history (same shape as Meta's campaigns).
 * Google returns cost in micros (1e6 = 1 unit of the account currency).
 */
export async function syncGoogleCampaigns(
  ctx: GoogleSyncCtx,
  range: DateRange,
): Promise<number> {
  const fx = ctx.fxToStore ?? 1;
  const query = `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      metrics.cost_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.conversions,
      metrics.conversions_value,
      segments.date
    FROM campaign
    WHERE segments.date BETWEEN '${range.from}' AND '${range.to}'
  `;

  const results = await searchStream(
    ctx.customerId,
    ctx.accessToken,
    query,
    ctx.loginCustomerId,
  );

  const rows: TablesInsert<"google_campaigns">[] = results.map((r) => {
    const m = r.metrics ?? {};
    const spend = (Number(m.costMicros ?? 0) / 1_000_000) * fx;
    const clicks = Number(m.clicks ?? 0);
    const impressions = Number(m.impressions ?? 0);
    const ctr = impressions > 0 ? (clicks / impressions) * 100 : 0;
    return {
      user_id: ctx.userId,
      google_connection_id: ctx.connectionId,
      campaign_id: String(r.campaign?.id ?? ""),
      campaign_name: r.campaign?.name ?? null,
      status: r.campaign?.status ?? null,
      date: r.segments?.date,
      spend: round2(spend),
      impressions,
      clicks,
      reach: 0, // not exposed at campaign level
      cpm: round4(impressions > 0 ? (spend / impressions) * 1000 : 0),
      cpc: round4(clicks > 0 ? spend / clicks : 0),
      ctr: round2(ctr),
      purchases: round2(Number(m.conversions ?? 0)),
      purchase_value: round2(Number(m.conversionsValue ?? 0) * fx),
      atc: 0,
    };
  });

  const count = await upsertRows(ctx, rows);
  // Change history is supplementary: keep daily costs if Google cannot return it.
  try {
    const account = await searchStream(ctx.customerId, ctx.accessToken, "SELECT customer.time_zone FROM customer LIMIT 1", ctx.loginCustomerId);
    const today = todayYmd(account[0]?.customer?.timeZone ?? "UTC");
    const [budgetRows, events, connection] = await Promise.all([
      searchStream(ctx.customerId, ctx.accessToken, GOOGLE_BUDGET_QUERY, ctx.loginCustomerId),
      searchStream(ctx.customerId, ctx.accessToken, googleChangeQuery(today), ctx.loginCustomerId),
      ctx.supabase.from("google_connections").select("shopify_connection_id,account_currency").eq("user_id", ctx.userId).eq("id", ctx.connectionId).maybeSingle(),
    ]);
    if (connection.error) throw connection.error;
    const budgets: Record<string, string[]> = {};
    for (const row of budgetRows) {
      const c = row.campaign;
      if (c?.campaignBudget) (budgets[c.campaignBudget] ??= []).push(String(c.id));
    }
    await saveGoogleChanges(ctx.supabase, { userId: ctx.userId, customerId: ctx.customerId,
      storeId: connection.data?.shopify_connection_id ?? null, currency: connection.data?.account_currency ?? "",
      changes: readCampaignChanges(events, budgets) });
  } catch {
    console.warn("Google campaign change history unavailable; daily metrics were preserved.");
  }
  return count;
}

/* ------------------------------------------------------------------ */
/* MOCK — deterministic example data for the "demo" connect path.      */
/* ------------------------------------------------------------------ */

const MOCK_CAMPAIGNS = [
  { id: "gg-search-brand",   name: "Search · Brand",              base: 18, cvr: 0.05, aov: 44 },
  { id: "gg-pmax-catalog",   name: "Performance Max · Catálogo",  base: 46, cvr: 0.03, aov: 39 },
  { id: "gg-shopping-best",  name: "Shopping · Bestsellers",      base: 31, cvr: 0.04, aov: 41 },
  { id: "gg-search-generic", name: "Search · Genéricas",          base: 23, cvr: 0.02, aov: 36 },
];

/** FNV-1a hash → uint32, for deterministic per-key pseudo-randomness. */
function hashStr(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** Deterministic 0..1 from a seed (xorshift). */
function rand01(seed: number): number {
  let x = seed || 1;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  return ((x >>> 0) % 100000) / 100000;
}

/**
 * Seed stable, plausible example campaigns so the dashboard/ads pages have data
 * without real credentials. Values are DETERMINISTIC per (campaign, day).
 */
export async function seedMockGoogleCampaigns(
  ctx: GoogleSyncCtx,
  range: DateRange,
): Promise<number> {
  const fx = ctx.fxToStore ?? 1;
  const rows: TablesInsert<"google_campaigns">[] = [];

  for (const date of eachDay(range)) {
    for (const c of MOCK_CAMPAIGNS) {
      const r = rand01(hashStr(`${c.id}:${date}`));
      const spend = c.base * (0.6 + r * 0.9);
      const cpc = 0.4 + r * 0.6;
      const clicks = Math.max(1, Math.round(spend / cpc));
      const ctrRatio = 0.02 + r * 0.04;
      const impressions = Math.round(clicks / ctrRatio);
      const purchases = Math.round(clicks * c.cvr);
      const cpm = impressions > 0 ? (spend / impressions) * 1000 : 0;

      rows.push({
        user_id: ctx.userId,
        google_connection_id: ctx.connectionId,
        campaign_id: c.id,
        campaign_name: c.name,
        status: "ENABLED",
        date,
        spend: round2(spend * fx),
        impressions,
        clicks,
        reach: Math.round(impressions * 0.7),
        cpm: round4(cpm * fx),
        cpc: round4(cpc * fx),
        ctr: round2(ctrRatio * 100),
        purchases,
        purchase_value: round2(purchases * c.aov * fx),
        atc: purchases * 3,
      });
    }
  }

  return upsertRows(ctx, rows);
}
