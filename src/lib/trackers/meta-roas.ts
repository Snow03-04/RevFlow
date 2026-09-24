import { addDaysYmd, eachDay } from "@/lib/date";

export const META_FIRE_ROAS = 3;
export const META_FIRE_DAYS = 3;
export const META_ROAS_DAYS = 2;
export type MetaRoasFact = { date: string; spend: number; revenue: number };
export type MetaRoasSignal = { from: string; to: string; days: number; threshold: number; roas: number; minDailyRoas: number };
export type MetaRecentRoas = { from: string; to: string; spend: number; revenue: number; complete: boolean; roas: number | null };
export type MetaRoasCheck = { from: string; to: string; days: { date: string; roas: number | null }[]; qualifiedDays: number; signal: MetaRoasSignal | null; recent: MetaRecentRoas };

export function metaRoasRange(today: string) {
  return { from: addDaysYmd(today, -META_FIRE_DAYS), to: addDaysYmd(today, -1) };
}

export function recentMetaRoas(facts: MetaRoasFact[], today: string): MetaRecentRoas {
  const range = { from: addDaysYmd(today, -META_ROAS_DAYS), to: addDaysYmd(today, -1) };
  const dates = eachDay(range);
  const rows = facts.filter((fact) => dates.includes(fact.date));
  const complete = rows.length === dates.length && dates.every((date) => rows.filter((row) => row.date === date).length === 1)
    && rows.every((row) => Number.isFinite(row.spend) && row.spend >= 0 && Number.isFinite(row.revenue));
  const spend = complete ? rows.reduce((sum, row) => sum + row.spend, 0) : 0;
  const revenue = complete ? rows.reduce((sum, row) => sum + row.revenue, 0) : 0;
  return { ...range, complete, spend, revenue, roas: spend > 0 ? revenue / spend : null };
}

export function checkMetaRoas(facts: MetaRoasFact[], today: string, status?: string | null): MetaRoasCheck {
  const range = metaRoasRange(today);
  const days = eachDay(range).map((date) => {
    const rows = facts.filter((row) => row.date === date);
    const row = rows.length === 1 ? rows[0] : null;
    const ratio = row && Number.isFinite(row.spend) && row.spend > 0 ? row.revenue / row.spend : NaN;
    return { date, roas: Number.isFinite(ratio) ? ratio : null };
  });
  return { ...range, days, qualifiedDays: days.filter((day) => day.roas != null && day.roas >= META_FIRE_ROAS).length,
    signal: stableMetaRoas(facts, today, status), recent: recentMetaRoas(facts, today) };
}

/** A recent daily streak, never a monthly average or today's unfinished result. */
export function stableMetaRoas(facts: MetaRoasFact[], today: string, status?: string | null): MetaRoasSignal | null {
  if (status !== "ACTIVE") return null;
  const range = metaRoasRange(today);
  const dates = eachDay(range);
  const recent = facts.filter((fact) => fact.date >= range.from && fact.date <= range.to);
  if (recent.length !== dates.length || dates.some((date) => recent.filter((fact) => fact.date === date).length !== 1)) return null;
  if (recent.some((fact) => !Number.isFinite(fact.spend) || !Number.isFinite(fact.revenue) || fact.spend <= 0 || fact.revenue / fact.spend < META_FIRE_ROAS)) return null;
  const ratios = recent.map((fact) => fact.revenue / fact.spend);
  if (ratios.some((ratio) => !Number.isFinite(ratio))) return null;
  const spend = recent.reduce((sum, fact) => sum + fact.spend, 0);
  const revenue = recent.reduce((sum, fact) => sum + fact.revenue, 0);
  return { ...range, days: META_FIRE_DAYS, threshold: META_FIRE_ROAS, roas: revenue / spend, minDailyRoas: Math.min(...ratios) };
}
