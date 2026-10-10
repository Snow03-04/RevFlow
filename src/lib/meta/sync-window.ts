import { ymdInTz } from "@/lib/date";

/** A fixed recent window misses unfinished days when the app was offline.
 * Revisit the last successful sync day, with one prior day of overlap. */
export function metaSyncWindow(days: number, timezone: string, lastSyncedAt: string | null, now = new Date()) {
  const to = ymdInTz(now, timezone);
  const start = new Date(`${to}T12:00:00Z`);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const recent = { from: start.toISOString().slice(0, 10), to };
  const last = lastSyncedAt ? new Date(lastSyncedAt) : null;
  if (!last || !Number.isFinite(last.getTime()) || last > now) return { range: recent, historical: null };
  const lastDay = ymdInTz(last, timezone);
  if (lastDay >= recent.from) return { range: recent, historical: null };
  const cursor = new Date(`${lastDay}T12:00:00Z`);
  cursor.setUTCDate(cursor.getUTCDate() - 1);
  const from = cursor.toISOString().slice(0, 10);
  if (from >= recent.from) return { range: recent, historical: null };
  const end = new Date(`${recent.from}T12:00:00Z`);
  end.setUTCDate(end.getUTCDate() - 1);
  return { range: { from, to: recent.to }, historical: { from, to: end.toISOString().slice(0, 10) } };
}
