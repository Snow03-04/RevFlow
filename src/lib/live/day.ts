/** The oldest day the live globe will replay. Nothing in the app is older. */
const FIRST_DAY = "2015-01-01";

/**
 * The day a replay was asked for, or null when it is not one: a real calendar
 * date written yyyy-mm-dd, not before FIRST_DAY and not after `today` (the
 * account's own today).
 */
export function replayableDay(value: string | null | undefined, today: string): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00Z`);
  // 2026-02-31 parses to March: a date that does not round-trip never existed.
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value) return null;
  return value >= FIRST_DAY && value <= today ? value : null;
}
