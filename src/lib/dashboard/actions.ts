"use server";

import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getRangeComparison,
  getStoreCurrency,
} from "@/lib/queries";
import { resolveFx } from "@/lib/fx";
import { dashboardRanges } from "@/lib/date";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { fetchShopifySessions } from "@/lib/shopify/analytics";

export interface WinStats {
  revenue: number;
  orders: number;
  sessions: number;
  sessionsEstimated: boolean; // true = derived from orders (no analytics access)
  currency: string;
  rangeLabel: string;
}

// Fallback only: used when real Shopify session analytics access isn't granted.
// We estimate sessions from orders at the store's conversion rate. Tuned to this
// store's real rate (≈150 orders ÷ 10 404 sessions ≈ 1.44%) so the estimate
// lands close to reality until ShopifyQL sessions are unlocked.
const ASSUMED_CONVERSION_RATE = 0.0144;

/**
 * Stats for the shareable "win" card, for the current dashboard period. Fetched
 * lazily when the modal opens so the dashboard shell stays fast.
 */
export async function getShareWinStats(
  period: string,
  from?: string,
  to?: string,
): Promise<WinStats | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const storeCurrency = await getStoreCurrency(supabase, user.id);
  const fxRate = await resolveFx(storeCurrency, currency, {
    storeCurrency,
    displayCurrency: currency,
    override: settings?.fx_rate_override,
  });

  const { current, previous } = dashboardRanges(period, tz, from, to);
  const comparison = await getRangeComparison(
    supabase,
    user.id,
    current,
    previous,
    fxRate,
  );

  const orders = Number(comparison.current.ordersCount);
  const revenue = Number(comparison.current.revenue);

  // Real, bot-filtered Shopify sessions when analytics access is granted;
  // otherwise fall back to an estimate so the card always shows something.
  let sessions = orders > 0 ? Math.round(orders / ASSUMED_CONVERSION_RATE) : 0;
  let sessionsEstimated = true;
  const { data: conn } = await supabase
    .from("shopify_connections")
    .select("shop_domain, access_token, status, auth_type, client_id")
    .eq("user_id", user.id)
    .eq("status", "active")
    .maybeSingle();
  if (conn?.access_token) {
    try {
      const real = await fetchShopifySessions(
        conn.shop_domain,
        await resolveShopifyToken(conn),
        current.from,
        current.to,
      );
      if (real != null) {
        sessions = real;
        sessionsEstimated = false;
      }
    } catch {
      /* keep the estimate */
    }
  }

  const rangeLabel =
    current.from === current.to
      ? current.from
      : `${current.from} → ${current.to}`;

  return { revenue, orders, sessions, sessionsEstimated, currency, rangeLabel };
}
