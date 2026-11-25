"use client";

import { useSyncExternalStore, type ReactNode } from "react";
import { EyeOff, Globe } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  privateFigures, setPrivateFigures, subscribePrivateFigures,
  privateGlobe, setPrivateGlobe, subscribePrivateGlobe,
} from "@/lib/appearance";

/**
 * One privacy choice of this device (see deviceSwitch in lib/appearance.ts): it
 * is written to localStorage and to <html data-…>, so it applies at once and
 * before the next page paints.
 */
function DeviceSwitch({ title, description, icon, read, write, subscribe }: {
  title: string;
  description: string;
  icon: ReactNode;
  read: () => boolean;
  write: (on: boolean) => void;
  subscribe: (onChange: () => void) => () => void;
}) {
  const on = useSyncExternalStore(subscribe, read, () => false);

  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => write(!on)}
      className={cn(
        "flex w-full items-center gap-4 rounded-xl border p-4 text-left transition-colors",
        on ? "border-primary ring-1 ring-primary" : "border-border hover:border-foreground/25",
      )}
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground ring-1 ring-white/10">
        {icon}
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium">{title}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
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

/** Blur profit on the dashboard until it is hovered. It does not touch the live globe. */
export function PrivateFiguresToggle() {
  return (
    <DeviceSwitch
      title="Esconder o lucro no dashboard"
      description="O lucro e a margem ficam desfocados e só se leem com o rato por cima. No telemóvel aparecem sempre."
      icon={<EyeOff className="h-4 w-4" aria-hidden="true" />}
      read={privateFigures}
      write={setPrivateFigures}
      subscribe={subscribePrivateFigures}
    />
  );
}

/** Take every figure off the live globe. It does not touch the dashboard. */
export function PrivateGlobeToggle() {
  return (
    <DeviceSwitch
      title="Esconder os valores no globo ao vivo"
      description="A faturação, os indicadores e os gráficos saem do globo e os valores das encomendas ficam tapados. Nem o rato nem o olho do globo os mostram."
      icon={<Globe className="h-4 w-4" aria-hidden="true" />}
      read={privateGlobe}
      write={setPrivateGlobe}
      subscribe={subscribePrivateGlobe}
    />
  );
}
