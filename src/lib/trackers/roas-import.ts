import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { round2 } from "@/lib/profit";
import {
  buildResolver,
  fetchCampaignHandleMap,
  fetchMatcherProducts,
  fetchShopifySalesByProductDay,
  splitProductSales,
  trackerFxByMetaConnection,
  type SalesClaimant,
} from "@/lib/trackers/match";

type DB = SupabaseClient<Database>;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Project the ROAS tracker from ALREADY-SYNCED Meta campaigns + Shopify sales
 * onto `roas_entries` for a whole month.
 *
 * Pure projection: it reads what the sync has already written (no live Meta /
 * Shopify calls), so it's cheap enough to run on the cron and after a background
 * sync — the tracker fills itself in without anyone pressing "Importar". Manual
 * product economics (Price / COG / Units / ATC) on existing rows are preserved.
 *
 * This is the post-sync core that `autofillRoasAllDays` used to inline; the
 * action now just triggers a live sync first, then calls this.
 * Returns how many rows were upserted.
 */
export async function projectRoasMonth(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
): Promise<number> {
  const [{ data: rs }, { data: settings }] = await Promise.all([
    supabase.from("roas_settings").select("currency").eq("user_id", userId).maybeSingle(),
    supabase.from("settings").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);
  const { rates: fxByConn, fallback: fxFallback } =
    await trackerFxByMetaConnection(supabase, userId, rs?.currency);
  const fxFor = (metaConnectionId: string | null): number =>
    (metaConnectionId ? fxByConn.get(metaConnectionId) : undefined) ?? fxFallback;
  const tz = settings?.timezone ?? "UTC";

  const lastDay = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(lastDay)}`;

  const [{ data: camps }, { data: existing }, products, handleMap, shopSales] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "campaign_id, campaign_name, spend, clicks, purchases, purchase_value, date, atc, meta_connection_id",
        )
        .eq("user_id", userId)
        .gte("date", from)
        .lte("date", to),
      supabase
        .from("roas_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("year", year)
        .eq("month", month),
      fetchMatcherProducts(supabase, userId),
      fetchCampaignHandleMap(supabase, userId),
      fetchShopifySalesByProductDay(supabase, userId, { from, to }, tz),
    ]);

  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (active.length === 0) return 0;

  const resolve = buildResolver(products, handleMap);
  const existingByKey = new Map<string, NonNullable<typeof existing>[number]>();
  const nextPosByDay = new Map<number, number>();
  for (const e of existing ?? []) {
    existingByKey.set(`${e.day}:${e.campaign_name}`, e);
    nextPosByDay.set(e.day, Math.max(nextPosByDay.get(e.day) ?? 0, e.position + 1));
  }

  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    return { c, name, m: resolve(c.campaign_id, name) };
  });

  // A product's real Shopify sales are counted ONCE per DAY, then SPLIT across
  // every campaign that advertised it (see splitProductSales) — so duplicated
  // campaigns from horizontal scaling each get their share instead of one taking
  // all the sales and the rest reading as -100% margin.
  const claimantsByProductDay = new Map<string, SalesClaimant[]>(); // `${productId}:${date}`
  for (const { c, m } of rows) {
    if (!m?.productId) continue;
    const key = `${m.productId}:${c.date}`;
    const list = claimantsByProductDay.get(key) ?? [];
    list.push({
      campaignId: c.campaign_id,
      metaPurchases: Number(c.purchases),
      spend: Number(c.spend),
    });
    claimantsByProductDay.set(key, list);
  }
  // `${productId}:${date}:${campaignId}` -> that campaign's share of the day.
  const shareByCampaign = new Map<string, { orders: number; units: number }>();
  for (const [key, claimants] of claimantsByProductDay) {
    const sale = shopSales.get(key);
    if (!sale) continue;
    for (const [campaignId, share] of splitProductSales(claimants, {
      orders: sale.orders,
      units: sale.units,
    })) {
      shareByCampaign.set(`${key}:${campaignId}`, share);
    }
  }

  const claimed = new Set<string>();

  const upserts = rows.map(({ c, name, m }) => {
    const fx = fxFor(c.meta_connection_id);
    const day = parseInt(c.date.slice(8, 10), 10);
    const ex = existingByKey.get(`${day}:${name}`);
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    const saleKey = m?.productId ? `${m.productId}:${c.date}` : null;
    const sale = saleKey ? shopSales.get(saleKey) : undefined;
    const share = saleKey
      ? shareByCampaign.get(`${saleKey}:${c.campaign_id}`)
      : undefined;
    // Matched to a product → this campaign's SHARE of that product's real
    // Shopify sales. Unmatched → fall back to Meta's own purchase count.
    const pur = m?.productId ? (share?.orders ?? 0) : Number(c.purchases);
    const units = m?.productId ? (share?.units ?? 0) : Number(c.purchases);
    // Realised unit price is a property of the PRODUCT-DAY, not of one
    // campaign's slice, so every campaign on the same product shows the same
    // price (and a campaign allotted 0 units still gets a sensible price).
    const priceNet =
      sale && sale.units > 0 ? round2((sale.revenue / sale.units) * fx) : null;

    let position: number;
    if (reuseId) {
      position = ex!.position;
    } else {
      position = nextPosByDay.get(day) ?? 0;
      nextPosByDay.set(day, position + 1);
    }

    return {
      id: reuseId ?? crypto.randomUUID(),
      user_id: userId,
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
  if (error) throw error;
  return upserts.length;
}

/**
 * Single-day version of {@link projectRoasMonth} — projects already-synced Meta
 * campaigns for one day onto `roas_entries`. Used by the live day refresh.
 */
export async function projectRoasDay(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
  day: number,
): Promise<number> {
  const [{ data: rs }, { data: settings }] = await Promise.all([
    supabase.from("roas_settings").select("currency").eq("user_id", userId).maybeSingle(),
    supabase.from("settings").select("timezone").eq("user_id", userId).maybeSingle(),
  ]);
  const { rates: fxByConn, fallback: fxFallback } =
    await trackerFxByMetaConnection(supabase, userId, rs?.currency);
  const fxFor = (metaConnectionId: string | null): number =>
    (metaConnectionId ? fxByConn.get(metaConnectionId) : undefined) ?? fxFallback;
  const tz = settings?.timezone ?? "UTC";

  const date = `${year}-${pad(month)}-${pad(day)}`;

  const [{ data: camps }, { data: existing }, products, handleMap, shopSales] =
    await Promise.all([
      supabase
        .from("campaigns")
        .select(
          "campaign_id, campaign_name, spend, clicks, purchases, purchase_value, atc, meta_connection_id",
        )
        .eq("user_id", userId)
        .eq("date", date),
      supabase
        .from("roas_entries")
        .select("*")
        .eq("user_id", userId)
        .eq("year", year)
        .eq("month", month)
        .eq("day", day),
      fetchMatcherProducts(supabase, userId),
      fetchCampaignHandleMap(supabase, userId),
      fetchShopifySalesByProductDay(supabase, userId, { from: date, to: date }, tz),
    ]);

  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (active.length === 0) return 0;

  const resolve = buildResolver(products, handleMap);
  const byName = new Map((existing ?? []).map((e) => [e.campaign_name, e]));

  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    return { c, name, m: resolve(c.campaign_id, name) };
  });

  // Same once-per-product, split-across-campaigns rule as projectRoasMonth —
  // just for a single date. See splitProductSales for why winner-takes-all
  // breaks horizontal scaling.
  const claimantsByProduct = new Map<string, SalesClaimant[]>();
  for (const { c, m } of rows) {
    if (!m?.productId) continue;
    const list = claimantsByProduct.get(m.productId) ?? [];
    list.push({
      campaignId: c.campaign_id,
      metaPurchases: Number(c.purchases),
      spend: Number(c.spend),
    });
    claimantsByProduct.set(m.productId, list);
  }
  // `${productId}:${campaignId}` -> that campaign's share of the day.
  const shareByCampaign = new Map<string, { orders: number; units: number }>();
  for (const [productId, claimants] of claimantsByProduct) {
    const sale = shopSales.get(`${productId}:${date}`);
    if (!sale) continue;
    for (const [campaignId, share] of splitProductSales(claimants, {
      orders: sale.orders,
      units: sale.units,
    })) {
      shareByCampaign.set(`${productId}:${campaignId}`, share);
    }
  }

  const claimed = new Set<string>();
  let pos = existing?.length ?? 0;

  const upserts = rows.map(({ c, name, m }) => {
    const fx = fxFor(c.meta_connection_id);
    const ex = byName.get(name);
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    const sale = m?.productId
      ? shopSales.get(`${m.productId}:${date}`)
      : undefined;
    const share = m?.productId
      ? shareByCampaign.get(`${m.productId}:${c.campaign_id}`)
      : undefined;
    const pur = m?.productId ? (share?.orders ?? 0) : Number(c.purchases);
    const units = m?.productId ? (share?.units ?? 0) : Number(c.purchases);
    const priceNet =
      sale && sale.units > 0 ? round2((sale.revenue / sale.units) * fx) : null;
    return {
      id: reuseId ?? crypto.randomUUID(),
      user_id: userId,
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
  if (error) throw error;
  return upserts.length;
}

/**
 * The month a user's ROAS tracker should keep fresh right now: the current month
 * in their timezone. Unlike the P&L sheet, the ROAS tracker has no fixed base
 * year — it always tracks the live calendar month.
 */
export async function currentRoasMonth(
  supabase: DB,
  userId: string,
): Promise<{ year: number; month: number }> {
  const { data: settings } = await supabase
    .from("settings")
    .select("timezone")
    .eq("user_id", userId)
    .maybeSingle();
  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: settings?.timezone ?? "UTC",
  }); // yyyy-mm-dd
  return { year: Number(ymd.slice(0, 4)), month: Number(ymd.slice(5, 7)) };
}
