"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { applyCogsToRoasEntries } from "@/lib/trackers/match";
import { lastNDays, todayYmd } from "@/lib/date";

export interface CogsResult {
  ok: boolean;
  error?: string;
  id?: string; // set by createCollection
}

/** Read the user's display currency once (stored on each cost/tier row). */
async function displayCurrencyOf(
  supabase: Awaited<ReturnType<typeof createClient>>,
  userId: string,
): Promise<string> {
  const { data } = await supabase
    .from("settings")
    .select("currency")
    .eq("user_id", userId)
    .single();
  return data?.currency ?? "USD";
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

/* ------------------------------------------------------------------ */
/* Quantity tiers (per product)                                        */
/* ------------------------------------------------------------------ */

/**
 * Set (or clear) a product's bundle price for a given quantity. `totalCost` is
 * the TOTAL cost of buying `minQty` units together, stored exactly in the
 * display currency. Passing `totalCost == null` removes that tier.
 */
export async function saveProductTier(
  productId: string,
  minQty: number,
  totalCost: number | null,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  if (!Number.isInteger(minQty) || minQty < 2)
    return { ok: false, error: "A quantidade tem de ser 2 ou mais." };
  const supabase = await createClient();

  if (totalCost == null) {
    const { error } = await supabase
      .from("product_cost_tiers")
      .delete()
      .eq("user_id", user.id)
      .eq("shopify_product_id", productId)
      .eq("min_qty", minQty);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const currency = await displayCurrencyOf(supabase, user.id);
  const { error } = await supabase.from("product_cost_tiers").upsert(
    {
      user_id: user.id,
      shopify_product_id: productId,
      min_qty: minQty,
      total_cost: totalCost,
      currency,
    },
    { onConflict: "user_id,shopify_product_id,min_qty" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ------------------------------------------------------------------ */
/* Collections                                                         */
/* ------------------------------------------------------------------ */

export async function createCollection(name: string): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "Dá um nome à coleção." };
  const supabase = await createClient();
  const currency = await displayCurrencyOf(supabase, user.id);
  const { data, error } = await supabase
    .from("cogs_collections")
    .insert({ user_id: user.id, name: clean, currency })
    .select("id")
    .single();
  if (error) return { ok: false, error: error.message };
  return { ok: true, id: data.id };
}

export async function renameCollection(
  collectionId: string,
  name: string,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const clean = name.trim();
  if (!clean) return { ok: false, error: "O nome não pode ficar vazio." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cogs_collections")
    .update({ name: clean })
    .eq("user_id", user.id)
    .eq("id", collectionId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteCollection(
  collectionId: string,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  // Members + tiers cascade via FK.
  const { error } = await supabase
    .from("cogs_collections")
    .delete()
    .eq("user_id", user.id)
    .eq("id", collectionId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** The per-unit cost applied to every member (overrides individual costs). */
export async function saveCollectionBaseCost(
  collectionId: string,
  baseUnitCost: number,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const currency = await displayCurrencyOf(supabase, user.id);
  const { error } = await supabase
    .from("cogs_collections")
    .update({ base_unit_cost: baseUnitCost, currency })
    .eq("user_id", user.id)
    .eq("id", collectionId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Add a product to a collection (a product belongs to at most one). */
export async function addProductToCollection(
  collectionId: string,
  productId: string,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase.from("cogs_collection_products").upsert(
    {
      user_id: user.id,
      collection_id: collectionId,
      shopify_product_id: productId,
    },
    { onConflict: "user_id,shopify_product_id" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function removeProductFromCollection(
  productId: string,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("cogs_collection_products")
    .delete()
    .eq("user_id", user.id)
    .eq("shopify_product_id", productId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Set (or clear) a collection's bundle price for a combined quantity. */
export async function saveCollectionTier(
  collectionId: string,
  minQty: number,
  totalCost: number | null,
): Promise<CogsResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  if (!Number.isInteger(minQty) || minQty < 2)
    return { ok: false, error: "A quantidade tem de ser 2 ou mais." };
  const supabase = await createClient();

  if (totalCost == null) {
    const { error } = await supabase
      .from("cogs_collection_tiers")
      .delete()
      .eq("user_id", user.id)
      .eq("collection_id", collectionId)
      .eq("min_qty", minQty);
    return error ? { ok: false, error: error.message } : { ok: true };
  }

  const currency = await displayCurrencyOf(supabase, user.id);
  const { error } = await supabase.from("cogs_collection_tiers").upsert(
    {
      user_id: user.id,
      collection_id: collectionId,
      min_qty: minQty,
      total_cost: totalCost,
      currency,
    },
    { onConflict: "collection_id,min_qty" },
  );
  return error ? { ok: false, error: error.message } : { ok: true };
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
