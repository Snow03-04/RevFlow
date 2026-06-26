"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getStoreCurrency } from "@/lib/queries";
import { getCurrentRate } from "@/lib/fx";
import { round2 } from "@/lib/profit";
import {
  buildResolver,
  fetchCampaignHandleMap,
  fetchMatcherProducts,
  fetchShopifySalesByProductDay,
  trackerFx,
} from "@/lib/trackers/match";
import {
  syncMetaForUser,
  syncShopifyOrdersForUser,
  refreshCampaignLinks,
} from "@/lib/jobs";
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
  return error ? { ok: false, error: error.message } : { ok: true };
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

  const { data: settings } = await supabase
    .from("pnl_settings")
    .select("currency")
    .eq("user_id", user.id)
    .maybeSingle();
  const targetIso = SYMBOL_TO_ISO[settings?.currency ?? "€"] ?? "EUR";
  const store = await getStoreCurrency(supabase, user.id);
  const fx =
    store && store.toUpperCase() !== targetIso
      ? await getCurrentRate(store, targetIso)
      : 1;

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  const [{ data: metrics }, { data: existing }] = await Promise.all([
    supabase
      .from("daily_metrics")
      .select("date, gross_revenue, refunds, product_cost, ad_spend")
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

  const rows = (metrics ?? []).map((m) => {
    const day = parseInt(m.date.slice(8, 10), 10);
    const ex = exByDay.get(day);
    return {
      user_id: user.id,
      year,
      month,
      day,
      gross_revenue: round2(Number(m.gross_revenue) * fx),
      refunds: round2(Number(m.refunds) * fx),
      cogs: round2(Number(m.product_cost) * fx),
      adspend_fb: round2(Number(m.ad_spend) * fx),
      adspend_google: ex ? Number(ex.adspend_google) : 0,
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
export async function autofillRoasDay(day: number): Promise<ImportResult> {
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

  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

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
  let pos = existing?.length ?? 0;

  const upserts = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    const ex = byName.get(name);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const m = resolve(c.campaign_id, name);
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    // Shopify is the source of truth for sales: when we know the product, use
    // its real orders/units + NET revenue for this day (price = net ÷ units, so
    // Store Val = net of discounts); otherwise fall back to Meta's count.
    const sale = m?.productId ? shopSales.get(`${m.productId}:${date}`) : undefined;
    const pur = m?.productId ? sale?.orders ?? 0 : Number(c.purchases);
    const units = m?.productId ? sale?.units ?? 0 : Number(c.purchases);
    const priceNet =
      sale && units > 0 ? round2((sale.revenue / units) * fx) : null;
    return {
      id: ex?.id ?? crypto.randomUUID(),
      user_id: user.id,
      day,
      position: ex?.position ?? pos++,
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
export async function autofillRoasAllDays(): Promise<ImportResult> {
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

  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
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
      supabase.from("roas_entries").select("*").eq("user_id", user.id),
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

  const upserts = active.map((c) => {
    const day = parseInt(c.date.slice(8, 10), 10);
    const name = c.campaign_name ?? c.campaign_id;
    const ex = existingByKey.get(`${day}:${name}`);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const m = resolve(c.campaign_id, name);
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    // Shopify is the source of truth for sales (NET revenue, after discounts).
    const sale = m?.productId ? shopSales.get(`${m.productId}:${c.date}`) : undefined;
    const pur = m?.productId ? sale?.orders ?? 0 : Number(c.purchases);
    const units = m?.productId ? sale?.units ?? 0 : Number(c.purchases);
    const priceNet =
      sale && units > 0 ? round2((sale.revenue / units) * fx) : null;

    let position: number;
    if (ex) {
      position = ex.position;
    } else {
      position = nextPosByDay.get(day) ?? 0;
      nextPosByDay.set(day, position + 1);
    }

    return {
      id: ex?.id ?? crypto.randomUUID(),
      user_id: user.id,
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
