import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { todayYmd } from "@/lib/date";
import { getGoogleChanges } from "@/lib/google/change-history";
import { parseScriptCampaignId } from "@/lib/google/script-campaigns";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { fetchCollectionProductIds } from "@/lib/shopify/collection-products";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getStoreFxRates } from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { getPnlSettings, getPnlYear } from "./queries";
import { fetchTrackerOrderSales } from "./sales";
import { getGooglePnlCatalog } from "./google-pnl-query";
import { calculateGoogleScale, lastFiveCompleteDays } from "./google-scale";
import type { PnlFees } from "./pnl";

// Scoped cache contains product IDs only, never access tokens or sales.
const membershipCache = new Map<string, { expires: number; ids: string[] }>();

export async function getGoogleSignals(db: SupabaseClient<Database>, userId: string, currency: string) {
  const { data: settings, error } = await db.from("settings").select("timezone,currency,fx_rate_override").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const today = todayYmd(settings?.timezone ?? "UTC");
  const range = lastFiveCompleteDays(today);
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const [catalog, changes, orders, connections, products, rates, pnl] = await Promise.all([
    getGooglePnlCatalog(db, userId, Number(today.slice(0, 4)), range),
    getGoogleChanges(db, userId),
    fetchTrackerOrderSales(db, userId, range, settings?.timezone ?? "UTC", "all"),
    selectAllByUser<Tables<"shopify_connections">>(db, "shopify_connections", "*", userId),
    selectAllByUser<Pick<Tables<"products">, "handle" | "shopify_product_id" | "shopify_connection_id">>(db, "products", "handle,shopify_product_id,shopify_connection_id", userId),
    getStoreFxRates(db, userId, iso, settings?.fx_rate_override, true, settings?.currency ?? iso),
    getPnlSettings(db, userId),
  ]);
  const years = [...new Set([Number(range.from.slice(0, 4)), Number(range.to.slice(0, 4))])];
  const feeCurrency = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[pnl.currency] ?? pnl.currency;
  const feeFx = await resolveFx(feeCurrency, iso, { required: true });
  const overrides = (await Promise.all(years.map((year) => getPnlYear(db, userId, year)))).flatMap((y) => y.overrides);
  const fees = (date: string): PnlFees => {
    const o = overrides.find((o) => o.year === Number(date.slice(0, 4)) && o.month === Number(date.slice(5, 7)));
    return { feeFb: Number(o?.agency_fee_fb ?? pnl.agency_fee_fb), feeGoogle: Number(o?.agency_fee_google ?? pnl.agency_fee_google),
      txFee: Number(o?.transaction_fee ?? pnl.transaction_fee) * feeFx, paymentPct: Number(pnl.payment_fee_pct ?? 0.025) };
  };
  const scopes = new Map<string, Promise<string[] | null>>();
  const tokens = new Map<string, Promise<string>>();
  function productIds(c: typeof catalog.options[number]) {
    if (!c.storeId) return Promise.resolve(null);
    if (c.productHandle && !c.manualCollection) {
      const ids = products.filter((p) => p.shopify_connection_id === c.storeId && p.handle === c.productHandle).map((p) => p.shopify_product_id);
      return Promise.resolve(ids.length ? [...new Set(ids)] : null);
    }
    if (!c.collectionHandle) return Promise.resolve(null);
    const key = `${userId}:${c.storeId}:${c.collectionHandle}`;
    const conn = connections.find((s) => s.id === c.storeId);
    if (!conn) return Promise.resolve(null);
    if (!scopes.has(key)) scopes.set(key, (async () => {
      const cached = membershipCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.ids;
      try {
        if (!tokens.has(conn.id)) tokens.set(conn.id, resolveShopifyToken(conn));
        const ids = await fetchCollectionProductIds(conn.shop_domain, await tokens.get(conn.id)!, c.collectionHandle!);
        if (ids != null) {
          if (membershipCache.size >= 500) membershipCache.delete(membershipCache.keys().next().value!);
          membershipCache.set(key, { expires: Date.now() + 5 * 60_000, ids });
        }
        return ids;
      } catch { return null; }
    })());
    return scopes.get(key)!;
  }
  const memberships = new Map(await Promise.all(catalog.options.map(async (c) => [c.key, await productIds(c)] as const)));
  const signals = new Map(catalog.options.map((c) => {
    const rate = rates.get(c.storeId ?? "") ?? 1;
    const ids = memberships.get(c.key) ?? null;
    const shared = !!ids?.some((id) => catalog.options.some((other) => other.key !== c.key && other.storeId === c.storeId && other.status === "ENABLED" && memberships.get(other.key)?.includes(id)));
    return [c.key, calculateGoogleScale({ range, status: c.status, storeId: c.storeId, rate, orders, productIds: ids, fees, shared,
      scope: c.productHandle && !c.manualCollection ? `Produto: ${c.productHandle}` : c.collectionHandle ? `Coleção: ${c.collectionHandle}` : null,
      facts: catalog.rows.filter((r) => r.key === c.key).map((r) => ({ date: r.date,
        grossSpend: r.gross_spend != null ? Number(r.gross_spend) * rate : parseScriptCampaignId(r.campaign_id) ? null : Number(r.spend) * rate,
        conversionValue: Number(r.purchase_value) * rate })) })] as const;
  }));
  return { today, range, signals, changes, catalog };
}
