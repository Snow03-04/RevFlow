"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

const MONTHS_PT = [
  "janeiro",
  "fevereiro",
  "março",
  "abril",
  "maio",
  "junho",
  "julho",
  "agosto",
  "setembro",
  "outubro",
  "novembro",
  "dezembro",
];
const WEEKDAYS_PT = ["do", "se", "te", "qu", "qu", "se", "sá"];

function pad(n: number) {
  return String(n).padStart(2, "0");
}
function ymd(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function atMidnight(d: Date) {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}
function parseYmd(s?: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split("-").map(Number);
  return new Date(y, m - 1, d);
}
function sameDay(a: Date, b: Date) {
  return (
    a.getFullYear() === b.getFullYear() &&
    a.getMonth() === b.getMonth() &&
    a.getDate() === b.getDate()
  );
}

/** Build a 6-row × 7-col grid of dates (Sunday-first) for a month. */
function monthGrid(year: number, month: number): (Date | null)[] {
  const first = new Date(year, month, 1);
  const start = first.getDay(); // 0 = Sunday
  const days = new Date(year, month + 1, 0).getDate();
  const cells: (Date | null)[] = [];
  for (let i = 0; i < start; i++) cells.push(null);
  for (let d = 1; d <= days; d++) cells.push(new Date(year, month, d));
  while (cells.length % 7 !== 0) cells.push(null);
  return cells;
}

function MonthView({
  year,
  month,
  from,
  to,
  maxDate,
  onPick,
}: {
  year: number;
  month: number;
  from: Date | null;
  to: Date | null;
  maxDate: Date;
  onPick: (d: Date) => void;
}) {
  const cells = monthGrid(year, month);
  return (
    <div className="w-[252px]">
      <p className="mb-3 text-center text-sm font-medium">
        {MONTHS_PT[month]} {year}
      </p>
      <div className="grid grid-cols-7 gap-y-1 text-center text-[11px] text-muted-foreground">
        {WEEKDAYS_PT.map((w, i) => (
          <span key={i}>{w}</span>
        ))}
      </div>
      <div className="mt-1 grid grid-cols-7 gap-y-1">
        {cells.map((d, i) => {
          if (!d) return <span key={i} />;
          const disabled = atMidnight(d) > maxDate;
          const isFrom = from && sameDay(d, from);
          const isTo = to && sameDay(d, to);
          const inRange =
            from && to && atMidnight(d) > from && atMidnight(d) < to;
          const endpoint = isFrom || isTo;
          return (
            <button
              key={i}
              disabled={disabled}
              onClick={() => onPick(d)}
              className={cn(
                "mx-auto flex h-9 w-9 items-center justify-center rounded-md text-sm transition-colors",
                disabled && "cursor-not-allowed text-muted-foreground/30",
                !disabled && !endpoint && !inRange && "hover:bg-accent",
                inRange && "bg-primary/15 text-primary",
                endpoint && "bg-primary font-medium text-primary-foreground",
              )}
            >
              {d.getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function RangeCalendar({
  initialFrom,
  initialTo,
  onApply,
  onCancel,
}: {
  initialFrom?: string;
  initialTo?: string;
  onApply: (from: string, to: string) => void;
  onCancel: () => void;
}) {
  const today = atMidnight(new Date());
  const [from, setFrom] = useState<Date | null>(parseYmd(initialFrom));
  const [to, setTo] = useState<Date | null>(parseYmd(initialTo));

  // Left month defaults to the month before the current selection / today.
  const anchor = parseYmd(initialTo) ?? new Date();
  const [left, setLeft] = useState({
    year: anchor.getMonth() === 0 ? anchor.getFullYear() - 1 : anchor.getFullYear(),
    month: anchor.getMonth() === 0 ? 11 : anchor.getMonth() - 1,
  });

  const rightMonth = left.month === 11 ? 0 : left.month + 1;
  const rightYear = left.month === 11 ? left.year + 1 : left.year;

  function pick(d: Date) {
    const day = atMidnight(d);
    if (!from || (from && to)) {
      setFrom(day);
      setTo(null);
    } else if (day >= from) {
      setTo(day);
    } else {
      setTo(from);
      setFrom(day);
    }
  }

  function shift(delta: number) {
    setLeft((prev) => {
      const m = prev.month + delta;
      const d = new Date(prev.year, m, 1);
      return { year: d.getFullYear(), month: d.getMonth() };
    });
  }

  function apply() {
    if (!from) return;
    onApply(ymd(from), ymd(to ?? from));
  }

  const label = (d: Date | null) =>
    d
      ? d.toLocaleDateString("pt-PT", {
          day: "numeric",
          month: "long",
          year: "numeric",
        })
      : "—";

  return (
    <div className="rounded-xl border border-border bg-popover p-4 shadow-xl">
      <div className="mb-4 flex items-center justify-between gap-3 text-sm">
        <span className="rounded-md border border-input px-3 py-1.5">{label(from)}</span>
        <span className="text-muted-foreground">→</span>
        <span className="rounded-md border border-input px-3 py-1.5">{label(to ?? from)}</span>
      </div>

      <div className="relative flex gap-6">
        <button
          onClick={() => shift(-1)}
          className="absolute left-0 top-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <button
          onClick={() => shift(1)}
          className="absolute right-0 top-0 rounded-md p-1 text-muted-foreground hover:bg-accent"
        >
          <ChevronRight className="h-4 w-4" />
        </button>
        <MonthView year={left.year} month={left.month} from={from} to={to} maxDate={today} onPick={pick} />
        <div className="w-px bg-border" />
        <MonthView year={rightYear} month={rightMonth} from={from} to={to} maxDate={today} onPick={pick} />
      </div>

      <div className="mt-4 flex justify-end gap-2">
        <Button variant="outline" size="sm" onClick={onCancel}>
          Cancelar
        </Button>
        <Button size="sm" onClick={apply} disabled={!from}>
          Aplicar
        </Button>
      </div>
    </div>
  );
}
