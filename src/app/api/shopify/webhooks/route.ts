import { NextResponse, type NextRequest } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { verifyWebhookHmac } from "@/lib/shopify/oauth";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { shopifyGet } from "@/lib/shopify/client";
import { upsertOrder, buildVariantCostMap } from "@/lib/shopify/sync";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { ymdInTz } from "@/lib/date";

/**
 * Shopify webhook receiver. Verifies the HMAC against the raw body, then keeps
 * orders + daily metrics live between cron runs.
 *
 * Always responds 200 on a verified request (even if the topic is ignored) so
 * Shopify does not retry; responds 401 only when the signature is invalid.
 */
export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const hmac = request.headers.get("x-shopify-hmac-sha256") ?? "";
  const topic = request.headers.get("x-shopify-topic") ?? "";
  const shopDomain = request.headers.get("x-shopify-shop-domain") ?? "";

  if (!hmac || !verifyWebhookHmac(rawBody, hmac)) {
    return new NextResponse("Invalid HMAC", { status: 401 });
  }

  const admin = createAdminClient();

  // Resolve which user/connection this shop belongs to.
  const { data: conn } = await admin
    .from("shopify_connections")
    .select("*")
    .eq("shop_domain", shopDomain)
    .maybeSingle();
  if (!conn) return NextResponse.json({ ok: true });

  const userId = conn.user_id;

  // Handle uninstall without touching the API.
  if (topic === "app/uninstalled") {
    await admin
      .from("shopify_connections")
      .update({ status: "revoked" })
      .eq("id", conn.id);
    return NextResponse.json({ ok: true });
  }

  let payload: any;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ ok: true });
  }

  const token = await resolveShopifyToken(conn);

  const { data: settings } = await admin
    .from("settings")
    .select("timezone")
    .eq("user_id", userId)
    .single();
  const tz = settings?.timezone ?? "UTC";

  try {
    let order: any | null = null;

    if (topic.startsWith("orders/")) {
      // The orders/* payload is the full order object.
      order = payload;
    } else if (topic === "refunds/create" && payload.order_id) {
      // Re-fetch the order so totals (incl. the refund) are accurate.
      const { data } = await shopifyGet<{ order: any }>(
        conn.shop_domain,
        token,
        `orders/${payload.order_id}`,
      );
      order = data.order;
    }

    if (order) {
      const costByVariant = await buildVariantCostMap(admin, userId);
      await upsertOrder(
        { supabase: admin, userId, connectionId: conn.id },
        order,
        costByVariant,
      );

      const day = ymdInTz(
        new Date(order.processed_at ?? order.created_at),
        tz,
      );
      await recomputeDailyMetrics(admin, userId, { from: day, to: day });
    }
  } catch {
    // Don't fail the webhook on transient errors; cron reconciles later.
  }

  return NextResponse.json({ ok: true });
}
