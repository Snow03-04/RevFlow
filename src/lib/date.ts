import type { DateRange } from "@/types";

/**
 * Timezone-aware date helpers. All "days" are computed in the merchant's
 * configured IANA timezone so that an order placed at 11pm local time lands in
 * the correct day's revenue.
 */

/** yyyy-mm-dd for a given Date in the given IANA timezone. */
export function ymdInTz(date: Date, timeZone: string): string {
  // en-CA gives ISO-ish yyyy-mm-dd.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

export function todayYmd(timeZone: string): string {
  return ymdInTz(new Date(), timeZone);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/** Monday-based start of the ISO week for a yyyy-mm-dd string. */
function startOfWeekYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  const dow = dt.getUTCDay(); // 0 = Sunday
  const diff = dow === 0 ? -6 : 1 - dow; // shift to Monday
  return addDaysYmd(ymd, diff);
}

function startOfMonthYmd(ymd: string): string {
  return `${ymd.slice(0, 7)}-01`;
}

function endOfMonthYmd(ymd: string): string {
  const [y, m] = ymd.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m, 0)); // day 0 of next month = last day
  return dt.toISOString().slice(0, 10);
}

export type ComparisonPeriod = "today" | "week" | "month";

export interface ComparisonRanges {
  current: DateRange;
  previous: DateRange;
}

/**
 * Returns the current period and the matching previous period for comparison.
 * - today    -> today vs yesterday
 * - week     -> this week (Mon..today) vs last week (Mon..Sun)
 * - month    -> this month (1st..today) vs last month (full)
 */
export function comparisonRanges(
  period: ComparisonPeriod,
  timeZone: string,
): ComparisonRanges {
  const today = todayYmd(timeZone);

  if (period === "today") {
    const yesterday = addDaysYmd(today, -1);
    return {
      current: { from: today, to: today },
      previous: { from: yesterday, to: yesterday },
    };
  }

  if (period === "week") {
    const thisStart = startOfWeekYmd(today);
    const lastStart = addDaysYmd(thisStart, -7);
    const lastEnd = addDaysYmd(thisStart, -1);
    return {
      current: { from: thisStart, to: today },
      previous: { from: lastStart, to: lastEnd },
    };
  }

  // month
  const thisStart = startOfMonthYmd(today);
  const lastEnd = addDaysYmd(thisStart, -1);
  const lastStart = startOfMonthYmd(lastEnd);
  return {
    current: { from: thisStart, to: today },
    previous: { from: lastStart, to: endOfMonthYmd(lastEnd) },
  };
}

/** A trailing N-day inclusive range ending today. */
export function lastNDays(n: number, timeZone: string): DateRange {
  const to = todayYmd(timeZone);
  return { from: addDaysYmd(to, -(n - 1)), to };
}

export const RANGE_OPTIONS = [
  { value: "today", label: "Today" },
  { value: "7d", label: "Last 7 days" },
  { value: "30d", label: "Last 30 days" },
  { value: "90d", label: "Last 90 days" },
  { value: "mtd", label: "Month to date" },
] as const;

export type RangeKey = (typeof RANGE_OPTIONS)[number]["value"];

/** Resolve a UI range key to a concrete DateRange. */
export function resolveRange(key: string | undefined, timeZone: string): DateRange {
  const today = todayYmd(timeZone);
  switch (key) {
    case "today":
      return { from: today, to: today };
    case "7d":
      return lastNDays(7, timeZone);
    case "90d":
      return lastNDays(90, timeZone);
    case "mtd":
      return { from: startOfMonthYmd(today), to: today };
    case "30d":
    default:
      return lastNDays(30, timeZone);
  }
}

export const DASH_PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "last7", label: "Últimos 7 dias" },
  { value: "last30", label: "Últimos 30 dias" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "year", label: "Este ano" },
] as const;

export type DashPeriodKey =
  | (typeof DASH_PERIODS)[number]["value"]
  | "custom";

/** A range of the same length immediately preceding the given one. */
export function precedingRange(r: DateRange): DateRange {
  const fromD = new Date(`${r.from}T00:00:00Z`);
  const toD = new Date(`${r.to}T00:00:00Z`);
  const days = Math.round((toD.getTime() - fromD.getTime()) / 86400000) + 1;
  const prevTo = addDaysYmd(r.from, -1);
  const prevFrom = addDaysYmd(prevTo, -(days - 1));
  return { from: prevFrom, to: prevTo };
}

const YMD_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Resolve a dashboard period (preset or custom range) to current + previous
 * comparison ranges.
 */
export function dashboardRanges(
  period: string,
  timeZone: string,
  from?: string,
  to?: string,
): { current: DateRange; previous: DateRange } {
  const today = todayYmd(timeZone);

  switch (period) {
    case "yesterday": {
      const y = addDaysYmd(today, -1);
      const d = addDaysYmd(y, -1);
      return { current: { from: y, to: y }, previous: { from: d, to: d } };
    }
    case "last7": {
      const cur = lastNDays(7, timeZone);
      return { current: cur, previous: precedingRange(cur) };
    }
    case "last30": {
      const cur = lastNDays(30, timeZone);
      return { current: cur, previous: precedingRange(cur) };
    }
    case "week":
      return comparisonRanges("week", timeZone);
    case "month":
      return comparisonRanges("month", timeZone);
    case "year": {
      const cur = { from: `${today.slice(0, 4)}-01-01`, to: today };
      return { current: cur, previous: precedingRange(cur) };
    }
    case "custom": {
      const f = from && YMD_RE.test(from) ? from : today;
      const t = to && YMD_RE.test(to) ? to : today;
      const cur = f <= t ? { from: f, to: t } : { from: t, to: f };
      return { current: cur, previous: precedingRange(cur) };
    }
    case "today":
    default:
      return comparisonRanges("today", timeZone);
  }
}

/** Expand a range into an ordered list of yyyy-mm-dd strings. */
export function eachDay(range: DateRange): string[] {
  const out: string[] = [];
  let cur = range.from;
  let guard = 0;
  while (cur <= range.to && guard < 1000) {
    out.push(cur);
    cur = addDaysYmd(cur, 1);
    guard++;
  }
  return out;
}

/** Offset (ms) of `timeZone` from UTC at the given instant. */
function tzOffsetMs(date: Date, timeZone: string): number {
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts = dtf.formatToParts(date);
  const map: Record<string, number> = {};
  for (const p of parts) {
    if (p.type !== "literal") map[p.type] = Number(p.value);
  }
  const asUtc = Date.UTC(
    map.year,
    map.month - 1,
    map.day,
    map.hour === 24 ? 0 : map.hour,
    map.minute,
    map.second,
  );
  return asUtc - date.getTime();
}

/** UTC instant of local midnight (start of day) for `ymd` in `timeZone`. */
export function zonedDayStartUtc(ymd: string, timeZone: string): Date {
  const naive = new Date(`${ymd}T00:00:00Z`);
  const offset = tzOffsetMs(naive, timeZone);
  return new Date(naive.getTime() - offset);
}

/**
 * Half-open UTC window [start, end) covering the inclusive local-day range.
 * Useful to query timestamptz columns for a set of local days.
 */
export function zonedRangeUtc(
  range: DateRange,
  timeZone: string,
): { startUtc: string; endUtc: string } {
  const start = zonedDayStartUtc(range.from, timeZone);
  const end = zonedDayStartUtc(addDaysYmd(range.to, 1), timeZone);
  return { startUtc: start.toISOString(), endUtc: end.toISOString() };
}

export { addDaysYmd, startOfWeekYmd, startOfMonthYmd, endOfMonthYmd };
