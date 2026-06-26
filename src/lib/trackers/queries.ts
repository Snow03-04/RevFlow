import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import {
  computeContextForDay,
  type DayContextEntry,
  type RoasInput,
} from "@/lib/trackers/roas";

type DB = SupabaseClient<Database>;

/* ------------------------------------------------------------------ */
/* P&L                                                                 */
/* ------------------------------------------------------------------ */

export async function getPnlSettings(
  supabase: DB,
  userId: string,
): Promise<Tables<"pnl_settings">> {
  const { data } = await supabase
    .from("pnl_settings")
    .select("*")
    .eq("user_id", userId)
    .maybeSingle();
  if (data) return data;

  const { data: created } = await supabase
    .from("pnl_settings")
    .insert({ user_id: userId })
    .select("*")
    .single();
  return created!;
}

export async function getPnlMonth(
  supabase: DB,
  userId: string,
  year: number,
  month: number,
): Promise<{
  override: Tables<"pnl_month_overrides"> | null;
  days: Tables<"pnl_days">[];
}> {
  const [{ data: override }, { data: days }] = await Promise.all([
    supabase
      .from("pnl_month_overrides")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month)
      .maybeSingle(),
    supabase
      .from("pnl_days")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year)
      .eq("month", month),
  ]);
  return { override: override ?? null, days: days ?? [] };
}

/** All day rows for a year, used by the dashboard. */
export async function getPnlYear(
  supabase: DB,
  userId: string,
  year: number,
): Promise<{
  days: Tables<"pnl_days">[];
  overrides: Tables<"pnl_month_overrides">[];
}> {
  const [{ data: days }, { data: overrides }] = await Promise.all([
    supabase
      .from("pnl_days")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year),
    supabase
      .from("pnl_month_overrides")
      .select("*")
      .eq("user_id", userId)
      .eq("year", year),
  ]);
  return { days: days ?? [], overrides: overrides ?? [] };
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

function toInput(r: Tables<"roas_entries">): RoasInput {
  return {
    campaignName: r.campaign_name,
    totalSpend: Number(r.total_spend),
    cpc: Number(r.cpc),
    atc: Number(r.atc),
    pur: Number(r.pur),
    price: Number(r.price),
    cog: Number(r.cog),
    unitsSold: Number(r.units_sold),
  };
}

export async function getRoasDay(
  supabase: DB,
  userId: string,
  day: number,
): Promise<{
  entries: Tables<"roas_entries">[];
  prevContext: Record<string, DayContextEntry>;
}> {
  // Load the full history so the consecutive Day# counter + 48h window are exact.
  const { data: all } = await supabase
    .from("roas_entries")
    .select("*")
    .eq("user_id", userId)
    .order("day", { ascending: true })
    .order("position", { ascending: true });

  const rows = all ?? [];
  const byDay = new Map<number, RoasInput[]>();
  for (const r of rows) {
    const list = byDay.get(r.day) ?? [];
    list.push(toInput(r));
    byDay.set(r.day, list);
  }

  const prevMap =
    day > 1 ? computeContextForDay(byDay, day - 1) : new Map<string, DayContextEntry>();
  const prevContext: Record<string, DayContextEntry> = {};
  for (const [k, v] of prevMap) prevContext[k] = v;

  const entries = rows
    .filter((r) => r.day === day)
    .sort((a, b) => a.position - b.position);

  return { entries, prevContext };
}

/** All entries (for the weekly summary aggregation). */
export async function getAllRoasEntries(
  supabase: DB,
  userId: string,
): Promise<Tables<"roas_entries">[]> {
  const { data } = await supabase
    .from("roas_entries")
    .select("*")
    .eq("user_id", userId)
    .order("day", { ascending: true })
    .order("position", { ascending: true });
  return data ?? [];
}
