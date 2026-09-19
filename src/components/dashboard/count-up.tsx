"use client";

import { useEffect, useRef, useState } from "react";
import {
  formatCurrency,
  formatNumber,
  formatPercent,
  formatMultiplier,
} from "@/lib/utils";

export type CountUpFormat = "currency" | "number" | "percent" | "multiplier";

function fmt(n: number, format: CountUpFormat, currency: string): string {
  switch (format) {
    case "currency":
      return formatCurrency(n, currency);
    case "percent":
      return formatPercent(n);
    case "multiplier":
      return formatMultiplier(n);
    default:
      return formatNumber(n);
  }
}

/**
 * Renders the actual value on first paint, then animates from the previous value to the
 * new value whenever `value` changes (e.g. switching period). Uses rAF with an
 * easeOutCubic curve and respects prefers-reduced-motion.
 *
 * Takes only serializable props (no function) so it can be rendered directly by
 * Server Components; formatting happens here on the client via the shared helpers.
 */
export function CountUp({
  value,
  format = "currency",
  currency = "EUR",
  durationMs = 900,
  className,
  style,
}: {
  value: number;
  format?: CountUpFormat;
  currency?: string;
  durationMs?: number;
  className?: string;
  style?: React.CSSProperties;
}) {
  const [display, setDisplay] = useState(value);
  const fromRef = useRef(value);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    const reduce =
      typeof window !== "undefined" &&
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const from = fromRef.current;

    if (reduce || from === value || durationMs <= 0) {
      setDisplay(value);
      fromRef.current = value;
      return;
    }

    const start = performance.now();
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const eased = 1 - Math.pow(1 - t, 3); // easeOutCubic
      fromRef.current = from + (value - from) * eased;
      setDisplay(fromRef.current);
      if (t < 1) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        setDisplay(value);
        fromRef.current = value;
      }
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [value, durationMs]);

  return (
    <span className={className} style={style}>
      <span className="sr-only">{fmt(value, format, currency)}</span>
      <span aria-hidden="true">{fmt(display, format, currency)}</span>
    </span>
  );
}
