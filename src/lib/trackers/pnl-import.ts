import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables, TablesInsert } from "@/types/database";
import { getStoreFxRates } from "@/lib/queries";
import { projectPnlDays } from "./pnl-projection";

import { selectAllByUser } from "@/lib/supabase/paginate";

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
  opts: { costsOnly?: boolean; salesOnly?: boolean } = {},
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
  // OWN base currency (e.g. store A in EUR, store B in HUF), so each row is
  // converted by ITS store's rate before summing. A single blended rate dropped
  // one store's revenue out of the sheet entirely.
  const storeRates = await getStoreFxRates(
    supabase,
    userId,
    targetIso,
    mainSettings?.fx_rate_override,
    true,
    mainSettings?.currency,
  );

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  const [metrics, existing] = await Promise.all([
    selectAllByUser<Tables<"daily_metrics">>(
      supabase,
      "daily_metrics",
      "date,shopify_connection_id,gross_revenue,shipping_revenue,refunds,product_cost,payment_fees,payment_adjustment,ad_spend_meta,ad_spend_google,orders_count",
      userId,
      (q) => q.gte("date", from).lte("date", to),
    ),
    selectAllByUser<Tables<"pnl_days">>(
      supabase,
      "pnl_days",
      "day,notes",
      userId,
      (q) => q.eq("year", year).eq("month", month),
    ),
  ]);

  const exByDay = new Map((existing ?? []).map((d) => [d.day, d]));

  // One shared projection keeps each store and the consolidated sheet aligned.
  const rows = projectPnlDays(metrics, storeRates).map((row) => ({ ...row,
    user_id: userId, notes: exByDay.get(row.day)?.notes ?? null,
  }));

  if (opts.costsOnly || opts.salesOnly) {
    const updates = rows
      .filter((r) => exByDay.has(r.day))
      .map(
        ({
          user_id,
          year,
          month,
          day,
          cogs, payment_fees, payment_adjustment,
          gross_revenue,
          refunds,
          orders,
        }) => ({
          user_id,
          year,
          month,
          day,
          cogs, payment_fees, payment_adjustment,
          ...(opts.salesOnly ? { gross_revenue, refunds, orders } : {}),
        }),
      );
    const created = rows.filter((r) => !exByDay.has(r.day));
    for (const batch of [updates, created])
      if (batch.length) {
        const { error } = await supabase
          .from("pnl_days")
          .upsert(batch as TablesInsert<"pnl_days">[], { onConflict: "user_id,year,month,day" });
        if (error) throw error;
      }
  } else if (rows.length) {
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
