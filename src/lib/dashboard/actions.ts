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

  // Independent reads together instead of one after another. `.limit(1)` (not
  // `.maybeSingle()`) because a multi-store account has several active
  // connections — maybeSingle errors on >1 row and silently killed the real
  // session count.
  const [settings, storeCurrency, { data: conns }] = await Promise.all([
    getSettings(supabase, user.id),
    getStoreCurrency(supabase, user.id),
    supabase
      .from("shopify_connections")
      .select("shop_domain, access_token, auth_type, client_id")
      .eq("user_id", user.id)
      .eq("status", "active")
      .order("created_at", { ascending: true })
      .limit(1),
  ]);
  const currency = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";
  const conn = conns?.[0];
  const fxRate = await resolveFx(storeCurrency, currency, {
    storeCurrency,
    displayCurrency: currency,
    override: settings?.fx_rate_override,
  });

  const { current, previous } = dashboardRanges(period, tz, from, to);

  /** Real, bot-filtered Shopify sessions — best-effort, never blocking. */
  async function realSessions(): Promise<number | null> {
    if (!conn?.access_token) return null;
    try {
      return await fetchShopifySessions(
        conn.shop_domain,
        await resolveShopifyToken(conn),
        current.from,
        current.to,
      );
    } catch {
      return null; // keep the estimate
    }
  }

  // The metrics read and the (slow) analytics call run CONCURRENTLY — the card
  // used to wait for ShopifyQL only after everything else had finished.
  const [comparison, real] = await Promise.all([
    getRangeComparison(supabase, user.id, current, previous, fxRate),
    realSessions(),
  ]);

  const orders = Number(comparison.current.ordersCount);
  const revenue = Number(comparison.current.revenue);

  // Fall back to an estimate so the card always shows something.
  const sessionsEstimated = real == null;
  const sessions = sessionsEstimated
    ? orders > 0
      ? Math.round(orders / ASSUMED_CONVERSION_RATE)
      : 0
    : real!;

  const rangeLabel =
    current.from === current.to
      ? current.from
      : `${current.from} → ${current.to}`;

  return { revenue, orders, sessions, sessionsEstimated, currency, rangeLabel };
}
