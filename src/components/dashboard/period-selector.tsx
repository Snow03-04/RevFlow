"use client";

import { useState } from "react";
import { CalendarDays } from "lucide-react";
import { DASH_PERIODS } from "@/lib/date";
import { RangeCalendar } from "@/components/dashboard/range-calendar";
import { cn } from "@/lib/utils";

/**
 * Dumb/controlled period buttons. The parent owns navigation + the pending
 * state (so the metrics can swap to a skeleton the instant a period is picked);
 * this component just highlights `active` and reports clicks.
 */
export function PeriodSelector({
  active,
  from,
  to,
  onPick,
  onCustom,
}: {
  active: string;
  from?: string;
  to?: string;
  onPick: (value: string) => void;
  onCustom: (from: string, to: string) => void;
}) {
  const [showCustom, setShowCustom] = useState(false);

  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {DASH_PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => {
              setShowCustom(false);
              onPick(p.value);
            }}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              active === p.value
                ? "bg-primary/15 text-primary"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {p.label}
          </button>
        ))}
        <button
          onClick={() => setShowCustom((s) => !s)}
          className={cn(
            "flex items-center gap-1.5 whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
            active === "custom" || showCustom
              ? "bg-primary/15 text-primary"
              : "text-muted-foreground hover:bg-accent hover:text-foreground",
          )}
        >
          <CalendarDays className="h-4 w-4" />
          Personalizado
        </button>
      </div>

      {showCustom && (
        <div className="absolute right-0 top-full z-50 mt-2">
          <RangeCalendar
            initialFrom={from}
            initialTo={to}
            onApply={(f, t) => {
              setShowCustom(false);
              onCustom(f, t);
            }}
            onCancel={() => setShowCustom(false)}
          />
        </div>
      )}
    </div>
  );
}
