import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Format a number as currency. */
export function formatCurrency(
  value: number | null | undefined,
  currency = "USD",
  opts: Intl.NumberFormatOptions = {},
): string {
  const n = Number(value ?? 0);
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    ...opts,
  }).format(n);
}

/** Compact currency, e.g. $12.3k */
export function formatCurrencyCompact(value: number, currency = "USD"): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(value ?? 0);
}

export function formatNumber(value: number | null | undefined): string {
  return new Intl.NumberFormat("en-US").format(Number(value ?? 0));
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return `${(Number(value ?? 0) * 100).toFixed(digits)}%`;
}

/** ROAS / MER style multipliers, e.g. 3.42x */
export function formatMultiplier(value: number | null | undefined, digits = 2): string {
  return `${Number(value ?? 0).toFixed(digits)}x`;
}

/** Percentage change between two values, as a fraction (0.12 == +12%). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return current ? null : 0; // null => "new" / no baseline
  return (current - previous) / Math.abs(previous);
}

export function toNumber(v: unknown, fallback = 0): number {
  const n = typeof v === "string" ? parseFloat(v) : Number(v);
  return Number.isFinite(n) ? n : fallback;
}
