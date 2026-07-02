"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { resolveFxRate } from "@/lib/queries";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { applyCogsToRoasEntries } from "@/lib/trackers/match";
import { lastNDays } from "@/lib/date";

export interface CogsResult {
  ok: boolean;
  error?: string;
}

/**
 * Set a product's cost (entered in the display currency, e.g. EUR). Applies to
 * ALL variants of the product, and is stored in the store's base currency so
 * it lines up with the rest of the pipeline.
 */
export async function saveProductCost(
  productId: string,
  costDisplay: number | null,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("settings")
    .select("currency")
    .eq("user_id", user.id)
    .single();
  const displayCurrency = settings?.currency ?? "USD";
  const storeToDisplay = await resolveFxRate(supabase, user.id, displayCurrency);

  // Clearing the cost removes the manual override (falls back to Shopify/%).
  if (costDisplay == null) {
    const { error } = await supabase
      .from("product_costs")
      .delete()
      .eq("user_id", user.id)
      .eq("shopify_product_id", productId);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  // Store in the store's base currency to line up with the rest of the
  // pipeline (metrics.ts, queries.ts all operate in base currency and convert
  // to the display currency only at the presentation boundary). Don't round
  // here — rounding both on write and on read-back is what made a typed 12.7
  // come back as 12.69. When display == base (the common case) storeToDisplay
  // is 1 and this is an exact identity.
  const costStore =
    storeToDisplay > 0 ? costDisplay / storeToDisplay : costDisplay;

  const { error } = await supabase
    .from("product_costs")
    .upsert(
      { user_id: user.id, shopify_product_id: productId, cost: costStore },
      { onConflict: "user_id,shopify_product_id" },
    );

  if (error) return { ok: false, error: error.message };
  return { ok: true };
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
