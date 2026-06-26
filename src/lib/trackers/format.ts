/** Display helpers for the tracker grids. Null → "-" (suppressed div/0). */

export function money(v: number | null | undefined, symbol: string): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  const abs = Math.abs(v).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
  return `${v < 0 ? "-" : ""}${symbol}${abs}`;
}

export function pct(v: number | null | undefined, digits = 1): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${(v * 100).toFixed(digits)}%`;
}

export function mult(v: number | null | undefined, digits = 2): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return `${v.toFixed(digits)}x`;
}

export function num(v: number | null | undefined): string {
  if (v === null || v === undefined || Number.isNaN(v)) return "-";
  return v.toLocaleString("en-US");
}

/** Colour classes for the conditional bands shared across trackers. */
export const bandText: Record<string, string> = {
  good: "text-emerald-400",
  warn: "text-amber-400",
  bad: "text-red-400",
  scale: "text-emerald-400",
  maintain: "text-amber-400",
  watch: "text-purple-400",
  monitor: "text-orange-400",
  new: "text-sky-400",
  window: "text-muted-foreground",
  kill: "text-red-400",
  empty: "text-muted-foreground",
  none: "text-muted-foreground",
};

export const bandBg: Record<string, string> = {
  good: "bg-emerald-500/10",
  warn: "bg-amber-500/10",
  bad: "bg-red-500/10",
  scale: "bg-emerald-500/10",
  maintain: "bg-amber-500/10",
  watch: "bg-purple-500/10",
  monitor: "bg-orange-500/10",
  new: "bg-sky-500/10",
  window: "bg-muted/40",
  kill: "bg-red-500/10",
  empty: "",
  none: "",
};
