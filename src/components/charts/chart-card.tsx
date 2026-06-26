import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  MetricChart,
  type ChartFormat,
  type ChartPoint,
} from "@/components/charts/metric-chart";

export function ChartCard({
  title,
  subtitle,
  data,
  format,
  color,
  type = "area",
  currency = "USD",
}: {
  title: string;
  subtitle?: string;
  data: ChartPoint[];
  format: ChartFormat;
  color?: string;
  type?: "area" | "bar";
  currency?: string;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-base">{title}</CardTitle>
        {subtitle && (
          <p className="text-xs text-muted-foreground">{subtitle}</p>
        )}
      </CardHeader>
      <CardContent className="pl-2">
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
