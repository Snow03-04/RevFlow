import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { getAutomaticPnlDays } from "./pnl-projection";
import { daysInMonth, type PnlSheetDay } from "./pnl";
import { evaluateRoasWindow, type RoasEvaluation } from "./roas-window";
import { ymdInTz, zonedRangeUtc } from "@/lib/date";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { metaCampaignKey } from "./meta-pnl";

type DB = SupabaseClient<Database>;

/* ------------------------------------------------------------------ */
/* P&L                                                                 */
/* ------------------------------------------------------------------ */

export async function getPnlSettings(
  supabase: DB,
  userId: string,
): Promise<Tables<"pnl_settings">> {
  const { data, error } = await supabase
    .from("pnl_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw error;
  if (data) return data;

  const { data: created, error: createError } = await supabase
    .from("pnl_settings")
    .insert({ user_id: userId, agency_fee_fb: 0, agency_fee_google: 0 })
    .select("*")
    .single();
  if (createError) throw createError;
  if (!created) throw new Error("Não foi possível criar as definições do P&L.");
  return created;
}

export async function getPnlMonth(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
  scope?: { storeId?: string; currency: string },
): Promise<{
  override: Tables<"pnl_month_overrides"> | null;
  days: PnlSheetDay[];
}> {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  const [override, days] = await Promise.all([
    supabase
      .from("pnl_month_overrides")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle(),
    scope ? getAutomaticPnlDays(supabase, userId, { from: `${prefix}-01`, to: `${prefix}-${daysInMonth(year, month)}` }, scope.currency, scope.storeId)
      .then((data) => ({ data, error: null })) : supabase
      .from("pnl_days")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month),
  ]);
  if (override.error) throw override.error;
  if (days.error) throw days.error;
  return { override: override.data ?? null, days: days.data ?? [] };
}

/** Fees only: platform sheets do not need the consolidated editable day rows. */
export async function getPnlYearOverrides(supabase: DB, userId: string, year: number): Promise<Tables<"pnl_month_overrides">[]> {
  const { data, error } = await supabase.from("pnl_month_overrides").select("*")
    .eq("user_id", userId).eq("year", year);
  if (error) throw error;
  return data ?? [];
}

/** All day rows and overrides for a year, used by the P&L dashboard. */
export async function getPnlYear(
  supabase: DB,
  userId: string,
  year: number,
  scope?: { storeId?: string; currency: string },
): Promise<{
  days: PnlSheetDay[];
  overrides: Tables<"pnl_month_overrides">[];
}> {
  const [days, overrides] = await Promise.all([
    scope ? getAutomaticPnlDays(supabase, userId, { from: `${year}-01-01`, to: `${year}-12-31` }, scope.currency, scope.storeId)
      .then((data) => ({ data, error: null })) : supabase
      .from("pnl_days")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year),
    getPnlYearOverrides(supabase, userId, year),
  ]);
  if (days.error) throw days.error;
  return { days: days.data ?? [], overrides };
}

/* ------------------------------------------------------------------ */
/* ROAS                                                                */
/* ------------------------------------------------------------------ */

export async function getRoasSettings(
  supabase: DB,
  userId: string,
): Promise<Tables<"roas_settings">> {
  const { data } = await supabase
    .from("roas_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;

  const { data: created } = await supabase
    .from("roas_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return created!;
}

export async function getRoasDay(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
  day: number,
): Promise<{
  entries: Tables<"roas_entries">[];
  evaluations: Record<string, RoasEvaluation>;
  timezone: string;
}> {
  const previous = { year: month === 1 ? year - 1 : year, month: month === 1 ? 12 : month - 1 };
  const readMonth = (y: number, m: number) => selectAllByUser<Tables<"roas_entries">>(supabase, "roas_entries", "*", userId,
    (q) => q.eq("year", y).eq("month", m).order("day").order("position"));
  const [rows, previousRows, settings, connections] = await Promise.all([
    readMonth(year, month), readMonth(previous.year, previous.month),
    supabase.from("settings").select("timezone").eq("user_id", userId).maybeSingle(),
    supabase.from("meta_connections").select("id,budget_synced_at,budget_sync_error").eq("user_id", userId),
  ]);
  if (settings.error) throw settings.error;
  const timezone = settings.data?.timezone ?? "Europe/Lisbon";
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const window = zonedRangeUtc({ from: `${previous.year}-${String(previous.month).padStart(2, "0")}-01`, to: date }, timezone);
  const changes = await selectAllByUser<Tables<"meta_budget_changes">>(supabase, "meta_budget_changes",
    "meta_connection_id,campaign_id,changed_at", userId, (q) => q.gte("changed_at", window.startUtc).lt("changed_at", window.endUtc));
  const history = [...previousRows, ...rows];
  const events = changes.map((r) => ({ campaignKey: metaCampaignKey(r.meta_connection_id, r.campaign_id), changedAt: r.changed_at }));
  const entries = rows
    .filter((r) => r.day === day)
    .sort((a, b) => a.position - b.position);

  const evaluations = Object.fromEntries(entries.map((row) => {
    const connectionId = row.campaign_key?.split(":")[0];
    const conn = connections.data?.find((c) => c.id === connectionId);
    const checked = Date.parse(conn?.budget_synced_at ?? "");
    const historyKnown = !row.campaign_key || (!connections.error && !conn?.budget_sync_error && Number.isFinite(checked) && Date.now() - checked < 30 * 60_000);
    return [row.id, evaluateRoasWindow(row, history, events, { date, today: ymdInTz(new Date(), timezone), timezone, historyKnown })];
  }));
  return { entries, evaluations, timezone };
}

/** All entries for a month (for the weekly summary aggregation). */
export async function getAllRoasEntries(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
): Promise<Tables<"roas_entries">[]> {
  const { data } = await supabase
    .from("roas_entries")
    .select("*")
    .eq("user_id", userId)
    .eq("year", year)
    .eq("month", month)
    .order("day", { ascending: true })
    .order("position", { ascending: true });
  return data ?? [];
}
