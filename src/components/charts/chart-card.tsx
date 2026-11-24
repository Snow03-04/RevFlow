"use client";

import dynamic from "next/dynamic";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { ChartFormat, ChartPoint } from "@/components/charts/metric-chart";

// Recharts is heavy — defer it off the initial bundle and render it on the
// client only (with a light skeleton) so the dashboard paints fast.
const MetricChart = dynamic(
  () => import("@/components/charts/metric-chart").then((m) => m.MetricChart),
  {
    ssr: false,
    loading: () => <div className="h-[240px] w-full animate-pulse rounded-lg bg-muted/40" />,
  },
);

export function ChartCard({
  title,
  subtitle,
  data,
  format,
  color,
  type = "area",
  currency = "USD",
  privateFigure = false,
}: {
  title: string;
  subtitle?: string;
  data: ChartPoint[];
  format: ChartFormat;
  color?: string;
  type?: "area" | "bar";
  currency?: string;
  /** Blur the chart until the card is hovered (profit figures). */
  privateFigure?: boolean;
}) {
  return (
    <Card className={privateFigure ? "private-scope" : undefined}>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className={privateFigure ? "private-figure pl-2" : "pl-2"} data-private={privateFigure ? "chart" : undefined}>
        <MetricChart
          data={data}
          format={format}
          color={color}
          type={type}
          currency={currency}
        />
      </CardContent>
    </Card>
  );
}
