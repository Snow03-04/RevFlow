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
const orderQuery = "query RecentSale($filter: String!) { orders(first: 1, reverse: true, sortKey: PROCESSED_AT, query: $filter) { nodes { processedAt test cancelledAt } } }";

type Store = ShopifyConnAuth & { id: string; updated_at: string };
type Snapshot = { reading: LiveReading; activity: StoreActivity };
const recent = new Map<string, { expires: number; snapshot: Promise<Snapshot> }>();

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

async function readRecentSales(store: Store, token: string): Promise<StoreActivity> {
  const now = new Date();
  const since = new Date(now.getTime() - 72 * 60 * 60_000);
  const filter = `test:false -status:cancelled processed_at:>='${since.toISOString()}' processed_at:<='${now.toISOString()}'`;
  try {
    const response = await shopifyQuery(store, token, orderQuery, { filter });
    if (!response.ok) return "unknown";
    const result = await response.json();
    const orders = result.data?.orders?.nodes;
    if (result.errors?.length || !Array.isArray(orders)) return "unknown";
    if (!orders.length) return "inactive";
    const order = orders[0];
    const processed = Date.parse(order?.processedAt);
    if (order?.test !== false || order.cancelledAt !== null || !Number.isFinite(processed)) return "unknown";
    return processed >= since.getTime() && processed <= now.getTime() ? "active" : "inactive";
  } catch {
    return "unknown";
  }
}

async function read(store: Store): Promise<Snapshot> {
  try {
    const token = await resolveShopifyToken(store);
    const [reading, activity] = await Promise.all([readSessions(store, token), readRecentSales(store, token)]);
    return { reading, activity };
  } catch {
    return { reading: { status: "unavailable" }, activity: "unknown" };
  }
}

/** Concurrent viewers of one connection share a short-lived, server-only reading. */
export function readLiveSnapshot(store: Store): Promise<Snapshot> {
  const now = Date.now();
  const key = `${store.id}:${store.updated_at}`;
  const cached = recent.get(key);
  if (cached && cached.expires > now) return cached.snapshot;
  for (const [id, value] of recent) if (value.expires <= now) recent.delete(id);
  const snapshot = read(store);
  recent.set(key, { snapshot, expires: now + 25_000 });
  return snapshot;
}
