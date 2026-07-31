import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  exchangeCodeForToken,
  exchangeForLongLivedToken,
  fetchAdAccounts,
} from "@/lib/meta/oauth";
import { encryptToken } from "@/lib/crypto";
import { initialMetaImport, autoMapAdAccountsToSoleStore } from "@/lib/jobs";
import { clientEnv } from "@/lib/env";

export const maxDuration = 60;

function fail(reason: string, detail?: string) {
  const qs = new URLSearchParams({ error: reason });
  // A short, non-sensitive reason (HTTP status / Graph message) so a merchant can
  // see WHY a specific person failed instead of a blank "connection_failed".
  if (detail) qs.set("detail", detail.slice(0, 300));
  return NextResponse.redirect(`${clientEnv.appUrl}/connections?${qs}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${clientEnv.appUrl}/login`);

  // Meta may return an error (user denied, app in Dev mode, scope not approved,
  // etc.). Surface Meta's own description so the merchant can tell these apart.
  if (params.get("error")) {
    const desc =
      params.get("error_description") ??
      params.get("error_reason") ??
      params.get("error");
    return fail("meta_denied", desc ?? undefined);
  }

  // CSRF state check.
  const cookieStore = await cookies();
  const stored = cookieStore.get("meta_oauth_state")?.value ?? "";
  cookieStore.delete("meta_oauth_state");
  if (!stored || stored !== params.get("state")) return fail("state_mismatch");

  const code = params.get("code");
  if (!code) return fail("invalid_request");

  try {
    // Short-lived -> long-lived token.
    const short = await exchangeCodeForToken(code);
    const long = await exchangeForLongLivedToken(short.access_token);
    const expiresAt = long.expires_in
      ? new Date(Date.now() + long.expires_in * 1000).toISOString()
      : null;

    const accounts = await fetchAdAccounts(long.access_token);
    if (accounts.length === 0) return fail("no_ad_accounts");

    const admin = createAdminClient();
    const encrypted = encryptToken(long.access_token);

    // Persist one connection per ad account (same token).
    const { data: conns, error } = await admin
      .from("meta_connections")
      .upsert(
        accounts.map((a) => ({
          user_id: user.id,
          access_token: encrypted,
          ad_account_id: a.id, // act_XXXX
          ad_account_name: a.name,
          business_id: a.business?.id ?? null,
          account_currency: a.currency ?? null,
          token_expires_at: expiresAt,
          status: "active",
          last_sync_error: null,
        })),
        { onConflict: "user_id,ad_account_id" },
      )
      .select("*");
    if (error) throw error;

    // Attribute new accounts to the store before importing, so the import's
    // recompute credits the right store (no-op for multi-store users).
    await autoMapAdAccountsToSoleStore(admin, user.id);

    // Initial historical import for each account (best-effort).
    for (const conn of conns ?? []) {
      try {
        await initialMetaImport(admin, conn);
      } catch {
        // cron will retry
      }
    }

    return NextResponse.redirect(
      `${clientEnv.appUrl}/connections?meta=connected`,
    );
  } catch (e) {
    // Log server-side and pass a short reason to the page — token exchange vs
    // ad-account fetch failures now read differently ("...failed: 400/403") so a
    // per-person failure is diagnosable instead of a blank error.
    const detail = e instanceof Error ? e.message : String(e);
    console.error("Meta OAuth callback failed:", detail);
    return fail("connection_failed", detail);
  }
}
