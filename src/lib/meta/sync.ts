import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/types/database";
import { graphPaginate } from "@/lib/meta/client";
import { round2, round4 } from "@/lib/profit";

type DB = SupabaseClient<Database>;

interface Action {
  action_type: string;
  value: string;
}

const PURCHASE_TYPES = [
  "omni_purchase",
  "purchase",
  "offsite_conversion.fb_pixel_purchase",
];

const ATC_TYPES = [
  "omni_add_to_cart",
  "add_to_cart",
  "offsite_conversion.fb_pixel_add_to_cart",
];

function pickAction(actions: Action[] | undefined, types = PURCHASE_TYPES): number {
  if (!actions) return 0;
  for (const type of types) {
    const hit = actions.find((a) => a.action_type === type);
    if (hit) return Number(hit.value ?? 0);
  }
  return 0;
}

export interface MetaSyncCtx {
  supabase: DB;
  userId: string;
  connectionId: string;
  adAccountId: string; // act_XXXX
  token: string; // decrypted
  // Multiplier from the ad-account currency to the store's base currency, so
  // all stored monetary values share one currency (the display layer then
  // applies a single store -> display conversion). Defaults to 1.
  fxToStore?: number;
}

/**
 * Pull campaign-level insights with a daily breakdown and upsert them as a
 * per-day history. ROAS is derived later from purchase_value / spend.
 *
 * Meta returns amounts in the ad-account currency; we normalise them to the
 * store's base currency via `fxToStore` so they line up with Shopify data.
 */
export async function syncMetaCampaigns(
  ctx: MetaSyncCtx,
  range: { from: string; to: string },
): Promise<number> {
  const fx = ctx.fxToStore ?? 1;
  const params: Record<string, string> = {
    level: "campaign",
    time_increment: "1",
    time_range: JSON.stringify({ since: range.from, until: range.to }),
    fields:
      "campaign_id,campaign_name,spend,impressions,clicks,cpm,cpc,ctr,reach,actions,action_values,date_start",
    access_token: ctx.token,
    limit: "500",
  };

  const rows: TablesInsert<"campaigns">[] = [];

  for await (const page of graphPaginate<any>(
    `${ctx.adAccountId}/insights`,
    params,
  )) {
    for (const r of page) {
      rows.push({
        user_id: ctx.userId,
        meta_connection_id: ctx.connectionId,
        campaign_id: String(r.campaign_id),
        campaign_name: r.campaign_name ?? null,
        date: r.date_start,
        // Monetary fields converted to the store's base currency.
        spend: round2(Number(r.spend ?? 0) * fx),
        impressions: Number(r.impressions ?? 0),
        clicks: Number(r.clicks ?? 0),
        reach: Number(r.reach ?? 0),
        cpm: round4(Number(r.cpm ?? 0) * fx),
        cpc: round4(Number(r.cpc ?? 0) * fx),
        ctr: Number(r.ctr ?? 0), // ratio, currency-independent
        purchases: pickAction(r.actions),
        purchase_value: round2(pickAction(r.action_values) * fx),
        atc: pickAction(r.actions, ATC_TYPES),
      });
    }
  }

  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await ctx.supabase
      .from("campaigns")
      .upsert(rows.slice(i, i + 500), {
        onConflict: "user_id,campaign_id,date",
      });
    if (error) throw error;
  }

  return rows.length;
}
