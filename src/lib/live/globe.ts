import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { addDaysYmd, todayYmd, ymdInTz, zonedDayStartUtc } from "@/lib/date";
import { resolveFx } from "@/lib/fx";
import { liveSummary } from "@/lib/shopify/sync";
import { storeLabel } from "@/lib/utils";
import type { GlobeOrder, GlobeState, GlobeStore } from "@/types/globe";

type DB = SupabaseClient<Database>;
type Settings = Pick<Tables<"settings">, "currency" | "timezone" | "fx_rate_override" | "fx_override_currency">;

/** One colour per store, in connection order. Chosen to stay apart on a dark globe. */
const COLORS = ["#6cc4ff", "#ff9a62", "#b497ff", "#ffd45e", "#4fe0c0", "#ff7eb6", "#9be564", "#f4a8ff", "#7aa2ff", "#ffb86b"];
const MAX_ORDERS = 6000;
const round2 = (value: number) => Math.round(value * 100) / 100;
const upper = (value: string | null | undefined) => (value ? value.toUpperCase() : null);

/** Seconds since local midnight in the account's timezone. */
function secondOfDay(instant: number, timeZone: string): number {
  const [h, m, s] = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })
    .format(new Date(instant)).split(":").map(Number);
  return h * 3600 + m * 60 + s;
}

/** How many display-currency units one unit of `currency` is worth, honouring the account's pinned rate. */
export async function displayRate(settings: Settings, currency: string | null | undefined): Promise<number> {
  return resolveFx(currency, settings.currency, {
    displayCurrency: settings.currency, override: settings.fx_rate_override, overrideCurrency: settings.fx_override_currency,
  });
}

/** The order as the live view draws it, from a Shopify order payload (webhook). */
export function globeOrderFromShopify(storeId: string, order: any, rate: number, fallbackCurrency: string | null): GlobeOrder {
  const live = liveSummary(order);
  const total = Number(order.total_price ?? 0) || 0;
  const address = order.shipping_address ?? order.billing_address ?? null;
  return {
    id: `${storeId}:${order.id}`, store: storeId,
    num: String(order.name ?? (order.order_number ? `#${order.order_number}` : "")),
    ts: Date.parse(order.processed_at ?? order.created_at ?? "") || Date.now(),
    total, cur: upper(order.currency) ?? upper(fallbackCurrency) ?? "", amount: round2(total * rate),
    city: live.city ?? "", cc: upper(address?.country_code) ?? "", lat: live.lat, lng: live.lng,
    title: live.item ?? "", more: Math.max(0, live.lines - 1),
  };
}

type OrderRow = Pick<Tables<"orders">, "shopify_connection_id" | "shopify_order_id" | "order_number" | "processed_at" | "total_price" | "currency" | "country"> & {
  live: { city?: string | null; lat?: number | null; lng?: number | null; item?: string | null; lines?: number } | null;
};

/**
 * Everything a live view needs when it opens: today's orders, yesterday's pace,
 * the week and today's ad spend, all in the account's display currency. Read
 * with the caller's own client, so Row Level Security scopes it to the owner.
 */
export async function readGlobeState(db: DB, userId: string): Promise<GlobeState> {
  const now = Date.now();
  const [settingsResult, storesResult] = await Promise.all([
    db.from("settings").select("currency,timezone,fx_rate_override,fx_override_currency").eq("user_id", userId).maybeSingle(),
    db.from("shopify_connections").select("id,shop_name,shop_domain,reporting_base_currency")
      .eq("user_id", userId).in("status", ["active", "error"]).order("created_at"),
  ]);
  if (settingsResult.error) throw settingsResult.error;
  if (storesResult.error) throw storesResult.error;
  const settings: Settings = settingsResult.data ?? { currency: "EUR", timezone: "UTC", fx_rate_override: null, fx_override_currency: null };
  const timeZone = settings.timezone || "UTC";
  const today = todayYmd(timeZone), yesterday = addDaysYmd(today, -1);
  const since = zonedDayStartUtc(yesterday, timeZone).toISOString();
  const storeRows = storesResult.data ?? [];
  const storeIds = storeRows.map(store => store.id);

  const orders: OrderRow[] = [];
  if (storeIds.length) {
    for (let from = 0; from < MAX_ORDERS; from += 1000) {
      // Cast at the source: a JSON path in the column list sends the typed
      // select parser into unbounded recursion. PostgREST extracts `raw->live`
      // in the database, so the payment proof in `raw` never leaves it.
      const { data, error } = await (db.from("orders") as any)
        .select("shopify_connection_id,shopify_order_id,order_number,processed_at,total_price,currency,country,live:raw->live")
        .eq("user_id", userId).in("shopify_connection_id", storeIds).gte("processed_at", since)
        .eq("test", false).is("cancelled_at", null)
        .order("processed_at").order("id").range(from, from + 999);
      if (error) throw error;
      const page = (data ?? []) as OrderRow[];
      orders.push(...page);
      if (page.length < 1000) break;
    }
  }
  const metrics = storeIds.length ? await db.from("daily_metrics")
    .select("date,shopify_connection_id,revenue,orders_count,ad_spend,ad_spend_meta,ad_spend_google,updated_at")
    .eq("user_id", userId).in("shopify_connection_id", storeIds).gte("date", addDaysYmd(today, -7)).lte("date", today) : { data: [], error: null };
  if (metrics.error) throw metrics.error;

  const baseCurrency = new Map(storeRows.map(store => [store.id, upper(store.reporting_base_currency)]));
  const currencies = new Set<string>([...baseCurrency.values(), ...orders.map(order => upper(order.currency))].filter((c): c is string => !!c));
  const rates = new Map<string, number>(await Promise.all([...currencies].map(async currency => [currency, await displayRate(settings, currency)] as const)));
  const rateOf = (currency: string | null | undefined) => rates.get(upper(currency) ?? "") ?? 1;

  const index = new Map(storeIds.map((id, i) => [id, i]));
  const homes = new Map<string, Map<string, number>>();
  const todayOrders: GlobeOrder[] = [];
  const prev: [number, number, number][] = [];
  for (const row of orders) {
    const store = row.shopify_connection_id;
    if (!store || !index.has(store)) continue;
    const ts = Date.parse(row.processed_at);
    const currency = upper(row.currency) ?? baseCurrency.get(store) ?? null;
    const total = Number(row.total_price) || 0, amount = round2(total * rateOf(currency));
    const cc = upper(row.country) ?? "";
    if (cc) { const seen = homes.get(store) ?? new Map<string, number>(); seen.set(cc, (seen.get(cc) ?? 0) + 1); homes.set(store, seen); }
    if (ymdInTz(new Date(ts), timeZone) === today) {
      todayOrders.push({ id: `${store}:${row.shopify_order_id}`, store, num: row.order_number ?? "", ts, total, cur: currency ?? "", amount,
        city: row.live?.city ?? "", cc, lat: row.live?.lat ?? null, lng: row.live?.lng ?? null, title: row.live?.item ?? "", more: Math.max(0, (row.live?.lines ?? 1) - 1) });
    } else prev.push([secondOfDay(ts, timeZone), amount, index.get(store)!]);
  }

  const week: GlobeState["week"] = {};
  const ads: GlobeState["ads"] = { at: now, updated: 0, today: {} };
  for (const row of metrics.data ?? []) {
    const store = row.shopify_connection_id;
    if (!store || !index.has(store)) continue;
    const rate = rateOf(baseCurrency.get(store));
    if (row.date === today) {
      ads.today[store] = { amount: round2((Number(row.ad_spend) || 0) * rate), google: round2((Number(row.ad_spend_google) || 0) * rate), meta: round2((Number(row.ad_spend_meta) || 0) * rate) };
      ads.updated = Math.max(ads.updated, Date.parse(row.updated_at) || 0);
    } else (week[row.date] ??= {})[store] = { n: Number(row.orders_count) || 0, amount: round2((Number(row.revenue) || 0) * rate) };
  }

  const stores: GlobeStore[] = storeRows.map((store, i) => {
    const seen = [...(homes.get(store.id) ?? [])].sort((a, b) => b[1] - a[1])[0];
    return { key: store.id, name: storeLabel(store.shop_name, store.shop_domain), cur: baseCurrency.get(store.id) ?? settings.currency, home: seen?.[0] ?? null, color: COLORS[i % COLORS.length] };
  });
  return { now, day: today, timeZone, currency: upper(settings.currency) ?? "EUR", stores, orders: todayOrders, prev, week, ads };
}
