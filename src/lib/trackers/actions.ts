"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { refreshCostDependents } from "@/lib/cogs/refresh";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  syncMetaForUser,
  syncShopifyOrdersForUser,
  refreshCampaignLinks,
} from "@/lib/jobs";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasDecisionDays, projectRoasMonth } from "@/lib/trackers/roas-import";
import { addDaysYmd } from "@/lib/date";
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
  const parsed = z.object({
    currency: z.enum(["€", "$", "£"]), base_year: z.number().int().min(2000).max(2100),
    agency_fee_fb: z.number().min(0).max(1), agency_fee_google: z.number().min(0).max(1),
    transaction_fee: z.number().min(0).max(100), payment_fee_pct: z.number().min(0).max(1),
  }).partial().safeParse(values);
  if (!parsed.success) return { ok: false, error: "Verifica a moeda, o ano e as taxas indicadas." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_settings")
    .upsert({ ...parsed.data, user_id: user.id }, { onConflict: "user_id" });
  if (!error) {
    try {
      await refreshCostDependents(supabase, user.id);
      for (const path of ["/pnl", "/dashboard", "/finance", "/payments", "/settings"]) revalidatePath(path, "layout");
      return { ok: true };
    } catch {
      return { ok: false, error: "Definições guardadas, mas não foi possível recalcular o histórico. Tenta guardar novamente." };
    }
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
  if (!Number.isInteger(values.year) || !Number.isInteger(values.month) || values.month < 1 || values.month > 12 ||
    [values.agency_fee_fb, values.agency_fee_google, values.transaction_fee].some((v) => v != null && (!Number.isFinite(v) || v < 0)))
    return { ok: false, error: "Mês ou taxas inválidos." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("pnl_month_overrides")
    .upsert(
      { user_id: user.id, ...values },
      { onConflict: "user_id,year,month" },
    );
  if (error) return { ok: false, error: error.message };
  try {
    await refreshCostDependents(supabase, user.id, { months: [`${values.year}-${pad(values.month)}`] });
    revalidatePath("/dashboard");
    revalidatePath("/pnl");
    return { ok: true };
  } catch { return { ok: false, error: "Taxas guardadas; o recálculo do mês falhou. Tenta novamente." }; }
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
  opts: { deep?: boolean } = {},
): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  // Re-pulling Shopify/Meta for the whole month is DEEP and opt-in only: a
  // window of up to 180 days across every connection, in one serverless
  // request, is what made the sheet slow and then fail outright.
  if (opts.deep) {
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
    } catch {
      // Non-blocking — fall back to whatever is already synced.
    }
  }

  // Recompute the month from ALREADY-SYNCED orders/campaigns, then project.
  // This is local DB work only (no external API calls) and measured ~1.3s for a
  // full month, so it stays well inside the time limit — but it is what makes
  // the sheet self-healing: days whose metrics were computed BEFORE their
  // orders finished syncing sit at 0 revenue / 0 orders forever otherwise, and
  // the projection faithfully copies those zeros into the sheet (the "days that
  // don't show up"). Best-effort so a recompute hiccup still lets the
  // projection run against existing metrics.
  try {
    await recomputeDailyMetrics(supabase, user.id, { from, to });
  } catch {
    /* fall back to the existing daily_metrics */
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
 * never fails the import — it projects whatever is already synced. Refreshes
 * the preceding decision days too, so today's advice uses corrected sales.
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
  // recompute covers the small decision window — previously this re-synced a
  // flat 31-day window SEQUENTIALLY (Meta, then Shopify, each doing its own full
  // recompute) even for a single day, which routinely exceeded the serverless
  // time limit and crashed the page instead of importing.
  const dateStr = `${year}-${pad(month)}-${pad(day)}`;
  const targetMs = new Date(year, month - 1, day).getTime();
  const daysBack = Math.min(
    60,
    Math.max(4, Math.ceil((Date.now() - targetMs) / 86_400_000) + 4),
  );
  try {
    await Promise.all([
      syncMetaForUser(supabase, user.id, daysBack, { skipRecompute: true }),
      syncShopifyOrdersForUser(supabase, user.id, daysBack, {
        skipRecompute: true,
      }),
    ]);
    await Promise.all([
      recomputeDailyMetrics(supabase, user.id, { from: addDaysYmd(dateStr, -3), to: dateStr }),
      refreshCampaignLinks(supabase, user.id),
    ]);
  } catch {
    /* fall back to the already-synced campaigns */
  }

  try {
    const count = await projectRoasDecisionDays(supabase, user.id, dateStr);
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
