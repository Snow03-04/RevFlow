"use client";

import type { CSSProperties } from "react";
import { CountUp } from "@/components/dashboard/count-up";
import { profitMilestone } from "@/lib/profit-milestones";
import { cn, formatCurrency } from "@/lib/utils";

export function HeroMetric({ value, currency, profit = false, daily = false }: {
  value: number;
  currency: string;
  profit?: boolean;
  daily?: boolean;
}) {
  const milestone = profitMilestone(value);
  const level = profit && daily ? milestone.level : 0;
  const stage = level > 0 ? milestone.style : "base";
  const rising = profit && daily && value > 0 && value < 200;
  const color = !profit ? "var(--primary)" : value < 0 ? "var(--profit-negative)" : stage === "violet" ? "var(--profit-violet)" : stage === "gold" || stage === "champagne" ? "var(--profit-gold)" : rising ? "var(--profit-live)" : "var(--profit)";

  return (
    <div
      data-profit-level={profit ? level : undefined}
      data-profit-style={profit ? stage : undefined}
      data-profit-rising={rising ? "true" : undefined}
      title={profit && level > 0 ? `${milestone.label} · ${formatCurrency(milestone.reached, currency)} de lucro diário` : undefined}
      className={cn("kpi-hero relative min-w-0 overflow-hidden rounded-xl border bg-card p-5", profit && "profit-card")}
      style={{
        "--card-accent": color,
        "--profit-energy": Math.max(0, Math.min(value / 200, 1)),
        "--profit-intensity": Math.min(0.12 + level * 0.04, 0.5),
        "--profit-duration": `${Math.max(4, 8 - level * 0.35)}s`,
        "--profit-shimmer-duration": `${Math.max(4, 8 - level * 0.35)}s`,
        backgroundImage: "linear-gradient(115deg, hsl(var(--card-accent) / 0.07), transparent 72%)",
        borderColor: "hsl(var(--card-accent) / 0.3)",
      } as CSSProperties}
    >
      {profit && daily && value > 0 && (
        <div key={level} className="profit-effects pointer-events-none absolute inset-0" aria-hidden="true">
          <div className="profit-aura" />
          {value >= 200 && <div className="profit-edge" />}
          {level >= 2 && <div className="profit-sweep" />}
          {level >= 5 && <div className="profit-sparks">{Array.from({ length: Math.min(level - 1, 8) }, (_, index) => <i key={index} style={{ "--spark": index } as CSSProperties} />)}</div>}
        </div>
      )}
      <div className="relative flex items-center gap-2">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: `hsl(${color})` }} />
        <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{profit ? "Lucro estimado" : "Receita"}</p>
      </div>
      <CountUp
        value={value}
        currency={currency}
        className={cn("relative mt-3 block break-words text-[28px] font-semibold leading-none tracking-tight tabular-nums sm:text-3xl", profit ? "profit-number" : "metric-gold")}
        style={{ color: `hsl(${color})` }}
      />
    </div>
  );
}
