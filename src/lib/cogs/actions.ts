"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { resolveFxRate } from "@/lib/queries";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { round2 } from "@/lib/profit";

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

  const costStore =
    storeToDisplay > 0 ? round2(costDisplay / storeToDisplay) : round2(costDisplay);

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
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Falha." };
  }

  revalidatePath("/dashboard");
  revalidatePath("/products");
  revalidatePath("/costs");
  revalidatePath("/pnl");
  return { ok: true };
}
