import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { selectAllByUser } from "@/lib/supabase/paginate";

export const ScriptCampaignChange = z.object({
  eventId: z.string().min(1).max(300), campaignId: z.string().regex(/^\d+$/).max(30),
  changedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/)
    .refine((v) => !Number.isNaN(Date.parse(v.replace(" ", "T") + "Z"))),
  kind: z.enum(["budget", "status", "bidding", "campaign"]),
  oldBudget: z.number().finite().nonnegative().nullish(),
  newBudget: z.number().finite().nonnegative().nullish(),
});
export type CampaignChange = Tables<"google_campaign_changes">;

function missingTable(error: { code?: string; message?: string }) {
  return ["42P01", "PGRST205"].includes(error.code ?? "") && !!error.message?.includes("google_campaign_changes");
}

export async function saveGoogleChanges(db: SupabaseClient<Database>, opts: {
  userId: string; storeId: string | null; customerId: string; currency: string;
  changes: z.infer<typeof ScriptCampaignChange>[];
}) {
  const rows = opts.changes.map((c) => ({
    user_id: opts.userId, campaign_key: `${opts.storeId ?? "unmapped"}:${opts.customerId.replace(/\D/g, "")}:${c.campaignId}`,
    event_id: c.eventId, changed_at: c.changedAt.replace(" ", "T"), kind: c.kind,
    old_budget: c.oldBudget ?? null, new_budget: c.newBudget ?? null, currency: opts.currency,
  }));
  // Retrying a script cannot duplicate edits or replace their original dates.
  const unique = [...new Map(rows.map((r) => [`${r.campaign_key}:${r.event_id}`, r])).values()];
  if (!unique.length) {
    const { error } = await db.from("google_campaign_changes").select("id").eq("user_id", opts.userId).limit(1);
    if (error && missingTable(error)) return false;
    if (error) throw error;
  }
  for (let i = 0; i < unique.length; i += 500) {
    const { error } = await db.from("google_campaign_changes").upsert(unique.slice(i, i + 500), { onConflict: "user_id,campaign_key,event_id" });
    if (error && missingTable(error)) return false;
    if (error) throw error;
  }
  return true;
}

export async function getGoogleChanges(db: SupabaseClient<Database>, userId: string) {
  try {
    return await selectAllByUser<CampaignChange>(db, "google_campaign_changes", "*", userId, (q) => q.order("changed_at", { ascending: false }));
  } catch (error) {
    if (missingTable(error as { code?: string; message?: string })) return [];
    throw error;
  }
}
