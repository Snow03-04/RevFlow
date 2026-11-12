import "server-only";
import { resolveShopifyToken, type ShopifyConnAuth } from "./auth";
import type { LiveReading } from "@/types/live";

const metrics = [
  "sessions_with_cart_additions",
  "sessions_that_reached_checkout",
  "sessions_that_completed_checkout",
] as const;
const report = `FROM sessions SHOW ${metrics.join(", ")} SINCE -10min UNTIL now`;
const query = "query LiveActivity($report: String!) { shopifyqlQuery(query: $report) { parseErrors tableData { rows } } }";

type Store = ShopifyConnAuth & { id: string; updated_at: string };
const recent = new Map<string, { expires: number; reading: Promise<LiveReading> }>();

function count(value: unknown) {
  if (typeof value !== "number" && !(typeof value === "string" && /^\d+$/.test(value))) return null;
  const n = Number(value);
  return Number.isSafeInteger(n) && n >= 0 ? n : null;
}

async function read(store: Store): Promise<LiveReading> {
  try {
    const token = await resolveShopifyToken(store);
    const response = await fetch(`https://${store.shop_domain}/admin/api/2026-10/graphql.json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
      body: JSON.stringify({ query, variables: { report } }),
      signal: AbortSignal.timeout(8_000),
      cache: "no-store",
    });
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

/** Concurrent viewers of one connection share a short-lived, server-only reading. */
export function readLiveActivity(store: Store): Promise<LiveReading> {
  const now = Date.now();
  const key = `${store.id}:${store.updated_at}`;
  const cached = recent.get(key);
  if (cached && cached.expires > now) return cached.reading;
  for (const [id, value] of recent) if (value.expires <= now) recent.delete(id);
  const reading = read(store);
  recent.set(key, { reading, expires: now + 25_000 });
  return reading;
}
