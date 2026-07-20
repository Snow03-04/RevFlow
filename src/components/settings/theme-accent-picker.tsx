"use client";

import { useEffect, useState } from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

type Accent = "purple" | "gold" | "cyan" | "pulse";

const OPTIONS: {
  id: Accent;
  name: string;
  desc: string;
  swatch: string;
}[] = [
  {
    id: "purple",
    name: "Purple",
    desc: "Roxo vibrante · default",
    swatch: "linear-gradient(135deg,#7c3aed 0%,#a78bfa 100%)",
  },
  {
    id: "gold",
    name: "Gold Premium",
    desc: "Dourado elegante",
    swatch: "linear-gradient(135deg,#D4AF37 0%,#C9A961 100%)",
  },
  {
    id: "cyan",
    name: "Cyan Ice",
    desc: "Turquesa fresco",
    swatch: "linear-gradient(135deg,#0891b2 0%,#22d3ee 100%)",
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
  const [accent, setAccent] = useState<Accent>("purple");

  useEffect(() => {
    // Match against the known options so adding a theme needs no change here.
    const cur = document.documentElement.getAttribute("data-accent");
    const known = OPTIONS.find((o) => o.id === cur);
    setAccent(known?.id ?? "purple");
  }, []);

  function choose(a: Accent) {
    setAccent(a);
    try {
      localStorage.setItem("revflow-accent", a);
    } catch {
      /* private mode — theme still applies for this session */
    }
    document.documentElement.setAttribute("data-accent", a);
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {OPTIONS.map((o) => {
        const active = accent === o.id;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => choose(o.id)}
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
