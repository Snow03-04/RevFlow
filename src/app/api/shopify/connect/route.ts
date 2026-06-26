import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { normalizeShopDomain, buildInstallUrl } from "@/lib/shopify/oauth";
import { randomState } from "@/lib/crypto";
import { clientEnv } from "@/lib/env";

/**
 * Kicks off Shopify OAuth. The authenticated merchant provides their
 * `shop` domain; we set a CSRF state cookie and redirect to Shopify.
 */
export async function GET(request: NextRequest) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.redirect(`${clientEnv.appUrl}/login`);
  }

  const shopParam = request.nextUrl.searchParams.get("shop") ?? "";
  const shop = normalizeShopDomain(shopParam);
  if (!shop) {
    return NextResponse.redirect(
      `${clientEnv.appUrl}/connections?error=invalid_shop`,
    );
  }

  const state = randomState();
  const cookieStore = await cookies();
  cookieStore.set("shopify_oauth_state", `${state}:${shop}`, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildInstallUrl(shop, state));
}
