import type { DateRange } from "@/types";
import { addDaysYmd, eachDay, ymdInTz } from "@/lib/date";

/** An updated order can belong to an old day, or move between days. Even
 * when a caller handles recent totals, historical days still need refreshing. */
export function shopifySyncRanges(
  recent: DateRange,
  processedDates: Iterable<string>,
  timezone: string,
  skipRecent = false,
): DateRange[] {
  const days = new Set(skipRecent ? [] : eachDay(recent));
  for (const timestamp of processedDates) {
    const date = ymdInTz(new Date(timestamp), timezone);
    if (!skipRecent || date < recent.from || date > recent.to) days.add(date);
  }
  const ranges: DateRange[] = [];
  for (const day of [...days].sort()) {
    const last = ranges.at(-1);
    // Month boundaries bound the size of history queries and writes.
    if (
      last &&
      last.to.slice(0, 7) === day.slice(0, 7) &&
      addDaysYmd(last.to, 1) === day
    ) {
      last.to = day;
    } else ranges.push({ from: day, to: day });
  }
  return ranges;
}
