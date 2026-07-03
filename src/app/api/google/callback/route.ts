import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { exchangeCodeForTokens } from "@/lib/google/oauth";
import {
  listAccessibleCustomers,
  getCustomerInfo,
  listClientAccounts,
} from "@/lib/google/client";
import { encryptToken } from "@/lib/crypto";
import { initialGoogleImport } from "@/lib/jobs";
import { clientEnv } from "@/lib/env";

export const maxDuration = 60;

function fail(reason: string) {
  return NextResponse.redirect(`${clientEnv.appUrl}/connections?error=${reason}`);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;

  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${clientEnv.appUrl}/login`);

  if (params.get("error")) return fail("google_denied");

  // CSRF state check.
  const cookieStore = await cookies();
  const stored = cookieStore.get("google_oauth_state")?.value ?? "";
  cookieStore.delete("google_oauth_state");
  if (!stored || stored !== params.get("state")) return fail("state_mismatch");

  const code = params.get("code");
  if (!code) return fail("invalid_request");

  try {
    const tokens = await exchangeCodeForTokens(code);
    // The refresh token is only returned with `prompt=consent`; without it we
    // can't sync later without re-auth.
    if (!tokens.refresh_token) return fail("google_no_refresh");

    const accessible = await listAccessibleCustomers(tokens.access_token);
    if (accessible.length === 0) return fail("no_google_customers");

    // Expand the hierarchy: a standalone account maps to itself; a manager
    // (MCC) maps to each of its non-manager client accounts (login-customer-id
    // = the manager). This is what makes it work for any user's account layout.
    type Target = {
      customerId: string;
      loginCustomerId: string | null;
      name: string | null;
      currency: string | null;
    };
    const targets: Target[] = [];
    for (const c of accessible) {
      const info = await getCustomerInfo(c, tokens.access_token);
      if (info.isManager) {
        for (const cl of await listClientAccounts(c, tokens.access_token)) {
          targets.push({
            customerId: cl.id,
            loginCustomerId: c,
            name: cl.name,
            currency: cl.currency,
          });
        }
      } else {
        targets.push({
          customerId: c,
          loginCustomerId: null,
          name: info.name,
          currency: info.currency,
        });
      }
    }
    // Dedupe (a client can be visible through more than one manager).
    const seen = new Set<string>();
    const unique = targets.filter(
      (t) => !seen.has(t.customerId) && seen.add(t.customerId),
    );
    if (unique.length === 0) return fail("no_google_customers");

    const admin = createAdminClient();
    const encrypted = encryptToken(tokens.refresh_token);

    const conns = [];
    for (const t of unique) {
      const { data, error } = await admin
        .from("google_connections")
        .upsert(
          {
            user_id: user.id,
            access_token: encrypted,
            customer_id: t.customerId,
            customer_name: t.name,
            account_currency: t.currency,
            login_customer_id: t.loginCustomerId,
            status: "active",
            last_sync_error: null,
          },
          { onConflict: "user_id,customer_id" },
        )
        .select("*")
        .single();
      if (!error && data) conns.push(data);
    }

    // Initial historical import per account (best-effort; manager accounts with
    // no campaigns simply record a sync note).
    for (const conn of conns) {
      try {
        await initialGoogleImport(admin, conn);
      } catch {
        // cron will retry
      }
    }

    return NextResponse.redirect(`${clientEnv.appUrl}/connections?google=connected`);
  } catch {
    return fail("connection_failed");
  }
}
