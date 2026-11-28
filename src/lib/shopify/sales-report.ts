import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import type { DateRange } from "@/types";
import { eachDay, todayYmd } from "@/lib/date";
import { serverEnv } from "@/lib/env";
import { resolveShopifyToken } from "./auth";

export type SalesDay = { storeId: string; date: string; revenue: number; orders: number };
export type SalesReport = { days: SalesDay[]; unavailable: string[]; currency: string; timeZone: string; at: number };

/** Shopify's report UI truncates sub-minor-unit FX precision (2025.319 EUR → 2025.31). */
export function reportMoney(value: number, currency: string) {
  const digits = new Intl.NumberFormat("en", { style: "currency", currency }).resolvedOptions().maximumFractionDigits ?? 2;
  const factor = 10 ** digits;
  return Math.sign(value) * Math.trunc(Math.abs(value) * factor + 1e-7) / factor;
}

export function salesQuery(range: DateRange, currency: string, timeZone: string) {
  if (!/^[A-Z]{3}$/.test(currency) || !/^[A-Za-z_+\-/]+$/.test(timeZone)
    || !/^\d{4}-\d{2}-\d{2}$/.test(range.from) || !/^\d{4}-\d{2}-\d{2}$/.test(range.to)) throw new Error("Invalid sales range");
  new Intl.DateTimeFormat("en", { timeZone });
  return `FROM sales SHOW total_sales, orders TIMESERIES day WITH CURRENCY '${currency}', TIMEZONE '${timeZone}' SINCE ${range.from} UNTIL ${range.to} ORDER BY day ASC LIMIT 1000`;
}

/** Never turn an access/parse error or an incomplete response into zero sales. */
export function parseSalesResponse(json: any, range: DateRange): Omit<SalesDay, "storeId">[] {
  const result = json?.data?.shopifyqlQuery;
  if (json?.errors?.length || !result || result.parseErrors?.length || !Array.isArray(result.tableData?.rows)) throw new Error("Shopify sales unavailable");
  const values = new Map<string, Omit<SalesDay, "storeId">>();
  for (const row of result.tableData.rows) {
    const date = String(row.day ?? "").slice(0, 10);
    const revenue = row.total_sales == null ? NaN : Number(row.total_sales);
    const orders = row.orders == null ? NaN : Number(row.orders);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(revenue) || !Number.isInteger(orders) || orders < 0 || values.has(date)) throw new Error("Invalid sales row");
    if (date >= range.from && date <= range.to) values.set(date, { date, revenue, orders });
  }
  return eachDay(range).map(date => values.get(date) ?? { date, revenue: 0, orders: 0 });
}

// Small, bounded aggregate cache only. No orders, new database tables or storage writes.
const cache = new Map<string, { expires: number; value: Promise<Omit<SalesDay, "storeId">[]> }>();
async function readRange(conn: any, range: DateRange, currency: string, timeZone: string) {
  const q = salesQuery(range, currency, timeZone);
  const key = JSON.stringify([conn.user_id, conn.id, conn.updated_at, q]);
  const hit = cache.get(key);
  if (hit && hit.expires > Date.now()) return hit.value;
  if (cache.size >= 256) cache.delete(cache.keys().next().value!);
  const value = (async () => {
    const token = await resolveShopifyToken(conn);
    const response = await fetch(`https://${conn.shop_domain}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`, {
      method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query: "query Sales($q: String!) { shopifyqlQuery(query: $q) { parseErrors tableData { rows } } }", variables: { q } }),
      cache: "no-store", signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) throw new Error("Shopify sales unavailable");
    return parseSalesResponse(await response.json(), range);
  })();
  cache.set(key, { expires: Date.now() + 60_000, value });
  return value;
}

export async function readSalesReport(db: SupabaseClient<Database>, userId: string, range: DateRange, storeId?: string): Promise<SalesReport> {
  let query = db.from("shopify_connections").select("id,user_id,shop_domain,access_token,auth_type,client_id,updated_at,reporting_base_currency")
    .eq("user_id", userId).in("status", ["active", "error"]);
  if (storeId) query = query.eq("id", storeId);
  const [connections, settings] = await Promise.all([query, db.from("settings")
    .select("currency,timezone,fx_rate_override,fx_override_currency").eq("user_id", userId).maybeSingle()]);
  if (connections.error || settings.error) throw new Error("Could not read sales settings");
  const currency = settings.data?.currency || "EUR", timeZone = settings.data?.timezone || "UTC";
  const today = todayYmd(timeZone);
  const to = range.to < today ? range.to : today;
  const canonical = { from: range.from.slice(0, 7) + "-01", to };
  // The query's 1,000-row limit must never silently truncate a long custom period.
  if ((Date.parse(to) - Date.parse(canonical.from)) / 86400000 >= 1000) throw new Error("Sales period too long");
  const days: SalesDay[] = [], unavailable: string[] = [];
  await Promise.all((connections.data ?? []).map(async conn => {
    try {
      // Keep a deliberate fixed exchange rate for the currency it actually applies to.
      const pinned = settings.data?.fx_rate_override && conn.reporting_base_currency === settings.data.fx_override_currency
        && conn.reporting_base_currency !== currency;
      const reportCurrency = pinned ? conn.reporting_base_currency! : currency;
      const rate = pinned ? 1 / Number(settings.data!.fx_rate_override) : 1;
      const values = to < range.from ? [] : await readRange(conn, canonical, reportCurrency, timeZone);
      days.push(...values.filter(day => day.date >= range.from && day.date <= range.to)
        .map(day => ({ ...day, storeId: conn.id, revenue: pinned ? day.revenue * rate : reportMoney(day.revenue, currency) })));
    } catch { unavailable.push(conn.id); }
  }));
  return { days, unavailable, currency, timeZone, at: Date.now() };
}
