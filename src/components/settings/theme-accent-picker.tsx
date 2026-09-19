"use client";

import { useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

import { currentAccent, DEFAULT_ACCENT, setAccent, subscribeAccent, type Accent } from "@/lib/appearance";

const OPTIONS: {
  id: Accent;
  name: string;
  desc: string;
  swatch: string;
}[] = [
  {
    id: "cyan",
    name: "Cyan Clean",
    desc: "Minimalista · tema principal",
    swatch: "linear-gradient(135deg,#122025 50%,#5bd5e5 50%)",
  },
  {
    id: "purple",
    name: "Purple",
    desc: "Roxo vibrante",
    swatch: "linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%)",
  },
  {
    id: "gold",
    name: "Gold Premium",
    desc: "Dourado elegante",
    swatch: "linear-gradient(135deg,#D4AF37 0%,#C9A961 100%)",
  },
  {
    id: "pulse",
    name: "Neon Pulse",
    desc: "Cyan + lucro lima neon",
    swatch: "linear-gradient(135deg,#4DC2E0 0%,#B8FF3D 100%)",
  },
];

/**
 * Accent theme switcher. Writes to localStorage + the <html data-accent> attribute
 * so the whole app recolours instantly (every accent is an hsl(var(--…)) token) —
 * no reload, no server round-trip.
 */
export function ThemeAccentPicker() {
  const accent = useSyncExternalStore(subscribeAccent, currentAccent, () => DEFAULT_ACCENT);

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {OPTIONS.map((o) => {
        const active = accent === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => setAccent(o.id)}
            aria-pressed={active}
            className={cn(
              "group relative flex items-center gap-4 rounded-xl border p-4 text-left transition-colors",
              active
                ? "border-primary ring-1 ring-primary"
                : "border-border hover:border-foreground/25",
            )}
          >
            <span
              className="h-10 w-10 shrink-0 rounded-lg ring-1 ring-white/10"
              style={{ backgroundImage: o.swatch }}
            />
            <div className="min-w-0">
              <p className="text-sm font-medium">{o.name}</p>
              <p className="text-xs text-muted-foreground">{o.desc}</p>
            </div>
            {active && <Check className="ml-auto h-4 w-4 shrink-0 text-primary" />}
          </button>
        );
      })}
    </div>
  );
}
