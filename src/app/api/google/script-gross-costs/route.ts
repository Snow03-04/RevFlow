import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { googleScriptToken } from "@/lib/google/script";
import { safeEqual } from "@/lib/crypto";
import { resolveFx } from "@/lib/fx";
import { getStoreCurrency } from "@/lib/queries";
import { ScriptCampaign, saveScriptCampaigns } from "@/lib/google/script-campaigns";
import { saveGoogleCollectionLinks } from "@/lib/google/collection-links";
import { ScriptCampaignChange, saveGoogleChanges } from "@/lib/google/change-history";
import { invalidateSyncedViews } from "@/lib/sync/invalidate";

export const maxDuration = 60;
export const dynamic = "force-dynamic";

const Body = z.object({
  user: z.string().uuid(), store: z.string().uuid(), token: z.string().min(1),
  currency: z.string().length(3), customerId: z.string().regex(/^[\d-]{5,20}$/),
  days: z.array(z.object({ date: z.string().date() })).min(1).max(62),
  campaigns: z.array(ScriptCampaign.extend({ grossCost: z.number().finite().nonnegative() })).max(50000),
  targets: z.array(z.object({ id: z.string().regex(/^\d+$/).max(30), finalUrls: z.array(z.string().url().max(8192)).max(1000) })).max(10000).optional(),
  changes: z.array(ScriptCampaignChange).max(50000).optional(),
}).superRefine((body, ctx) => {
  const dates = new Set(body.days.map((d) => d.date));
  const ids = new Set(body.campaigns.map((c) => c.id));
  const keys = body.campaigns.map((c) => `${c.id}:${c.date}`);
  if (dates.size !== body.days.length || body.campaigns.some((c) => !dates.has(c.date)) || new Set(keys).size !== keys.length
    || (body.targets && (new Set(body.targets.map((t) => t.id)).size !== body.targets.length || body.targets.some((t) => !ids.has(t.id))))) {
    ctx.addIssue({ code: "custom", message: "invalid campaign report" });
  }
});

/** Independent of billing: an exhausted/unknown credit must never block ROAS.
 * Dedicated endpoint prevents older receivers from booking gross cost as cash.
 * Separate campaign namespace preserves every verified paid-cost snapshot. */
export async function POST(request: NextRequest) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ ok: false, error: "invalid body" }, { status: 400 });
  const body = parsed.data;
  if (!safeEqual(body.token, googleScriptToken(body.user, body.store))) return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
  const db = createAdminClient();
  const { data: store, error } = await db.from("shopify_connections").select("id").eq("user_id", body.user).eq("id", body.store).maybeSingle();
  if (error) throw error;
  if (!store) return NextResponse.json({ ok: false, error: "store not found" }, { status: 404 });
  const currency = await getStoreCurrency(db, body.user, body.store);
  if (!currency) throw new Error("Moeda da loja por confirmar.");
  const fx = await resolveFx(body.currency, currency, { required: true });
  const latest = new Date(Date.now() + 36 * 3600 * 1000).toISOString().slice(0, 10);
  const dates = body.days.map((d) => d.date).filter((d) => d <= latest).sort();
  if (!dates.length) return NextResponse.json({ ok: true, campaignRows: 0 });
  const campaignRows = await saveScriptCampaigns(db, { userId: body.user, storeId: body.store, customerId: body.customerId,
    dates, campaigns: body.campaigns.filter((c) => dates.includes(c.date)), fx, storeGrossSpend: true, grossOnly: true });
  const collectionLinks = body.targets ? await saveGoogleCollectionLinks(db, { userId: body.user, storeId: body.store, customerId: body.customerId, targets: body.targets }) : 0;
  let changeHistoryImported = false;
  if (body.changes) {
    try { changeHistoryImported = await saveGoogleChanges(db, { userId: body.user, storeId: body.store, customerId: body.customerId, currency: body.currency, changes: body.changes }); }
    catch { console.warn("Google change history unavailable during gross cost import."); }
  }
  invalidateSyncedViews();
  return NextResponse.json({ ok: true, campaignRows, collectionLinks, grossSpendImported: true, netSpendImported: false, changeHistoryImported });
}
