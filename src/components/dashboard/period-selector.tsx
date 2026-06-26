"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { CalendarDays } from "lucide-react";
import { DASH_PERIODS } from "@/lib/date";
import { RangeCalendar } from "@/components/dashboard/range-calendar";
import { cn } from "@/lib/utils";

export function PeriodSelector({
  period,
  from,
  to,
}: {
  period: string;
  from?: string;
  to?: string;
}) {
  const router = useRouter();
  const [showCustom, setShowCustom] = useState(false);

  function pick(value: string) {
    setShowCustom(false);
    router.push(`/dashboard?period=${value}`);
  }

  function applyCustom(f: string, t: string) {
    setShowCustom(false);
    router.push(`/dashboard?period=custom&from=${f}&to=${t}`);
  }

  return (
    <div className="relative flex flex-col gap-2">
      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        {DASH_PERIODS.map((p) => (
          <button
            key={p.value}
            onClick={() => pick(p.value)}
            className={cn(
              "whitespace-nowrap rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
              period === p.value
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
            period === "custom" || showCustom
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
            onApply={applyCustom}
            onCancel={() => setShowCustom(false)}
          />
        </div>
      )}
    </div>
  );
}
