"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { lastNDays } from "@/lib/date";
import { encryptToken } from "@/lib/crypto";

export interface SettingsState {
  ok?: boolean;
  error?: string;
}

const schema = z.object({
  currency: z.string().min(3).max(3),
  timezone: z.string().min(1),
  default_product_cost_pct: z.coerce.number().min(0).max(100),
  default_shipping_cost: z.coerce.number().min(0),
  payment_fee_pct: z.coerce.number().min(0).max(100),
  payment_fee_fixed: z.coerce.number().min(0),
});

export async function updateSettingsAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };

  const parsed = schema.safeParse({
    currency: String(formData.get("currency") ?? "USD").toUpperCase(),
    timezone: formData.get("timezone"),
    default_product_cost_pct: formData.get("default_product_cost_pct"),
    default_shipping_cost: formData.get("default_shipping_cost"),
    payment_fee_pct: formData.get("payment_fee_pct"),
    payment_fee_fixed: formData.get("payment_fee_fixed"),
  });
  if (!parsed.success) {
    return { error: parsed.error.errors[0]?.message ?? "Invalid input." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("settings")
    .update(parsed.data)
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  // Recompute history so new cost assumptions are reflected immediately.
  try {
    await recomputeDailyMetrics(
      supabase,
      user.id,
      lastNDays(90, parsed.data.timezone),
    );
  } catch {
    // Non-fatal: cron will reconcile.
  }

  revalidatePath("/dashboard");
  revalidatePath("/settings");
  return { ok: true };
}

/**
 * Save (or clear) the user's own Gemini API key for the AI assistant. Stored
 * encrypted; an empty value removes it. The key is never sent back to the
 * browser — only a "configured / not configured" flag is.
 */
export async function saveGeminiKeyAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getCurrentUser();
  if (!user) return { error: "Not authenticated." };

  const key = String(formData.get("gemini_api_key") ?? "").trim();
  const supabase = await createClient();

  // Empty input -> remove the stored key.
  if (!key) {
    const { error } = await supabase
      .from("settings")
      .update({ gemini_api_key_encrypted: null })
      .eq("user_id", user.id);
    if (error) return { error: error.message };
    revalidatePath("/settings");
    return { ok: true };
  }

  if (key.length < 20) {
    return { error: "Essa chave parece inválida." };
  }

  const { error } = await supabase
    .from("settings")
    .update({ gemini_api_key_encrypted: encryptToken(key) })
    .eq("user_id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/settings");
  return { ok: true };
}
