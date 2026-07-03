"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { applyCogsToRoasEntries } from "@/lib/trackers/match";
import { lastNDays, todayYmd } from "@/lib/date";

export interface CogsResult {
  ok: boolean;
  error?: string;
}

/**
 * Set a product's cost, effective from a given date. The value is stored
 * EXACTLY as entered, in the display currency (so "12.7" stays 12.70 instead of
 * round-tripping through the store's base currency), tagged with that currency.
 *
 * Costs are effective-dated: each order later uses the cost that was in effect
 * on its own date, so setting a new cost never rewrites past profit. Editing
 * the inline field targets today's entry; `effectiveFrom` lets the history
 * panel set costs for other dates.
 *
 * Passing `costDisplay == null` clears the entry for that effective date (or,
 * if none is given, all manual costs for the product).
 */
export async function saveProductCost(
  productId: string,
  costDisplay: number | null,
  effectiveFrom?: string,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("currency, timezone")
    .eq("user_id", user.id)
    .single();
  const displayCurrency = settings?.currency ?? "USD";
  const from = effectiveFrom ?? todayYmd(settings?.timezone ?? "UTC");

  if (costDisplay == null) {
    let del = supabase
      .from("product_costs")
      .delete()
      .eq("user_id", user.id)
      .eq("shopify_product_id", productId);
    // With an explicit date, clear only that dated entry; otherwise all of them.
    if (effectiveFrom) del = del.eq("effective_from", effectiveFrom);
    const { error } = await del;
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const { error } = await supabase.from("product_costs").upsert(
    {
      user_id: user.id,
      shopify_product_id: productId,
      cost: costDisplay, // stored exactly, in the display currency
      currency: displayCurrency,
      effective_from: from,
    },
    { onConflict: "user_id,shopify_product_id,effective_from" },
  );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/** Remove one dated cost entry (from the history panel). */
export async function deleteProductCostEntry(
  productId: string,
  effectiveFrom: string,
): Promise<CogsResult> {
  return saveProductCost(productId, null, effectiveFrom);
}

/**
 * Recompute the trailing 90 days of daily metrics so cost edits flow through
 * to the dashboard, P&L and product/ads tables.
 */
export async function recomputeAllMetricsAction(): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("timezone")
    .eq("user_id", user.id)
    .single();
  const tz = settings?.timezone ?? "UTC";

  try {
    await recomputeDailyMetrics(supabase, user.id, lastNDays(90, tz));
    // Flow the new per-product costs into the Daily ROAS tracker too.
    await applyCogsToRoasEntries(supabase, user.id);
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/products");
  revalidatePath("/costs");
  revalidatePath("/pnl");
  revalidatePath("/roas");
  return { ok: true };
}
