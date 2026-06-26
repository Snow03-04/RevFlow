"use client";

import { useRef, useCallback } from "react";
import { cn } from "@/lib/utils";

/** Debounced autosave: coalesce rapid edits to one write per key. */
export function useDebouncedSave(delay = 700) {
  const timers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  return useCallback(
    (key: string, fn: () => void) => {
      if (timers.current[key]) clearTimeout(timers.current[key]);
      timers.current[key] = setTimeout(fn, delay);
    },
    [delay],
  );
}

/** Blue editable numeric input cell. */
export function NumCell({
  value,
  onChange,
  align = "right",
  step = "0.01",
}: {
  value: number;
  onChange: (v: number) => void;
  align?: "right" | "left";
  step?: string;
}) {
  return (
    <input
      type="number"
      step={step}
      value={Number.isFinite(value) && value !== 0 ? value : value === 0 ? "" : ""}
      placeholder="0"
      onChange={(e) => onChange(e.target.value === "" ? 0 : parseFloat(e.target.value))}
      onFocus={(e) => e.target.select()}
      className={cn(
        "w-full min-w-[72px] bg-sky-500/10 px-2 py-1.5 text-xs tabular-nums outline-none transition-colors focus:bg-sky-500/20 focus:ring-1 focus:ring-sky-400/50",
        // Hide the native number spinner arrows so they don't clip the value.
        "[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none",
        align === "right" ? "text-right" : "text-left",
      )}
    />
  );
}

/** Blue editable text input cell. */
export function TextCell({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="text"
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-full bg-sky-500/10 px-2 py-1.5 text-xs outline-none transition-colors focus:bg-sky-500/20 focus:ring-1 focus:ring-sky-400/50"
    />
  );
}

/** Yellow editable assumption input (percent shown as whole number). */
export function PctCell({
  value,
  onChange,
}: {
  value: number; // fraction
  onChange: (v: number) => void;
}) {
  return (
    <div className="inline-flex items-center rounded-md bg-amber-500/15 px-2 py-1">
      <input
        type="number"
        step="0.1"
        value={+(value * 100).toFixed(2)}
        onChange={(e) =>
          onChange(e.target.value === "" ? 0 : parseFloat(e.target.value) / 100)
        }
        onFocus={(e) => e.target.select()}
        className="w-14 bg-transparent text-right text-sm tabular-nums outline-none"
      />
      <span className="ml-0.5 text-sm text-amber-400/80">%</span>
    </div>
  );
}
