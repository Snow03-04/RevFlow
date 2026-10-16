import "server-only";
import crypto from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { round2 } from "@/lib/profit";
import {
  buildResolver,
  fetchCampaignTargetMap,
  fetchMatcherProducts,
  trackerFxByMetaConnection,
} from "@/lib/trackers/match";
import { fetchTrackerOrderSales } from "@/lib/trackers/sales";
import { attributeRoasSales, roasCampaignDayKey } from "./roas-attribution";
import { getCollectionLandingProducts } from "./collection-memberships";
import { generalCampaignLinkId } from "./general-sheet";
import { metaCampaignKey } from "./meta-pnl";
import { addDaysYmd } from "@/lib/date";

import { selectAllByUser } from "@/lib/supabase/paginate";

type DB = SupabaseClient<Database>;

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Project the ROAS tracker from ALREADY-SYNCED Meta campaigns + Shopify sales
 * onto `roas_entries` for a whole month.
 *
 * Orders and Meta facts come from the existing sync. Collection product handles
 * are read once per collection and cached for five minutes, avoiding a request
 * per order or day. Only confirmed membership may broaden landing attribution.
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
  opts: { onlyDay?: number; fromDay?: number; toDay?: number; costsOnly?: boolean; salesOnly?: boolean } = {},
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
  const fromDay = opts.onlyDay ?? opts.fromDay ?? 1;
  const toDay = opts.onlyDay ?? opts.toDay ?? lastDay;
  const from = `${year}-${pad(month)}-${pad(fromDay)}`;
  const to = `${year}-${pad(month)}-${pad(toDay)}`;

  const [camps, existing, products, targetMap, orders] = await Promise.all([
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
        return q.gte("day", fromDay).lte("day", toDay);
      },
    ),
    fetchMatcherProducts(supabase, userId),
    fetchCampaignTargetMap(supabase, userId),
    fetchTrackerOrderSales(supabase, userId, { from, to }, tz),
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
    const key = `${e.day}:${e.campaign_key ?? `name:${e.campaign_name}`}`;
    existingByKey.set(key, [...(existingByKey.get(key) ?? []), e]);
    nextPosByDay.set(
      e.day,
      Math.max(nextPosByDay.get(e.day) ?? 0, e.position + 1),
    );
  }

  const rows = active.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    const key = metaCampaignKey(c.meta_connection_id, c.campaign_id);
    const manual = generalCampaignLinkId("meta", key);
    const m = resolveFor(storeFor(c.meta_connection_id))(targetMap.has(manual) ? manual : c.campaign_id, name);
    return {
      c,
      name,
      m,
      key,
    };
  });
  const scopes = rows.flatMap(({ c, m }) => {
    const storeId = storeFor(c.meta_connection_id);
    if (!m?.collectionHandle) return [];
    if (!storeId) throw new Error("Associa a conta Meta da campanha de coleção a uma loja em Connections.");
    return [{ storeId, handle: m.collectionHandle }];
  });
  const memberships = await getCollectionLandingProducts(supabase, userId, scopes);
  const shopSales = attributeRoasSales(rows.map(({ c, name, m, key }) => ({
    key, campaignId: c.campaign_id, name, date: c.date, storeId: storeFor(c.meta_connection_id),
    target: m, purchases: Number(c.purchases), spend: Number(c.spend),
  })), orders, products, memberships);

  const claimed = new Set<string>();

  const upserts = rows.map(({ c, name, m, key }) => {
    const fx = fxFor(c.meta_connection_id);
    const day = parseInt(c.date.slice(8, 10), 10);
    const candidates = existingByKey.get(`${day}:${key}`) ?? existingByKey.get(`${day}:name:${name}`) ?? [];
    const ex = candidates.find((e) => !claimed.has(e.id));
    const warning = m?.collectionHandle && memberships.get(`${storeFor(c.meta_connection_id)}:${m.collectionHandle}`) == null
      ? "Vendas por confirmar: produtos da coleção indisponíveis no Shopify. Valores anteriores mantidos." : null;
    const reuseId = ex && !claimed.has(ex.id) ? ex.id : null;
    if (reuseId) claimed.add(reuseId);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    const exPrice = ex && Number(ex.price) > 0 ? Number(ex.price) : null;
    const exCog = ex && Number(ex.cog) > 0 ? Number(ex.cog) : null;
    const sale = shopSales.get(roasCampaignDayKey(key, c.date));
    const pur = sale ? sale.orders : Number(c.purchases);
    const units = sale ? sale.units : Number(c.purchases);
    // Unit economics come from the baskets allocated to this campaign/day.
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
      campaign_key: key,
      attribution_warning: warning,
      total_spend: round2(Number(c.spend) * fx),
      cpc: round2(cpc * fx),
      atc: Number(c.atc ?? 0),
      pur: warning && ex ? ex.pur : pur,
      price: warning && ex ? ex.price : priceNet ?? exPrice ?? (m ? round2(m.price * fx) : 0),
      cog: warning && ex ? ex.cog : cogNet ?? (m && m.cog > 0 ? round2(m.cog * fx) : (exCog ?? 0)),
      units_sold: warning && ex ? ex.units_sold : units,
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
          campaign_key: old.campaign_key ?? e.campaign_key,
          attribution_warning: opts.salesOnly ? e.attribution_warning : old.attribution_warning,
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

/** Refresh the selected day and the three closed days needed by both decisions.
 * One bounded read per month also handles the beginning of a month/year. */
export async function projectRoasDecisionDays(supabase: DB, userId: string, date: string): Promise<number> {
  const from = addDaysYmd(date, -3);
  const [year, month, day] = date.split("-").map(Number);
  const [firstYear, firstMonth, firstDay] = from.split("-").map(Number);
  if (firstYear === year && firstMonth === month)
    return projectRoasMonth(supabase, userId, year, month, { fromDay: firstDay, toDay: day });
  const previous = await projectRoasMonth(supabase, userId, firstYear, firstMonth, { fromDay: firstDay });
  return previous + await projectRoasMonth(supabase, userId, year, month, { toDay: day });
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
