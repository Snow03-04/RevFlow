"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";

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

/**
 * Reprocess ALL of the user's history so past manual entries — in particular
 * older "Google …" despesas that must count as Google ad spend — are folded into
 * daily_metrics and the P&L sheet. The regular cron only recomputes ~90 days, so
 * anything older stays stale until this runs. Recomputes from the earliest
 * manual entry (capped to 400 days to stay within the serverless time limit) up
 * to today, then re-projects every P&L month the range touches.
 */
export async function recomputeManualHistory(): Promise<ActionResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const [{ data: first }, { data: settings }] = await Promise.all([
    supabase
      .from("manual_entries")
      .select("date")
      .eq("user_id", user.id)
      .order("date", { ascending: true })
      .limit(1)
      .maybeSingle(),
    supabase
      .from("settings")
      .select("timezone")
      .eq("user_id", user.id)
      .maybeSingle(),
  ]);
  if (!first) return { ok: true }; // no manual entries — nothing to reprocess

  const tz = settings?.timezone ?? "UTC";
  const to = new Date().toLocaleDateString("en-CA", { timeZone: tz }); // yyyy-mm-dd
  // Cap the window so a large history can't blow the serverless time budget.
  const cap = new Date();
  cap.setDate(cap.getDate() - 400);
  const capYmd = cap.toISOString().slice(0, 10);
  const from = first.date > capYmd ? first.date : capYmd;

  try {
    await recomputeDailyMetrics(supabase, user.id, { from, to });
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Falha ao recalcular.",
    };
  }

  // Push the refreshed metrics into every P&L month the range spans, so the
  // sheet's Adspend Google reflects the old despesas too (best-effort).
  const [fy, fm] = [Number(from.slice(0, 4)), Number(from.slice(5, 7))];
  const [ty, tm] = [Number(to.slice(0, 4)), Number(to.slice(5, 7))];
  for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); ) {
    try {
      await projectPnlMonth(supabase, user.id, y, m);
    } catch {
      /* month may have no sheet — ignore */
    }
    if (m === 12) {
      m = 1;
      y++;
    } else {
      m++;
    }
  }

  revalidatePath("/dashboard");
  revalidatePath("/pnl");
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
