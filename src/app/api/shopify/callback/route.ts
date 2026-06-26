import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  verifyOAuthHmac,
  exchangeCodeForToken,
  normalizeShopDomain,
} from "@/lib/shopify/oauth";
import { registerShopifyWebhooks } from "@/lib/shopify/webhooks";
import { encryptToken } from "@/lib/crypto";
import { initialShopifyImport } from "@/lib/jobs";
import { clientEnv } from "@/lib/env";

// Allow time for the initial historical import on Vercel.
export const maxDuration = 60;

function fail(reason: string) {
  return NextResponse.redirect(
    `${clientEnv.appUrl}/connections?error=${reason}`,
  );
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${clientEnv.appUrl}/login`);

  // 1. CSRF state check.
  const cookieStore = await cookies();
  const stored = cookieStore.get("shopify_oauth_state")?.value ?? "";
  cookieStore.delete("shopify_oauth_state");
  const [storedState, storedShop] = stored.split(":");
  if (!storedState || storedState !== params.get("state")) {
    return fail("state_mismatch");
  }

  // 2. Verify HMAC + shop.
  if (!verifyOAuthHmac(params)) return fail("bad_hmac");
  const shop = normalizeShopDomain(params.get("shop") ?? "");
  const code = params.get("code");
  if (!shop || shop !== storedShop || !code) return fail("invalid_request");

  try {
    // 3. Exchange code -> permanent access token.
    const { access_token, scope } = await exchangeCodeForToken(shop, code);

    // 4. Register webhooks (best-effort).
    const webhookIds = await registerShopifyWebhooks(shop, access_token);

    // 5. Persist the connection with the token encrypted at rest.
    const admin = createAdminClient();
    const { data: conn, error } = await admin
      .from("shopify_connections")
      .upsert(
        {
          user_id: user.id,
          shop_domain: shop,
          access_token: encryptToken(access_token),
          scope,
          status: "active",
          webhook_ids: webhookIds,
          last_sync_error: null,
        },
        { onConflict: "user_id,shop_domain" },
      )
      .select("*")
      .single();
    if (error || !conn) throw error ?? new Error("Failed to save connection");

    // 6. Kick off the initial historical import.
    try {
      await initialShopifyImport(admin, conn);
    } catch {
      // Surface but don't block the redirect; cron will retry.
    }

    return NextResponse.redirect(
      `${clientEnv.appUrl}/connections?shopify=connected`,
    );
  } catch {
    return fail("connection_failed");
  }
}
