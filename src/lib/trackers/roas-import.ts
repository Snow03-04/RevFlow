import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { round2 } from "@/lib/profit";
import {
  buildResolver,
  fetchCampaignTargetMap,
  fetchMatcherProducts,
  splitProductSales,
  trackerFxByMetaConnection,
  type ProductMatch,
  type SalesClaimant,
} from "@/lib/trackers/match";
import {
  collectionSalesKey,
  fetchTrackerSales,
  productSalesKey,
  type TargetSales,
} from "@/lib/trackers/sales";

import { selectAllByUser } from "@/lib/supabase/paginate";

type DB = SupabaseClient<Database>;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Look up the real Shopify sales behind a campaign for one day.
 *
 * A campaign resolves to a PRODUCT (its own sales) or to a COLLECTION landing
 * page (every order that arrived on that page). Collection buckets are scoped by
 * store, because two stores can each have a `/collections/all`; when a Meta
 * account isn't mapped to a store there's nothing to scope by, so the
 * store-agnostic bucket is used instead of silently reporting no sales.
 *
 * Returns the bucket KEY too — campaigns sharing a key are the ones whose sales
 * have to be split between them (see splitProductSales).
 */
function salesFor(
  sales: Map<string, TargetSales>,
  m: ProductMatch | null,
  storeId: string | null,
  date: string,
): { key: string; sale: TargetSales | undefined } | null {
  if (m?.productId) {
    const key = productSalesKey(m.productId, date);
    return { key, sale: sales.get(key) };
  }
  if (m?.collectionHandle) {
    const scoped = collectionSalesKey(storeId, m.collectionHandle, date);
    const hit = sales.get(scoped);
    if (hit || storeId) return { key: scoped, sale: hit };
    const anyStore = collectionSalesKey(null, m.collectionHandle, date);
    return { key: anyStore, sale: sales.get(anyStore) };
  }
  return null;
}

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
  opts: { onlyDay?: number; costsOnly?: boolean; salesOnly?: boolean } = {},
): Promise<number> {
  const [{ data: rs }, { data: settings }] = await Promise.all([
    supabase
      .from("roas_settings")
      .select("currency")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  const {
    rates: fxByConn,
    fallback: fxFallback,
    stores: storeByConn,
  } = await trackerFxByMetaConnection(supabase, userId, rs?.currency);
  const fxFor = (metaConnectionId: string | null): number =>
    (metaConnectionId ? fxByConn.get(metaConnectionId) : undefined) ??
    fxFallback;
  const storeFor = (metaConnectionId: string | null): string | null =>
    (metaConnectionId ? storeByConn.get(metaConnectionId) : undefined) ?? null;
  const tz = settings?.timezone ?? "UTC";

  const lastDay = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-${pad(opts.onlyDay ?? 1)}`;
  const to = `${year}-${pad(month)}-${pad(opts.onlyDay ?? lastDay)}`;

  const [camps, existing, products, targetMap, shopSales] = await Promise.all([
    selectAllByUser<Tables<"campaigns">>(
      supabase,
      "campaigns",
      "campaign_id,campaign_name,spend,clicks,purchases,purchase_value,date,atc,meta_connection_id",
      userId,
      (q) => q.gte("date", from).lte("date", to),
    ),
    selectAllByUser<Tables<"roas_entries">>(
      supabase,
      "roas_entries",
      "*",
      userId,
      (q) => {
        q = q.eq("year", year).eq("month", month);
        return opts.onlyDay ? q.eq("day", opts.onlyDay) : q;
      },
    ),
    fetchMatcherProducts(supabase, userId),
    fetchCampaignTargetMap(supabase, userId),
    fetchTrackerSales(supabase, userId, { from, to }, tz),
  ]);

  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (active.length === 0) return 0;

  const resolvers = new Map<string | null, ReturnType<typeof buildResolver>>();
  const resolveFor = (storeId: string | null) => {
    if (!resolvers.has(storeId))
      resolvers.set(storeId, buildResolver(products, targetMap, storeId));
    return resolvers.get(storeId)!;
  };
  const existingByKey = new Map<string, (typeof existing)[number][]>();
  const nextPosByDay = new Map<number, number>();
  for (const e of existing ?? []) {
    const key = `${e.day}:${e.campaign_name}`;
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), e]);
    nextPosByDay.set(
      e.day,
      Math.max(nextPosByDay.get(e.day) ?? 0, e.position + 1),
    );
  }

  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    const m = resolveFor(storeFor(c.meta_connection_id))(c.campaign_id, name);
    return {
      c,
      name,
      m,
      target: salesFor(shopSales, m, storeFor(c.meta_connection_id), c.date),
    };
  });

  // A target's real Shopify sales are counted ONCE per DAY, then SPLIT across
  // every campaign that advertised it (see splitProductSales) — so duplicated
  // campaigns from horizontal scaling each get their share instead of one taking
  // all the sales and the rest reading as -100% margin.
  const claimantsByTarget = new Map<string, SalesClaimant[]>();
  for (const { c, target } of rows) {
    if (!target) continue;
    const list = claimantsByTarget.get(target.key) ?? [];
    list.push({
      campaignId: c.campaign_id,
      metaPurchases: Number(c.purchases),
      spend: Number(c.spend),
    });
    claimantsByTarget.set(target.key, list);
  }
  // `${targetKey}:${campaignId}` -> that campaign's share of the day.
  const shareByCampaign = new Map<string, { orders: number; units: number }>();
  for (const [key, claimants] of claimantsByTarget) {
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

  const upserts = rows.map(({ c, name, m, target }) => {
    const fx = fxFor(c.meta_connection_id);
    const day = parseInt(c.date.slice(8, 10), 10);
    const candidates = existingByKey.get(`${day}:${name}`) ?? [];
    const ex = candidates.find((e) => !claimed.has(e.id));
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    const sale = target?.sale;
    const share = target
      ? shareByCampaign.get(`${target.key}:${c.campaign_id}`)
      : undefined;
    // Matched to a product or a collection landing page → this campaign's SHARE
    // of that target's real Shopify sales. Unmatched → Meta's own purchases.
    const pur = target ? (share?.orders ?? 0) : Number(c.purchases);
    const units = target ? (share?.units ?? 0) : Number(c.purchases);
    // Realised unit price/cost are properties of the TARGET-DAY, not of one
    // campaign's slice, so every campaign on the same target shows the same
    // figures (and a campaign allotted 0 units still gets sensible ones).
    const priceNet =
      sale && sale.units > 0 ? round2((sale.revenue / sale.units) * fx) : null;
    // Realised COGS beats the catalogue cost: it comes from costOrder, so the
    // supplier sheet, collection tiers and quantity tiers all reach the tracker
    // and its margin agrees with the dashboard's.
    const cogNet =
      sale && sale.units > 0 ? round2((sale.cost / sale.units) * fx) : null;

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
      cog: cogNet ?? (m && m.cog > 0 ? round2(m.cog * fx) : (exCog ?? 0)),
      units_sold: units,
    };
  });

  if (opts.costsOnly || opts.salesOnly) {
    const oldById = new Map(existing.map((e) => [e.id, e]));
    const updates = upserts
      .filter((e) => oldById.has(e.id))
      .map((e) => {
        const old = oldById.get(e.id)!;
        return {
          id: old.id,
          user_id: old.user_id,
          year: old.year,
          month: old.month,
          day: old.day,
          position: old.position,
          campaign_name: old.campaign_name,
          total_spend: old.total_spend,
          cpc: old.cpc,
          atc: old.atc,
          pur: old.pur,
          price: old.price,
          units_sold: old.units_sold,
          cog: e.cog,
          ...(opts.salesOnly
            ? { pur: e.pur, price: e.price, units_sold: e.units_sold }
            : {}),
        };
      });
    for (let i = 0; i < updates.length; i += 500) {
      const { error } = await supabase
        .from("roas_entries")
        .upsert(updates.slice(i, i + 500), { onConflict: "id" });
      if (error) throw error;
    }
    return updates.length;
  }

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
  return projectRoasMonth(supabase, userId, year, month, { onlyDay: day });
}

/**
 * Re-derive the live ROAS month after a COST change.
 *
 * The tracker's COGS comes from the priced orders (see fetchTrackerSales), not
 * from a cost column it stores itself, so editing a product cost or applying the
 * supplier sheet only reaches it through a projection. Without this the tracker
 * kept the previous costs until the next auto-refresh, and disagreed with the
 * dashboard in the meantime. No-op for users who never opened the tracker; never
 * throws — the periodic refresh is always there as a backstop.
 */
export async function refreshCurrentRoasMonth(
  supabase: DB,
  userId: string,
): Promise<void> {
  try {
    const { data: rs } = await supabase
      .from("roas_settings")
      .select("user_id")
      .eq("user_id", userId)
      .maybeSingle();
    if (!rs) return;
    const { year, month } = await currentRoasMonth(supabase, userId);
    await projectRoasMonth(supabase, userId, year, month);
  } catch {
    /* best-effort */
  }
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
