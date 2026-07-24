import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { getStoreFxRates } from "@/lib/queries";
import { round2 } from "@/lib/profit";

type DB = SupabaseClient<Database>;

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};

const pad = (n: number): string => String(n).padStart(2, "0");

/**
 * Project the STORED daily_metrics of one month onto the P&L sheet (pnl_days).
 *
 * Pure projection: it only reads what the sync has already computed and writes
 * the sheet — no Shopify/Meta calls, no recompute. That keeps it to a couple of
 * cheap queries, so it can run on the 15-minute cron (and after a background
 * sync) without ever sitting in the path of a page render or a menu click.
 *
 * Adspend FB comes from Meta spend and Adspend Google from Google Ads spend —
 * each split out of `daily_metrics` (which stores them per store per day) and
 * summed onto the day. A day's notes are preserved.
 * Returns how many days were written.
 */
export async function projectPnlMonth(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
): Promise<number> {
  const [{ data: pnlSettings }, { data: mainSettings }] = await Promise.all([
    supabase
      .from("pnl_settings")
      .select("currency")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase.from("settings").select("*").eq("user_id", userId).maybeSingle(),
  ]);

  const targetIso = SYMBOL_TO_ISO[pnlSettings?.currency ?? "€"] ?? "EUR";
  // Per-store rate to the P&L currency — daily_metrics holds each store in its
  // OWN base currency (e.g. Nadel in EUR, Elena Eger in HUF), so each row is
  // converted by ITS store's rate before summing. A single blended rate dropped
  // one store's revenue out of the sheet entirely.
  const storeRates = await getStoreFxRates(
    supabase,
    userId,
    targetIso,
    mainSettings?.fx_rate_override,
  );

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  const [{ data: metrics }, { data: existing }] = await Promise.all([
    supabase
      .from("daily_metrics")
      .select(
        "date, shopify_connection_id, gross_revenue, shipping_revenue, refunds, product_cost, ad_spend_meta, ad_spend_google, orders_count",
      )
      .eq("user_id", userId)
      .gte("date", from)
      .lte("date", to),
    supabase
      .from("pnl_days")
      .select("day, notes")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month),
  ]);

  const exByDay = new Map((existing ?? []).map((d) => [d.day, d]));

  // daily_metrics holds ONE ROW PER STORE PER DAY, so sum them into a single
  // figure per day — the P&L covers the whole business. Skipping this also
  // produced duplicate (user, year, month, day) rows, which made the upsert
  // below fail with "ON CONFLICT DO UPDATE cannot affect row a second time".
  interface DayAgg {
    gross: number;
    shipping: number;
    refunds: number;
    cogs: number;
    adMeta: number;
    adGoogle: number;
    orders: number;
  }
  const byDate = new Map<string, DayAgg>();
  for (const m of metrics ?? []) {
    const rate = storeRates.get(m.shopify_connection_id ?? "") ?? 1;
    const e =
      byDate.get(m.date) ??
      { gross: 0, shipping: 0, refunds: 0, cogs: 0, adMeta: 0, adGoogle: 0, orders: 0 };
    e.gross += Number(m.gross_revenue) * rate;
    e.shipping += Number(m.shipping_revenue) * rate;
    e.refunds += Number(m.refunds) * rate;
    e.cogs += Number(m.product_cost) * rate;
    e.adMeta += Number(m.ad_spend_meta) * rate;
    e.adGoogle += Number(m.ad_spend_google) * rate;
    e.orders += Number(m.orders_count);
    byDate.set(m.date, e);
  }

  const rows = [...byDate].map(([date, e]) => {
    const day = parseInt(date.slice(8, 10), 10);
    const ex = exByDay.get(day);
    return {
      user_id: userId,
      year,
      month,
      day,
      // Already in the P&L currency (converted per store above). Gross Rev
      // INCLUDES shipping the customer paid, so the sheet's Net Rev matches the
      // dashboard revenue (Shopify "Total sales").
      gross_revenue: round2(e.gross + e.shipping),
      refunds: round2(e.refunds),
      cogs: round2(e.cogs),
      // Split by platform: FB = Meta spend, Google = Google Ads spend. Google
      // includes manual "Google …" despesas because recomputeDailyMetrics folds
      // those into ad_spend_google — so both the dashboard and the sheet agree.
      adspend_fb: round2(e.adMeta),
      adspend_google: round2(e.adGoogle),
      orders: e.orders,
      notes: ex?.notes ?? null,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("pnl_days")
      .upsert(rows, { onConflict: "user_id,year,month,day" });
    if (error) throw error;
  }
  return rows.length;
}

/**
 * The month a user's sheet should be keeping fresh right now: the current month
 * in their timezone, but only when it falls inside the sheet's base year.
 * Returns null when there's nothing to refresh (no sheet, or a different year).
 */
export async function currentPnlMonth(
  supabase: DB,
  userId: string,
): Promise<{ year: number; month: number } | null> {
  const [{ data: pnl }, { data: settings }] = await Promise.all([
    supabase
      .from("pnl_settings")
      .select("base_year")
      .eq("user_id", userId)
      .maybeSingle(),
    supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", userId)
      .maybeSingle(),
  ]);
  if (!pnl) return null; // user never opened the P&L sheet

  const ymd = new Date().toLocaleDateString("en-CA", {
    timeZone: settings?.timezone ?? "UTC",
  }); // en-CA gives yyyy-mm-dd
  const year = Number(ymd.slice(0, 4));
  if (year !== pnl.base_year) return null; // sheet is for another year

  return { year, month: Number(ymd.slice(5, 7)) };
}
