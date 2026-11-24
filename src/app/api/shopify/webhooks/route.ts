import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookHmac } from "@/lib/shopify/oauth";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { shopifyGet } from "@/lib/shopify/client";
import { decryptToken } from "@/lib/crypto";
import { serverEnv } from "@/lib/env";
import { buildVariantCostMap, mapOrder, upsertOrder } from "@/lib/shopify/sync";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { ymdInTz } from "@/lib/date";
import { broadcastLive } from "@/lib/live/realtime";
import { displayRate, globeOrderFromShopify } from "@/lib/live/globe";
import type { Tables } from "@/types/database";

export const dynamic = "force-dynamic";

type Connection = Tables<"shopify_connections">;
type Admin = ReturnType<typeof createAdminClient>;
type Settings = Pick<Tables<"settings">, "currency" | "timezone" | "fx_rate_override" | "fx_override_currency">;

const customApp = (conn: Pick<Connection, "auth_type" | "client_id">) => conn.auth_type === "client_credentials" && !!conn.client_id;

/** The secret that signs a store's webhooks: its own custom app's, or the
 * shared OAuth app's. Null when it cannot be read (never verifies). */
function webhookSecret(conn: Pick<Connection, "auth_type" | "client_id" | "access_token">): string | null {
  try {
    return customApp(conn) ? decryptToken(conn.access_token) : serverEnv.shopify.apiSecret;
  } catch {
    return null;
  }
}

const variantIds = (order: any): string[] => (order.line_items ?? []).flatMap((line: { variant_id?: number | string | null }) =>
  line.variant_id == null ? [] : [String(line.variant_id)]);

/**
 * A store connected through its own custom app: store the order from the
 * delivery itself. A webhook carries the same order document the import reads,
 * so nothing is fetched from Shopify and the sale is readable within a second.
 *
 * Totals (daily metrics, COGS, payment ledgers) are NOT recalculated here: the
 * next refresh sees a row newer than its checkpoint and repairs that day.
 * Recalculating per sale would spend seconds of function time on every order
 * of every account.
 */
async function storeFromDelivery(db: Admin, conn: Connection, topic: string, order: any): Promise<"stored" | "unchanged"> {
  // A part-paid order is booked from Shopify's payment breakdown, which only
  // the import reads. It is still announced; the import stores its amounts.
  if (order.financial_status === "partially_paid") return "stored";
  if (topic === "orders/updated") {
    // Most updates are a fulfilment, a tag or a note. Only one that changes
    // what the sale is worth is stored (and announced): one small read decides.
    const next = mapOrder(conn.user_id, conn.id, order);
    const { data: stored, error } = await db.from("orders").select("total_price,total_refunded,financial_status,cancelled_at")
      .eq("user_id", conn.user_id).eq("shopify_order_id", next.shopify_order_id).maybeSingle();
    if (error) throw error;
    if (stored && Number(stored.total_price) === next.total_price && Number(stored.total_refunded) === next.total_refunded
      && stored.financial_status === next.financial_status && !stored.cancelled_at === !next.cancelled_at) return "unchanged";
  }
  const costs = await buildVariantCostMap(db, conn.user_id, variantIds(order));
  await upsertOrder({ supabase: db, userId: conn.user_id, connectionId: conn.id }, order, costs);
  return "stored";
}

/** A store on the shared OAuth app, as before: store the order (re-read after a
 * refund) and recalculate its day. Returns the order that was stored. */
async function storeAndRecalculate(db: Admin, conn: Connection, topic: string, payload: any, timeZone: string): Promise<any | null> {
  const token = await resolveShopifyToken(conn);
  let order: any | null = null;
  if (topic.startsWith("orders/")) order = payload;
  else if (topic === "refunds/create" && payload.order_id) {
    // Re-fetch the order so totals (incl. the refund) are accurate.
    order = (await shopifyGet<{ order: any }>(conn.shop_domain, token, `orders/${payload.order_id}`)).data.order;
  }
  if (!order?.id) return null;
  const costs = await buildVariantCostMap(db, conn.user_id, variantIds(order));
  await upsertOrder({ supabase: db, userId: conn.user_id, connectionId: conn.id, shop: conn.shop_domain, token }, order, costs);
  const day = ymdInTz(new Date(order.processed_at ?? order.created_at), timeZone);
  await recomputeDailyMetrics(db, conn.user_id, { from: day, to: day });
  return order;
}

/** Tell the account's open live views. A Shopify test order lands on the globe
 * as a rehearsal: shown, never counted. An update re-sends the order so a
 * post-purchase upsell raises the amount already on screen. */
async function announce(conn: Connection, topic: string, order: any, settings: Settings | null): Promise<void> {
  if (topic === "orders/cancelled" || (topic === "orders/updated" && order.cancelled_at)) {
    if (!order.test) await broadcastLive(conn.user_id, "cancel", { id: `${conn.id}:${order.id}` });
  } else if (topic === "orders/create" || (topic === "orders/updated" && !order.test)) {
    const rate = settings ? await displayRate(settings, order.currency ?? conn.reporting_base_currency) : 1;
    await broadcastLive(conn.user_id, topic === "orders/create" ? "order" : "update", {
      ...globeOrderFromShopify(conn.id, order, rate, conn.reporting_base_currency), ...(order.test ? { test: true } : {}),
    });
  }
}

/**
 * Shopify webhook receiver. Verifies the HMAC against the raw body, stores the
 * order straight away and pushes it to the account's live views, so a sale is
 * visible the moment it happens instead of at the next scheduled import.
 *
 * Responds 200 to every verified delivery (even an ignored topic) so Shopify
 * does not retry, 401 only when no connected store's secret signs it, and 503
 * when a custom-app order could not be stored, so Shopify delivers it again.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopDomain = (request.headers.get("x-shopify-shop-domain") ?? "").trim().toLowerCase();
  if (!hmac) return new NextResponse("Invalid HMAC", { status: 401 });

  // The same shop can be connected by several accounts, each through its own
  // app. A delivery belongs to every connection whose secret signed it.
  const admin = createAdminClient();
  const { data: connections, error } = shopDomain
    ? await admin.from("shopify_connections").select("*").eq("shop_domain", shopDomain)
    : { data: [], error: null };
  // Let Shopify deliver again rather than lose a sale to a passing outage.
  if (error) return new NextResponse("Unavailable", { status: 503 });
  const verified = (connections ?? []).filter((conn) => {
    const secret = webhookSecret(conn);
    return secret != null && verifyWebhookHmac(rawBody, hmac, secret);
  });
  if (!verified.length) {
    // Signed by the shared app for a shop that is not (or no longer) connected.
    let shared = false;
    try { shared = verifyWebhookHmac(rawBody, hmac); } catch { /* The shared app is not configured here. */ }
    return shared ? NextResponse.json({ ok: true }) : new NextResponse("Invalid HMAC", { status: 401 });
  }

  if (topic === "app/uninstalled") {
    await admin.from("shopify_connections").update({ status: "revoked" }).in("id", verified.map((conn) => conn.id));
    return NextResponse.json({ ok: true });
  }

  let payload: any = null;
  try { payload = JSON.parse(rawBody); } catch { /* Not a JSON document: nothing to store. */ }
  if (!payload || typeof payload !== "object") return NextResponse.json({ ok: true });

  let failed = false;
  await Promise.all(verified.filter((conn) => conn.status === "active" || conn.status === "error").map(async (conn) => {
    const { data: settings } = await admin.from("settings").select("currency,timezone,fx_rate_override,fx_override_currency")
      .eq("user_id", conn.user_id).maybeSingle();
    let order: any | null = null;
    if (customApp(conn)) {
      // `refunds/create` carries the refund, not the order: the import books it.
      if (!topic.startsWith("orders/") || !payload.id) return;
      try {
        if (await storeFromDelivery(admin, conn, topic, payload) === "stored") order = payload;
      } catch {
        console.warn("Shopify webhook: order was not stored");
        failed = true;
        return;
      }
    } else {
      try {
        order = await storeAndRecalculate(admin, conn, topic, payload, settings?.timezone ?? "UTC");
      } catch {
        // Don't fail the webhook on transient errors; the import reconciles later.
        order = topic.startsWith("orders/") && payload.id ? payload : null;
      }
    }
    if (order) await announce(conn, topic, order, settings ?? null);
  }));

  return failed ? new NextResponse("Unavailable", { status: 503 }) : NextResponse.json({ ok: true });
}
