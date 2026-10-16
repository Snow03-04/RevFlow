"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronLeft, ChevronRight, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

export function RoasNavigation({ year, month, day, view, today }: {
  year: number; month: number; day: number; view: string; today: string;
}) {
  const router = useRouter();
  const isDay = view !== "weekly" && view !== "settings";
  const date = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const href = (value: string, nextView = view) => {
    const [y, m, d] = value.split("-").map(Number);
    return `/roas?view=${nextView}&year=${y}&month=${m}&day=${d || Math.min(day, new Date(y, m, 0).getDate())}`;
  };
  const adjacent = (offset: number) => {
    const value = isDay ? new Date(Date.UTC(year, month - 1, day + offset))
      : new Date(Date.UTC(year, month - 1 + offset, 1));
    return href(value.toISOString().slice(0, isDay ? 10 : 7));
  };

  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <nav aria-label="Vistas do ROAS Tracker" className="inline-flex rounded-xl border border-border bg-card p-1">
        {[
          { key: "day", label: "Diário" },
          { key: "weekly", label: "Semanal" },
          { key: "settings", label: "Regras" },
        ].map((tab) => (
          <Link key={tab.key} href={href(date, tab.key)} aria-current={(isDay ? "day" : view) === tab.key ? "page" : undefined}
            className={cn("inline-flex min-h-10 items-center gap-2 rounded-lg px-4 text-sm font-medium transition-colors",
              (isDay ? "day" : view) === tab.key ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {tab.key === "settings" && <SlidersHorizontal className="h-3.5 w-3.5" />}{tab.label}
          </Link>
        ))}
      </nav>
      <div className="flex w-full items-center gap-2 sm:w-auto">
        <div className="flex min-w-0 flex-1 items-center rounded-xl border border-border bg-card sm:flex-none">
          <Link href={adjacent(-1)} aria-label={isDay ? "Dia anterior" : "Mês anterior"}
            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-l-xl text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronLeft className="h-4 w-4" />
          </Link>
          <input type={isDay ? "date" : "month"} aria-label={isDay ? "Escolher dia" : "Escolher mês"}
            value={isDay ? date : date.slice(0, 7)}
            onChange={(event) => {
              const value = event.target.value;
              if (/^\d{4}-\d{2}(-\d{2})?$/.test(value)) router.push(href(value));
            }}
            className="h-11 min-w-0 flex-1 bg-transparent px-1 text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-primary dark:[color-scheme:dark] sm:w-40" />
          <Link href={adjacent(1)} aria-label={isDay ? "Dia seguinte" : "Mês seguinte"}
            className="flex h-11 w-10 shrink-0 items-center justify-center rounded-r-xl text-muted-foreground hover:bg-muted hover:text-foreground">
            <ChevronRight className="h-4 w-4" />
          </Link>
        </div>
        <Link href={href(today, "day")} className="inline-flex h-11 items-center rounded-xl border border-border px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground">Hoje</Link>
      </div>
    </div>
  );
}
