"use client";

import { useSyncExternalStore } from "react";
import { EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { privateFigures, setPrivateFigures, subscribePrivateFigures } from "@/lib/appearance";

/**
 * Blur profit on the dashboard until it is hovered. A device preference like
 * the accent: it is written to localStorage and <html data-private-figures>, so
 * it applies at once and before the next page paints.
 */
export function PrivateFiguresToggle() {
  const on = useSyncExternalStore(subscribePrivateFigures, privateFigures, () => false);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => setPrivateFigures(!on)}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors",
        on ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/25",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-white/10">
        <EyeOff className="h-4 w-4" aria-hidden="true" />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">Esconder o lucro no dashboard</span>
        <span className="block text-xs text-muted-foreground">
          O lucro e a margem ficam desfocados e só se leem com o rato por cima. No telemóvel aparecem sempre.
        </span>
      </span>
      <span
        aria-hidden="true"
        className={cn("relative ml-auto h-6 w-11 shrink-0 rounded-full transition-colors", on ? "bg-primary" : "bg-muted")}
      >
        <span
          className={cn(
            "absolute top-0.5 h-5 w-5 rounded-full shadow transition-[left,background-color]",
            on ? "left-[22px] bg-background" : "left-0.5 bg-muted-foreground",
          )}
        />
      </span>
    </button>
  );
}
