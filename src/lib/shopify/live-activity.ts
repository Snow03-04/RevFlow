import "server-only";
import { resolveShopifyToken, type ShopifyConnAuth } from "./auth";
import type { LiveReading, StoreActivity } from "@/types/live";

const metrics = [
  "sessions_with_cart_additions",
  "sessions_that_reached_checkout",
  "sessions_that_completed_checkout",
] as const;
const report = `FROM sessions SHOW ${metrics.join(", ")} SINCE -10min UNTIL now`;
const query = "query LiveActivity($report: String!) { shopifyqlQuery(query: $report) { parseErrors tableData { rows } } }";
const orderQuery = `query RecentSales($filter: String!, $purchaseFilter: String!) {
  orders(first: 1, reverse: true, sortKey: PROCESSED_AT, query: $filter) { nodes { processedAt test cancelledAt } }
  purchases: ordersCount(query: $purchaseFilter) { count precision }
}`;

type Store = ShopifyConnAuth & { id: string; updated_at: string };
type Snapshot = { reading: LiveReading; activity: StoreActivity };
const inFlight = new Map<string, Promise<Snapshot>>();

function count(value: unknown) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

function shopifyQuery(store: Store, token: string, query: string, variables: Record<string, string>) {
  return fetch(`https://${store.shop_domain}/admin/api/2026-10/graphql.json`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(8_000),
    cache: "no-store",
  });
}

async function readSessions(store: Store, token: string): Promise<LiveReading> {
  try {
    const response = await shopifyQuery(store, token, query, { report });
    if (response.status === 401 || response.status === 403) return { status: "denied" };
    if (!response.ok) return { status: "unavailable" };
    const result = await response.json();
    if (result.errors?.some((e: { extensions?: { code?: string } }) => e.extensions?.code === "ACCESS_DENIED")) return { status: "denied" };
    const data = result.data?.shopifyqlQuery;
    if (result.errors?.length || !data || data.parseErrors?.length || data.tableData?.rows?.length !== 1) return { status: "unavailable" };
    const row = data.tableData.rows[0];
    const [carts, checkouts, purchases] = metrics.map(key => count(row?.[key]));
    if (carts === null || checkouts === null || purchases === null) return { status: "unavailable" };
    return { status: "ok", carts, checkouts, purchases, readAt: new Date().toISOString() };
  } catch {
    return { status: "unavailable" };
  }
}

async function readRecentSales(store: Store, token: string): Promise<{ activity: StoreActivity; purchases: number | null }> {
  const now = new Date();
  const since = new Date(now.getTime() - 72 * 60 * 60_000);
  const filter = `test:false -status:cancelled processed_at:>='${since.toISOString()}' processed_at:<='${now.toISOString()}'`;
  const start = new Date(now.getTime() - 10 * 60_000);
  const purchaseFilter = `source_name:web test:false -status:cancelled created_at:>'${start.toISOString()}' created_at:<='${now.toISOString()}'`;
  const unknown = { activity: "unknown" as const, purchases: null };
  try {
    const response = await shopifyQuery(store, token, orderQuery, { filter, purchaseFilter });
    if (!response.ok) return unknown;
    const result = await response.json();
    const purchases = result.data?.purchases?.precision === "EXACT" ? count(result.data.purchases.count) : null;
    const orders = result.data?.orders?.nodes;
    if (!Array.isArray(orders)) return { activity: "unknown", purchases };
    if (!orders.length) return { activity: "inactive", purchases };
    const order = orders[0];
    const processed = Date.parse(order?.processedAt);
    if (order?.test !== false || order.cancelledAt !== null || !Number.isFinite(processed)) return { activity: "unknown", purchases };
    return { activity: processed >= since.getTime() && processed <= now.getTime() ? "active" : "inactive", purchases };
  } catch {
    return unknown;
  }
}

async function read(store: Store): Promise<Snapshot> {
  try {
    const token = await resolveShopifyToken(store);
    const [sessions, { activity, purchases }] = await Promise.all([readSessions(store, token), readRecentSales(store, token)]);
    if (purchases === null) return { reading: sessions, activity };
    // A checkout can already have an order while the sessions report is catching up.
    const reading: LiveReading = sessions.status === "ok"
      ? { ...sessions, purchases: Math.max(sessions.purchases, purchases) }
      : { status: "orders", purchases, readAt: new Date().toISOString() };
    return { reading, activity };
  } catch {
    return { reading: { status: "unavailable" }, activity: "unknown" };
  }
}

/** Share simultaneous requests. Opening or resuming after a completed read needs fresh data. */
export function readLiveSnapshot(store: Store): Promise<Snapshot> {
  const key = `${store.id}:${store.updated_at}`;
  const pending = inFlight.get(key);
  if (pending) return pending;
  const snapshot = read(store).finally(() => { inFlight.delete(key); });
  inFlight.set(key, snapshot);
  return snapshot;
}
