import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, TablesInsert } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { round2, round4 } from "@/lib/profit";

export const ScriptCampaign = z.object({
  id: z.string().regex(/^\d+$/).max(30), name: z.string().max(500),
  date: z.string().date(), status: z.string().max(40).optional(),
  cost: z.number().finite().min(0),
  grossCost: z.number().finite().min(0).optional(),
  impressions: z.number().int().nonnegative(), clicks: z.number().int().nonnegative(),
  conversions: z.number().finite().nonnegative(), conversionValue: z.number().finite(),
});

/** Script rows are analysis-only. Account totals remain the single expense.
 * A null OAuth connection keeps them out of the spend rollup, avoiding doubles.
 * Namespaced IDs isolate stores/accounts without requiring new DB columns. */
export function scriptCampaignId(storeId: string, customerId: string, campaignId: string) {
  return `script:${storeId}:${customerId.replace(/\D/g, "")}:${campaignId}`;
}

export function parseScriptCampaignId(id: string) {
  const match = /^script:([\da-f-]{36}):(\d+):(\d+)$/i.exec(id);
  return match ? { storeId: match[1], customerId: match[2], campaignId: match[3] } : null;
}

export async function saveScriptCampaigns(db: SupabaseClient<Database>, opts: {
  userId: string; storeId: string; customerId: string; dates: string[];
  campaigns: z.infer<typeof ScriptCampaign>[]; fx: number; storeGrossSpend?: boolean;
}) {
  const prefix = scriptCampaignId(opts.storeId, opts.customerId, "");
  const existing = await selectAllByUser<{ campaign_id: string; campaign_name: string; date: string }>(
    db, "google_campaigns", "campaign_id,campaign_name,date", opts.userId,
    (q) => q.in("date", opts.dates).like("campaign_id", `${prefix}%`).is("google_connection_id", null),
  );
  const rows = new Map<string, TablesInsert<"google_campaigns">>();
  for (const c of existing) rows.set(`${c.campaign_id}:${c.date}`, {
    user_id: opts.userId, google_connection_id: null, ...c,
    spend: 0, purchases: 0, purchase_value: 0, impressions: 0, clicks: 0, cpc: 0, cpm: 0, ctr: 0,
    ...(opts.storeGrossSpend ? { gross_spend: 0 } : {}),
  });
  for (const c of opts.campaigns) {
    if (!opts.dates.includes(c.date)) throw new Error("Campanha fora das datas do envio.");
    const id = scriptCampaignId(opts.storeId, opts.customerId, c.id);
    const spend = round2(c.cost * opts.fx);
    const gross = c.grossCost == null ? null : round2(c.grossCost * opts.fx);
    rows.set(`${id}:${c.date}`, {
      user_id: opts.userId, google_connection_id: null, campaign_id: id,
      campaign_name: c.name, date: c.date, status: c.status ?? null,
      spend, purchases: c.conversions, purchase_value: round2(c.conversionValue * opts.fx),
      ...(opts.storeGrossSpend ? { gross_spend: gross } : {}),
      impressions: c.impressions, clicks: c.clicks,
      cpc: round4(c.clicks ? (gross ?? spend) / c.clicks : 0),
      cpm: round4(c.impressions ? (gross ?? spend) / c.impressions * 1000 : 0),
      ctr: round4(c.impressions ? c.clicks / c.impressions * 100 : 0),
    });
  }
  const all = [...rows.values()];
  for (let i = 0; i < all.length; i += 500) {
    const { error } = await db.from("google_campaigns").upsert(all.slice(i, i + 500), { onConflict: "user_id,campaign_id,date" });
    if (error) throw error;
  }
  return all.length;
}
