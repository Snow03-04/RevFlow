"use client";

import { useId } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  formatCurrency,
  formatCurrencyCompact,
  formatMultiplier,
  formatNumber,
} from "@/lib/utils";

export type ChartFormat = "currency" | "number" | "multiplier";

export interface ChartPoint {
  date: string;
  value: number;
}

function fmt(value: number, format: ChartFormat, currency: string): string {
  if (format === "currency") return formatCurrency(value, currency);
  if (format === "multiplier") return formatMultiplier(value);
  return formatNumber(value);
}

function shortDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function CustomTooltip({
  active,
  payload,
  label,
  format,
  currency,
}: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-popover px-3 py-2 text-xs shadow-md">
      <p className="mb-1 font-medium text-muted-foreground">
        {shortDate(label)}
      </p>
      <p className="font-semibold">
        {fmt(payload[0].value, format, currency)}
      </p>
    </div>
  );
}

export function MetricChart({
  data,
  format = "currency",
  currency = "USD",
  color = "hsl(var(--primary))",
  type = "area",
  height = 240,
}: {
  data: ChartPoint[];
  format?: ChartFormat;
  currency?: string;
  color?: string;
  type?: "area" | "bar";
  height?: number;
}) {
  const gradientId = `grad-${useId().replace(/:/g, "")}`;

  const yTickFmt = (v: number) =>
    format === "currency"
      ? formatCurrencyCompact(v, currency)
      : format === "multiplier"
        ? formatMultiplier(v, 1)
        : formatNumber(v);

  const axisProps = {
    stroke: "hsl(var(--muted-foreground))",
    fontSize: 11,
    tickLine: false,
    axisLine: false,
  };

  return (
    <ResponsiveContainer width="100%" height={height}>
      {type === "area" ? (
        <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={yTickFmt} width={56} {...axisProps} />
          <Tooltip
            content={<CustomTooltip format={format} currency={currency} />}
            cursor={{ stroke: "hsl(var(--border))" }}
          />
          <Area
            type="monotone"
            dataKey="value"
            stroke={color}
            strokeWidth={2}
            fill={`url(#${gradientId})`}
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
          />
        </AreaChart>
      ) : (
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid
            strokeDasharray="3 3"
            vertical={false}
            stroke="hsl(var(--border))"
          />
          <XAxis dataKey="date" tickFormatter={shortDate} minTickGap={24} {...axisProps} />
          <YAxis tickFormatter={yTickFmt} width={56} {...axisProps} />
          <Tooltip
            content={<CustomTooltip format={format} currency={currency} />}
            cursor={{ fill: "hsl(var(--muted))", opacity: 0.4 }}
          />
          <Bar dataKey="value" fill={color} radius={[4, 4, 0, 0]} />
        </BarChart>
      )}
    </ResponsiveContainer>
  );
}
