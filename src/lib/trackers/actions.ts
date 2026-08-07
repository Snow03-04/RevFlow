"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncMetaForUser,
  syncShopifyOrdersForUser,
  refreshCampaignLinks,
} from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasDay, projectRoasMonth } from "@/lib/trackers/roas-import";
import type { TablesInsert } from "@/types/database";

export interface SaveResult {
  ok: boolean;
  error?: string;
}

export interface ImportResult {
  ok: boolean;
  error?: string;
  count?: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/* ------------------------------------------------------------------ */
/* P&L                                                                 */
/* ------------------------------------------------------------------ */

export async function savePnlSettings(
  values: Partial<TablesInsert<"pnl_settings">>,
): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_settings")
    .upsert({ user_id: user.id, ...values }, { onConflict: "user_id" });
  if (!error) return { ok: true };
  // `payment_fee_pct` (migration 0023) may not exist yet — retry without it so
  // the rest of the settings still save.
  const code = (error as { code?: string }).code;
  if (code === "42703" || /payment_fee_pct/.test(error.message ?? "")) {
    const { payment_fee_pct: _drop, ...rest } = values;
    const { error: e2 } = await supabase
      .from("pnl_settings")
      .upsert({ user_id: user.id, ...rest }, { onConflict: "user_id" });
    return e2 ? { ok: false, error: e2.message } : { ok: true };
  }
  return { ok: false, error: error.message };
}

export async function savePnlMonthOverride(values: {
  year: number;
  month: number;
  agency_fee_fb: number | null;
  agency_fee_google: number | null;
  transaction_fee: number | null;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_month_overrides")
    .upsert(
      { user_id: user.id, ...values },
      { onConflict: "user_id,year,month" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function savePnlDay(values: {
  year: number;
  month: number;
  day: number;
  gross_revenue: number;
  refunds: number;
  cogs: number;
  adspend_fb: number;
  adspend_google: number;
  orders: number;
  notes: string | null;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_days")
    .upsert(
      { user_id: user.id, ...values },
      { onConflict: "user_id,year,month,day" },
    );
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ------------------------------------------------------------------ */
/* ROAS                                                                */
/* ------------------------------------------------------------------ */

export async function saveRoasSettings(
  values: Partial<TablesInsert<"roas_settings">>,
): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_settings")
    .upsert({ user_id: user.id, ...values }, { onConflict: "user_id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function saveRoasEntry(values: {
  id: string;
  year: number;
  month: number;
  day: number;
  position: number;
  campaign_name: string;
  total_spend: number;
  cpc: number;
  atc: number;
  pur: number;
  price: number;
  cog: number;
  units_sold: number;
}): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .upsert({ user_id: user.id, ...values }, { onConflict: "id" });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function deleteRoasEntry(id: string): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/** Wipe every ROAS entry (all days) for the current user. */
export async function clearAllRoasEntries(): Promise<SaveResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("roas_entries")
    .delete()
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/roas");
  return { ok: true };
}

/* ------------------------------------------------------------------ */
/* Auto-fill from synced Shopify + Meta data                           */
/* ------------------------------------------------------------------ */

/**
 * Fill a P&L month's daily inputs from `daily_metrics` (Gross, Refunds, COGS
 * from Shopify; Adspend FB from Meta). Values are converted to the P&L
 * tracker's currency. Manual fields (Adspend Google, Notes) are preserved.
 */
export async function autofillPnlMonth(
  year: number,
  month: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  // Pull fresh Shopify orders + Meta spend covering the whole month BEFORE
  // reading daily_metrics. Without this we'd import a stale/partial snapshot —
  // e.g. days with ad spend but €0 revenue because their orders were never
  // synced. Best-effort: if a source isn't connected we still import whatever
  // metrics exist.
  //
  // The two syncs run in PARALLEL and each SKIPS its own recompute; we then
  // recompute ONCE, scoped to the month being imported. Previously they ran
  // sequentially and each recomputed the entire `daysBack` window (up to 180
  // days) — twice, across every store. That was the bulk of the import time.
  const monthStart = new Date(year, month - 1, 1).getTime();
  const daysBack = Math.min(
    180,
    Math.max(3, Math.ceil((Date.now() - monthStart) / 86_400_000) + 1),
  );
  try {
    await Promise.all([
      syncMetaForUser(supabase, user.id, daysBack, { skipRecompute: true }),
      syncShopifyOrdersForUser(supabase, user.id, daysBack, {
        skipRecompute: true,
      }),
    ]);
    await recomputeDailyMetrics(supabase, user.id, { from, to });
  } catch {
    // Non-blocking — fall back to the existing daily_metrics.
  }

  // Same projection the cron runs — one implementation, one behaviour.
  try {
    const count = await projectPnlMonth(supabase, user.id, year, month);
    revalidatePath("/pnl");
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Não foi possível importar.",
    };
  }
}

/**
 * Import Meta campaigns for a ROAS "Day N". Best-effort: pulls live Meta spend +
 * recent Shopify orders first (so the day is fresh), but a transient sync error
 * never fails the import — it just projects whatever is already synced. Product
 * economics (Price / COG / Units / ATC) on existing rows are preserved.
 */
export async function autofillRoasDay(
  year: number,
  month: number,
  day: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  // Best-effort live refresh — a Meta hiccup/rate-limit must not break importing.
  // Meta + Shopify run in PARALLEL (each skipping its own recompute) and a single
  // recompute covers just the target day — previously this always re-synced a
  // flat 31-day window SEQUENTIALLY (Meta, then Shopify, each doing its own full
  // recompute) even for a single day, which routinely exceeded the serverless
  // time limit and crashed the page instead of importing.
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const targetMs = new Date(year, month - 1, day).getTime();
  const daysBack = Math.min(
    60,
    Math.max(3, Math.ceil((Date.now() - targetMs) / 86_400_000) + 1),
  );
  try {
    await Promise.all([
      syncMetaForUser(supabase, user.id, daysBack, { skipRecompute: true }),
      syncShopifyOrdersForUser(supabase, user.id, daysBack, {
        skipRecompute: true,
      }),
    ]);
    await Promise.all([
      recomputeDailyMetrics(supabase, user.id, { from: dateStr, to: dateStr }),
      refreshCampaignLinks(supabase, user.id),
    ]);
  } catch {
    /* fall back to the already-synced campaigns */
  }

  try {
    const count = await projectRoasDay(supabase, user.id, year, month, day);
    revalidatePath("/roas");
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Não foi possível importar.",
    };
  }
}

/**
 * Import Meta campaigns for EVERY day of the current month at once — each active
 * campaign lands on its own day. Best-effort live sync first (never fails the
 * import), then a pure projection. Product economics are preserved where rows
 * already exist.
 */
export async function autofillRoasAllDays(
  year?: number,
  month?: number,
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  // Default to the current month when not specified (e.g. the AI assistant).
  const now = new Date();
  year = year ?? now.getFullYear();
  month = month ?? now.getMonth() + 1;

  // Best-effort live refresh — a Meta hiccup/rate-limit must not break importing.
  // Meta + Shopify run in PARALLEL (each skipping its own recompute), scoped to
  // just this month, and a single recompute covers the whole range once —
  // previously this always re-synced a flat 31-day window SEQUENTIALLY (Meta,
  // then Shopify, each doing its own full recompute), which routinely exceeded
  // the serverless time limit and crashed the page instead of importing.
  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;
  const monthStart = new Date(year, month - 1, 1).getTime();
  const daysBack = Math.min(
    180,
    Math.max(3, Math.ceil((Date.now() - monthStart) / 86_400_000) + 1),
  );
  try {
    await Promise.all([
      syncMetaForUser(supabase, user.id, daysBack, { skipRecompute: true }),
      syncShopifyOrdersForUser(supabase, user.id, daysBack, {
        skipRecompute: true,
      }),
    ]);
    await Promise.all([
      recomputeDailyMetrics(supabase, user.id, { from, to }),
      refreshCampaignLinks(supabase, user.id),
    ]);
  } catch {
    /* fall back to the already-synced campaigns */
  }

  try {
    const count = await projectRoasMonth(supabase, user.id, year, month);
    revalidatePath("/roas");
    return { ok: true, count };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Não foi possível importar.",
    };
  }
}
