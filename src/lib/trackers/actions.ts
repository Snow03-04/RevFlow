"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getStoreCurrency } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import {
  beatsClaim,
  buildResolver,
  fetchCampaignHandleMap,
  fetchMatcherProducts,
  fetchShopifySalesByProductDay,
  trackerFx,
  type SalesClaim,
} from "@/lib/trackers/match";
import {
  syncMetaForUser,
  syncShopifyOrdersForUser,
  refreshCampaignLinks,
} from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import type { TablesInsert } from "@/types/database";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  count?: number;
}

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/* ------------------------------------------------------------------ */
/* P&L                                                                 */
/* ------------------------------------------------------------------ */

export async function savePnlSettings(
  values: Partial<TablesInsert<"pnl_settings">>,
): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_settings")
    .upsert({ user_id: user.id, ...values }, { onConflict: "user_id" });
  if (!error) return { ok: true };
  // `payment_fee_pct` (migration 0023) may not exist yet — retry without it so
  // the rest of the settings still save.
  const code = (error as { code?: string }).code;
  if (code === "42703" || /payment_fee_pct/.test(error.message ?? "")) {
    const { payment_fee_pct: _drop, ...rest } = values;
    const { error: e2 } = await supabase
      .from("pnl_settings")
      .upsert({ user_id: user.id, ...rest }, { onConflict: "user_id" });
    return e2 ? { ok: false, error: e2.message } : { ok: true };
  }
  return { ok: false, error: error.message };
}

export async function savePnlMonthOverride(values: {
  year: number;
  month: number;
  agency_fee_fb: number | null;
  agency_fee_google: number | null;
  transaction_fee: number | null;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_month_overrides")
    .upsert(
      { user_id: user.id, ...values },
      { onConflict: "user_id,year,month" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function savePnlDay(values: {
  year: number;
  month: number;
  day: number;
  gross_revenue: number;
  refunds: number;
  cogs: number;
  adspend_fb: number;
  adspend_google: number;
  orders: number;
  notes: string | null;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_days")
    .upsert(
      { user_id: user.id, ...values },
      { onConflict: "user_id,year,month,day" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ------------------------------------------------------------------ */
/* ROAS                                                                */
/* ------------------------------------------------------------------ */

export async function saveRoasSettings(
  values: Partial<TablesInsert<"roas_settings">>,
): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_settings")
    .upsert({ user_id: user.id, ...values }, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveRoasEntry(values: {
  id: string;
  year: number;
  month: number;
  day: number;
  position: number;
  campaign_name: string;
  total_spend: number;
  cpc: number;
  atc: number;
  pur: number;
  price: number;
  cog: number;
  units_sold: number;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .upsert({ user_id: user.id, ...values }, { onConflict: "id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteRoasEntry(id: string): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Wipe every ROAS entry (all days) for the current user. */
export async function clearAllRoasEntries(): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .delete()
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Auto-fill from synced Shopify + Meta data                           */
/* ------------------------------------------------------------------ */

/**
 * Fill a P&L month's daily inputs from `daily_metrics` (Gross, Refunds, COGS
 * from Shopify; Adspend FB from Meta). Values are converted to the P&L
 * tracker's currency. Manual fields (Adspend Google, Notes) are preserved.
 */
export async function autofillPnlMonth(
  year: number,
  month: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const [{ data: settings }, { data: mainSettings }] = await Promise.all([
    supabase
      .from("pnl_settings")
      .select("currency")
      .eq("user_id", user.id)
      .maybeSingle(),
    supabase
      .from("settings")
      .select("*")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  const targetIso = SYMBOL_TO_ISO[settings?.currency ?? "€"] ?? "EUR";
  const store = await getStoreCurrency(supabase, user.id);
  const fx = await resolveFx(store, targetIso, {
    storeCurrency: store,
    displayCurrency: targetIso,
    override: mainSettings?.fx_rate_override,
  });

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  // Pull fresh Shopify orders + Meta spend covering the whole month BEFORE
  // reading daily_metrics. Without this we'd import a stale/partial snapshot —
  // e.g. days with ad spend but €0 revenue because their orders were never
  // synced. Best-effort: if a source isn't connected we still import whatever
  // metrics exist.
  //
  // The two syncs run in PARALLEL and each SKIPS its own recompute; we then
  // recompute ONCE, scoped to the month being imported. Previously they ran
  // sequentially and each recomputed the entire `daysBack` window (up to 180
  // days) — twice, across every store. That was the bulk of the import time.
  const monthStart = new Date(year, month - 1, 1).getTime();
  const daysBack = Math.min(
    180,
    Math.max(3, Math.ceil((Date.now() - monthStart) / 86_400_000) + 1),
  );
  try {
    await Promise.all([
      syncMetaForUser(supabase, user.id, daysBack, { skipRecompute: true }),
      syncShopifyOrdersForUser(supabase, user.id, daysBack, {
        skipRecompute: true,
      }),
    ]);
    await recomputeDailyMetrics(supabase, user.id, { from, to });
  } catch {
    // Non-blocking — fall back to the existing daily_metrics.
  }

  const [{ data: metrics }, { data: existing }] = await Promise.all([
    supabase
      .from("daily_metrics")
      .select(
        "date, gross_revenue, shipping_revenue, refunds, product_cost, ad_spend, orders_count",
      )
      .eq("user_id", user.id)
      .gte("date", from)
      .lte("date", to),
    supabase
      .from("pnl_days")
      .select("day, adspend_google, notes")
      .eq("user_id", user.id)
      .eq("year", year)
      .eq("month", month),
  ]);

  const exByDay = new Map((existing ?? []).map((d) => [d.day, d]));

  // daily_metrics holds ONE ROW PER STORE PER DAY, so sum them into a single
  // figure per day — the P&L covers the whole business. Skipping this also
  // produced duplicate (user, year, month, day) rows, which made the upsert
  // below fail with "ON CONFLICT DO UPDATE cannot affect row a second time".
  interface DayAgg {
    gross: number;
    shipping: number;
    refunds: number;
    cogs: number;
    adSpend: number;
    orders: number;
  }
  const byDate = new Map<string, DayAgg>();
  for (const m of metrics ?? []) {
    const e =
      byDate.get(m.date) ??
      { gross: 0, shipping: 0, refunds: 0, cogs: 0, adSpend: 0, orders: 0 };
    e.gross += Number(m.gross_revenue);
    e.shipping += Number(m.shipping_revenue);
    e.refunds += Number(m.refunds);
    e.cogs += Number(m.product_cost);
    e.adSpend += Number(m.ad_spend);
    e.orders += Number(m.orders_count);
    byDate.set(m.date, e);
  }

  const rows = [...byDate].map(([date, e]) => {
    const day = parseInt(date.slice(8, 10), 10);
    const ex = exByDay.get(day);
    return {
      user_id: user.id,
      year,
      month,
      day,
      // Gross Rev INCLUDES shipping the customer paid, so the P&L's Net Rev
      // matches the dashboard revenue (Shopify "Total sales") — otherwise the
      // two profits differ by exactly the shipping amount.
      gross_revenue: round2((e.gross + e.shipping) * fx),
      refunds: round2(e.refunds * fx),
      cogs: round2(e.cogs * fx),
      adspend_fb: round2(e.adSpend * fx),
      adspend_google: ex ? Number(ex.adspend_google) : 0,
      orders: e.orders,
      notes: ex?.notes ?? null,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("pnl_days")
      .upsert(rows, { onConflict: "user_id,year,month,day" });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/pnl");
  return { ok: true, count: rows.length };
}

/**
 * Import Meta campaigns for a ROAS "Day N" (mapped to day N of the current
 * month). Fills Campaign / Spend / CPC / PUR from synced data; product
 * economics (Price / COG / Units / ATC) are preserved for manual entry.
 */
export async function autofillRoasDay(
  year: number,
  month: number,
  day: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const [{ data: rs }, { data: settings }] = await Promise.all([
    supabase.from("roas_settings").select("currency").eq("user_id", user.id).maybeSingle(),
    supabase.from("settings").select("timezone").eq("user_id", user.id).maybeSingle(),
  ]);
  const fx = await trackerFx(supabase, user.id, rs?.currency);
  const tz = settings?.timezone ?? "UTC";

  // Pull live Meta spend + recent Shopify orders + refresh campaign→product links.
  await syncMetaForUser(supabase, user.id, 31);
  await syncShopifyOrdersForUser(supabase, user.id, 3);
  await refreshCampaignLinks(supabase, user.id);

  const date = `${year}-${pad(month)}-${pad(day)}`;

  const [{ data: camps }, { data: existing }, products, handleMap, shopSales] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "campaign_id, campaign_name, spend, clicks, purchases, purchase_value, atc",
        )
        .eq("user_id", user.id)
        .eq("date", date),
      supabase
        .from("roas_entries")
        .select("*")
        .eq("user_id", user.id)
        .eq("year", year)
        .eq("month", month)
        .eq("day", day),
      fetchMatcherProducts(supabase, user.id),
      fetchCampaignHandleMap(supabase, user.id),
      fetchShopifySalesByProductDay(supabase, user.id, { from: date, to: date }, tz),
    ]);

  // Only campaigns that actually ran that day (had spend).
  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (active.length === 0) {
    return { ok: true, count: 0 };
  }

  const resolve = buildResolver(products, handleMap);
  const byName = new Map((existing ?? []).map((e) => [e.campaign_name, e]));

  // Resolve every campaign to a product up front.
  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    return { c, name, m: resolve(c.campaign_id, name) };
  });

  // A product's real Shopify sales must be counted ONCE. Pick the single best
  // campaign per product (handle match > more shared words > Meta purchases >
  // spend); only it gets the product's orders/units, the rest get 0.
  const winnerByProduct = new Map<
    string,
    { campaignId: string; claim: SalesClaim }
  >();
  for (const { c, m } of rows) {
    if (!m?.productId) continue;
    const claim: SalesClaim = {
      via: m.via,
      score: m.score,
      metaPurchases: Number(c.purchases),
      spend: Number(c.spend),
    };
    const cur = winnerByProduct.get(m.productId);
    if (!cur || beatsClaim(claim, cur.claim)) {
      winnerByProduct.set(m.productId, { campaignId: c.campaign_id, claim });
    }
  }

  // Two Meta campaigns can share a name on the same day; each existing row must
  // be claimed by at most one, otherwise the upsert would carry a duplicate id
  // and Postgres throws "ON CONFLICT DO UPDATE cannot affect row a second time".
  const claimed = new Set<string>();
  let pos = existing?.length ?? 0;

  const upserts = rows.map(({ c, name, m }) => {
    const ex = byName.get(name);
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    // Shopify is the source of truth for sales: only the winning campaign for a
    // product gets its real orders/units + NET revenue (price = net ÷ units, so
    // Store Val is net of discounts). Non-winners get 0; unmatched campaigns
    // fall back to Meta's own purchase count.
    const isWinner =
      !!m?.productId && winnerByProduct.get(m.productId)?.campaignId === c.campaign_id;
    const sale = isWinner ? shopSales.get(`${m!.productId}:${date}`) : undefined;
    const pur = m?.productId ? (isWinner ? sale?.orders ?? 0 : 0) : Number(c.purchases);
    const units = m?.productId ? (isWinner ? sale?.units ?? 0 : 0) : Number(c.purchases);
    const priceNet =
      sale && units > 0 ? round2((sale.revenue / units) * fx) : null;
    return {
      id: reuseId ?? crypto.randomUUID(),
      user_id: user.id,
      year,
      month,
      day,
      position: reuseId ? ex!.position : pos++,
      campaign_name: name,
      total_spend: round2(Number(c.spend) * fx),
      cpc: round2(cpc * fx),
      atc: Number(c.atc ?? 0),
      pur,
      price: priceNet ?? exPrice ?? (m ? round2(m.price * fx) : 0),
      cog: m && m.cog > 0 ? round2(m.cog * fx) : exCog ?? 0,
      units_sold: units,
    };
  });

  const { error } = await supabase
    .from("roas_entries")
    .upsert(upserts, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/roas");
  return { ok: true, count: upserts.length };
}

/**
 * Import Meta campaigns for EVERY day of the current month at once — each
 * active campaign lands on its own day (Day 1, Day 2, …). Product economics
 * are preserved where rows already exist.
 */
export async function autofillRoasAllDays(
  year?: number,
  month?: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const [{ data: rs }, { data: settings }] = await Promise.all([
    supabase.from("roas_settings").select("currency").eq("user_id", user.id).maybeSingle(),
    supabase.from("settings").select("timezone").eq("user_id", user.id).maybeSingle(),
  ]);
  const fx = await trackerFx(supabase, user.id, rs?.currency);
  const tz = settings?.timezone ?? "UTC";

  // Pull live Meta spend + recent Shopify orders + refresh campaign→product links.
  await syncMetaForUser(supabase, user.id, 31);
  await syncShopifyOrdersForUser(supabase, user.id, 3);
  await refreshCampaignLinks(supabase, user.id);

  // Default to the current month when not specified (e.g. the AI assistant).
  const now = new Date();
  year = year ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;
  const lastDay = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const [{ data: camps }, { data: existing }, products, handleMap, shopSales] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "campaign_id, campaign_name, spend, clicks, purchases, purchase_value, date, atc",
        )
        .eq("user_id", user.id)
        .gte("date", from)
        .lte("date", to),
      supabase
        .from("roas_entries")
        .select("*")
        .eq("user_id", user.id)
        .eq("year", year)
        .eq("month", month),
      fetchMatcherProducts(supabase, user.id),
      fetchCampaignHandleMap(supabase, user.id),
      fetchShopifySalesByProductDay(supabase, user.id, { from, to }, tz),
    ]);

  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (active.length === 0) return { ok: true, count: 0 };

  const resolve = buildResolver(products, handleMap);
  const existingByKey = new Map<string, NonNullable<typeof existing>[number]>();
  const nextPosByDay = new Map<number, number>();
  for (const e of existing ?? []) {
    existingByKey.set(`${e.day}:${e.campaign_name}`, e);
    nextPosByDay.set(
      e.day,
      Math.max(nextPosByDay.get(e.day) ?? 0, e.position + 1),
    );
  }

  // Resolve every campaign to a product up front.
  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    return { c, name, m: resolve(c.campaign_id, name) };
  });

  // A product's real Shopify sales must be counted ONCE per DAY. Pick the single
  // best campaign per product+date (handle > more shared words > Meta purchases >
  // spend); only it gets the product's orders/units, the rest get 0.
  const winnerByProductDay = new Map<
    string,
    { campaignId: string; claim: SalesClaim }
  >(); // key = `${productId}:${date}`
  for (const { c, m } of rows) {
    if (!m?.productId) continue;
    const key = `${m.productId}:${c.date}`;
    const claim: SalesClaim = {
      via: m.via,
      score: m.score,
      metaPurchases: Number(c.purchases),
      spend: Number(c.spend),
    };
    const cur = winnerByProductDay.get(key);
    if (!cur || beatsClaim(claim, cur.claim)) {
      winnerByProductDay.set(key, { campaignId: c.campaign_id, claim });
    }
  }

  // Guard against two same-named campaigns on one day both reusing the same
  // existing row id (which would make the upsert hit that row twice → Postgres
  // "ON CONFLICT DO UPDATE cannot affect row a second time").
  const claimed = new Set<string>();

  const upserts = rows.map(({ c, name, m }) => {
    const day = parseInt(c.date.slice(8, 10), 10);
    const ex = existingByKey.get(`${day}:${name}`);
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    // Shopify is the source of truth for sales (NET revenue): only the winning
    // campaign for a product+day gets its real orders/units; non-winners get 0;
    // unmatched campaigns fall back to Meta's own purchase count.
    const isWinner =
      !!m?.productId &&
      winnerByProductDay.get(`${m.productId}:${c.date}`)?.campaignId === c.campaign_id;
    const sale = isWinner ? shopSales.get(`${m!.productId}:${c.date}`) : undefined;
    const pur = m?.productId ? (isWinner ? sale?.orders ?? 0 : 0) : Number(c.purchases);
    const units = m?.productId ? (isWinner ? sale?.units ?? 0 : 0) : Number(c.purchases);
    const priceNet =
      sale && units > 0 ? round2((sale.revenue / units) * fx) : null;

    let position: number;
    if (reuseId) {
      position = ex!.position;
    } else {
      position = nextPosByDay.get(day) ?? 0;
      nextPosByDay.set(day, position + 1);
    }

    return {
      id: reuseId ?? crypto.randomUUID(),
      user_id: user.id,
      year,
      month,
      day,
      position,
      campaign_name: name,
      total_spend: round2(Number(c.spend) * fx),
      cpc: round2(cpc * fx),
      atc: Number(c.atc ?? 0),
      pur,
      price: priceNet ?? exPrice ?? (m ? round2(m.price * fx) : 0),
      cog: m && m.cog > 0 ? round2(m.cog * fx) : exCog ?? 0,
      units_sold: units,
    };
  });

  const { error } = await supabase
    .from("roas_entries")
    .upsert(upserts, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/roas");
  return { ok: true, count: upserts.length };
}
