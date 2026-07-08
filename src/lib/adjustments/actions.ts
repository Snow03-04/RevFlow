"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";

export interface ManualEntry {
  id: string;
  date: string;
  kind: "profit" | "expense";
  amount: number;
  currency: string | null;
  label: string | null;
}

export interface ActionResult {
  ok: boolean;
  error?: string;
}

/** yyyy-mm-dd guard so a bad `date` can never widen the recompute window. */
function isYmd(s: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(s);
}

/** All manual entries for the current user in a date range (most recent first). */
export async function getManualEntries(
  from: string,
  to: string,
): Promise<ManualEntry[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("manual_entries")
    .select("id, date, kind, amount, currency, label")
    .eq("user_id", user.id)
    .gte("date", from)
    .lte("date", to)
    .order("date", { ascending: false })
    .order("created_at", { ascending: false });
  return (data ?? []) as ManualEntry[];
}

/**
 * Add a manual profit/expense for a specific day, then recompute THAT day's
 * metrics so the dashboard profit reflects it immediately. Amount is stored in
 * the user's display currency (converted to base at recompute).
 */
export async function addManualEntry(values: {
  date: string;
  kind: "profit" | "expense";
  amount: number;
  label?: string | null;
}): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  if (!isYmd(values.date)) return { ok: false, error: "Data inválida." };
  if (values.kind !== "profit" && values.kind !== "expense")
    return { ok: false, error: "Tipo inválido." };
  const amount = Number(values.amount);
  if (!Number.isFinite(amount) || amount <= 0)
    return { ok: false, error: "Valor inválido." };

  const supabase = await createClient();
  const { data: settings } = await supabase
    .from("settings")
    .select("currency")
    .eq("user_id", user.id)
    .maybeSingle();

  const { error } = await supabase.from("manual_entries").insert({
    user_id: user.id,
    date: values.date,
    kind: values.kind,
    amount,
    currency: settings?.currency ?? "USD",
    label: values.label?.trim() || null,
  });
  if (error) return { ok: false, error: error.message };

  await recomputeDailyMetrics(supabase, user.id, {
    from: values.date,
    to: values.date,
  });
  revalidatePath("/dashboard");
  return { ok: true };
}

/** Delete a manual entry (own only) and recompute its day. */
export async function deleteManualEntry(id: string): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  // Read the day first so we know which metrics to recompute after deletion.
  const { data: row } = await supabase
    .from("manual_entries")
    .select("date")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!row) return { ok: false, error: "Registo não encontrado." };

  const { error } = await supabase
    .from("manual_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  await recomputeDailyMetrics(supabase, user.id, {
    from: row.date,
    to: row.date,
  });
  revalidatePath("/dashboard");
  return { ok: true };
}
