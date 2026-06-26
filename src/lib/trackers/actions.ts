"use server";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getStoreCurrency } from "@/lib/queries";
import { getCurrentRate } from "@/lib/fx";
import { round2 } from "@/lib/profit";
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

const SYMBOL_TO_ISO: Record<string, string> = {
  "€": "EUR",
  $: "USD",
  "£": "GBP",
};

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
  return error ? { ok: false, error: error.message } : { ok: true };
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

  const { data: settings } = await supabase
    .from("pnl_settings")
    .select("currency")
    .eq("user_id", user.id)
    .maybeSingle();
  const targetIso = SYMBOL_TO_ISO[settings?.currency ?? "€"] ?? "EUR";
  const store = await getStoreCurrency(supabase, user.id);
  const fx =
    store && store.toUpperCase() !== targetIso
      ? await getCurrentRate(store, targetIso)
      : 1;

  const last = new Date(year, month, 0).getDate();
  const from = `${year}-${pad(month)}-01`;
  const to = `${year}-${pad(month)}-${pad(last)}`;

  const [{ data: metrics }, { data: existing }] = await Promise.all([
    supabase
      .from("daily_metrics")
      .select("date, gross_revenue, refunds, product_cost, ad_spend")
      .eq("user_id", user.id)
      .gte("date", from)
      .lte("date", to),
    supabase
      .from("pnl_days")
      .select("day, adspend_google, notes")
      .eq("user_id", user.id)
      .eq("year", year)
      .eq("month", month),
  ]);

  const exByDay = new Map((existing ?? []).map((d) => [d.day, d]));

  const rows = (metrics ?? []).map((m) => {
    const day = parseInt(m.date.slice(8, 10), 10);
    const ex = exByDay.get(day);
    return {
      user_id: user.id,
      year,
      month,
      day,
      gross_revenue: round2(Number(m.gross_revenue) * fx),
      refunds: round2(Number(m.refunds) * fx),
      cogs: round2(Number(m.product_cost) * fx),
      adspend_fb: round2(Number(m.ad_spend) * fx),
      adspend_google: ex ? Number(ex.adspend_google) : 0,
      notes: ex?.notes ?? null,
    };
  });

  if (rows.length > 0) {
    const { error } = await supabase
      .from("pnl_days")
      .upsert(rows, { onConflict: "user_id,year,month,day" });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath("/pnl");
  return { ok: true, count: rows.length };
}

/**
 * Import Meta campaigns for a ROAS "Day N" (mapped to day N of the current
 * month). Fills Campaign / Spend / CPC / PUR from synced data; product
 * economics (Price / COG / Units / ATC) are preserved for manual entry.
 */
export async function autofillRoasDay(day: number): Promise<ImportResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: settings } = await supabase
    .from("roas_settings")
    .select("currency")
    .eq("user_id", user.id)
    .maybeSingle();
  const targetIso = SYMBOL_TO_ISO[settings?.currency ?? "€"] ?? "EUR";
  const store = await getStoreCurrency(supabase, user.id);
  const fx =
    store && store.toUpperCase() !== targetIso
      ? await getCurrentRate(store, targetIso)
      : 1;

  const now = new Date();
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(day)}`;

  const [{ data: camps }, { data: existing }] = await Promise.all([
    supabase
      .from("campaigns")
      .select("campaign_id, campaign_name, spend, clicks, purchases")
      .eq("user_id", user.id)
      .eq("date", date),
    supabase
      .from("roas_entries")
      .select("*")
      .eq("user_id", user.id)
      .eq("day", day),
  ]);

  if (!camps || camps.length === 0) {
    return { ok: true, count: 0 };
  }

  const byName = new Map((existing ?? []).map((e) => [e.campaign_name, e]));
  let pos = existing?.length ?? 0;

  const upserts = camps.map((c) => {
    const name = c.campaign_name ?? c.campaign_id;
    const ex = byName.get(name);
    const clicks = Number(c.clicks);
    const cpc = clicks > 0 ? Number(c.spend) / clicks : 0;
    return {
      id: ex?.id ?? crypto.randomUUID(),
      user_id: user.id,
      day,
      position: ex?.position ?? pos++,
      campaign_name: name,
      total_spend: round2(Number(c.spend) * fx),
      cpc: round2(cpc * fx),
      atc: ex ? Number(ex.atc) : 0,
      pur: Number(c.purchases),
      price: ex ? Number(ex.price) : 0,
      cog: ex ? Number(ex.cog) : 0,
      units_sold: ex ? Number(ex.units_sold) : 0,
    };
  });

  const { error } = await supabase
    .from("roas_entries")
    .upsert(upserts, { onConflict: "id" });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/roas");
  return { ok: true, count: upserts.length };
}
