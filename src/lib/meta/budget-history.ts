import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { graphPaginate } from "./client";

export type BudgetActivity = { event_type: string; event_time: string; object_id: string; extra_data: unknown };
export type BudgetChange = { event_id: string; campaign_id: string; object_id: string; changed_at: string;
  old_budget: number; new_budget: number; currency: string };

/** Ignore billing events, creation, decreases, mode changes and malformed values. */
export function parseBudgetIncrease(event: BudgetActivity, campaignIds: Set<string>, adsetParents: Map<string, string>): BudgetChange | null {
  if (!["update_campaign_budget", "update_ad_set_budget"].includes(event.event_type)) return null;
  const campaign = campaignIds.has(event.object_id) ? event.object_id : adsetParents.get(event.object_id);
  if (!campaign || !campaignIds.has(campaign) || !Number.isFinite(Date.parse(event.event_time))) return null;
  try {
    const data = typeof event.extra_data === "string" ? JSON.parse(event.extra_data) : event.extra_data;
    if (!data || typeof data !== "object") return null;
    const old = data.old_value, next = data.new_value;
    const before = typeof old === "object" ? old?.old_value : old;
    const after = typeof next === "object" ? next?.new_value : next;
    const currency = old?.currency ?? data.currency;
    const newCurrency = next?.currency ?? data.currency;
    if (!currency || currency !== newCurrency || old?.additional_value !== next?.additional_value) return null;
    if (before === null || before === "" || after === null || after === "") return null;
    const oldBudget = Number(before), newBudget = Number(after);
    if (!Number.isFinite(oldBudget) || !Number.isFinite(newBudget) || oldBudget <= 0 || newBudget <= oldBudget) return null;
    const changedAt = new Date(event.event_time).toISOString();
    return { event_id: createHash("sha256").update(JSON.stringify([event.object_id, changedAt, oldBudget, newBudget, currency])).digest("hex"),
      campaign_id: campaign, object_id: event.object_id, changed_at: changedAt,
      old_budget: oldBudget, new_budget: newBudget, currency };
  } catch { return null; }
}

/** Incremental read of actual budget edits; spend fluctuations never reset ROAS. */
export async function syncMetaBudgetHistory(db: SupabaseClient<Database>, ctx: {
  userId: string; connectionId: string; adAccountId: string; token: string;
}, force = false) {
  const state = await db.from("meta_connections").select("budget_synced_at").eq("user_id", ctx.userId).eq("id", ctx.connectionId).single();
  if (state.error) throw state.error;
  const now = Date.now();
  const last = Date.parse(state.data?.budget_synced_at ?? "");
  if (!force && Number.isFinite(last) && last <= now && now - last < 300_000) return;
  const since = Number.isFinite(last) ? Math.max(last - 2 * 86_400_000, now - 60 * 86_400_000) : now - 60 * 86_400_000;
  try {
    const events: BudgetActivity[] = [];
    const signal = AbortSignal.timeout(25_000);
    let pages = 0;
    for await (const page of graphPaginate<BudgetActivity>(`${ctx.adAccountId}/activities`, {
      fields: "event_time,event_type,object_id,extra_data", category: "BUDGET",
      since: String(Math.floor(since / 1000)), until: String(Math.floor(now / 1000)), limit: "100", access_token: ctx.token,
    }, { signal })) {
      events.push(...page.filter((event) => ["update_campaign_budget", "update_ad_set_budget"].includes(event.event_type)));
      if (++pages >= 20) throw new Error("Histórico de orçamento incompleto; tenta novamente.");
    }
    // Campaign IDs are small and sufficient; never fetch order/customer data here.
    const campaigns = new Set<string>();
    for await (const page of graphPaginate<{ id: string }>(`${ctx.adAccountId}/campaigns`,
      { fields: "id", limit: "250", access_token: ctx.token }, { signal })) for (const c of page) campaigns.add(c.id);
    const parents = new Map<string, string>();
    if (events.some((event) => !campaigns.has(event.object_id)))
      for await (const page of graphPaginate<{ id: string; campaign_id: string }>(`${ctx.adAccountId}/adsets`,
        { fields: "id,campaign_id", limit: "250", access_token: ctx.token }, { signal }))
        for (const adset of page) parents.set(adset.id, adset.campaign_id);
    const changes = events.flatMap((event) => {
      const change = parseBudgetIncrease(event, campaigns, parents);
      return change ? [{ ...change, user_id: ctx.userId, meta_connection_id: ctx.connectionId }] : [];
    });
    for (let i = 0; i < changes.length; i += 200) {
      const result = await db.from("meta_budget_changes").upsert(changes.slice(i, i + 200), { onConflict: "user_id,meta_connection_id,event_id" });
      if (result.error) throw result.error;
    }
    const saved = await db.from("meta_connections").update({ budget_synced_at: new Date(now).toISOString(), budget_sync_error: null })
      .eq("user_id", ctx.userId).eq("id", ctx.connectionId);
    if (saved.error) throw saved.error;
  } catch (error) {
    await db.from("meta_connections").update({ budget_sync_error: "Não foi possível confirmar as alterações de orçamento na Meta." })
      .eq("user_id", ctx.userId).eq("id", ctx.connectionId);
    throw error;
  }
}
