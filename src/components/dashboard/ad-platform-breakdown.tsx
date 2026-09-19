import { formatCurrency } from "@/lib/utils";
import { PlatformLogo } from "./platform-logo";

/** Platform details complement the advertising total in the cost breakdown. */
export function AdPlatformBreakdown({ meta, google, currency }: {
  meta: number;
  google: number;
  currency: string;
}) {
  const total = meta + google;
  return (
    <div className="rounded-xl border border-border bg-card p-5">
      <h3 className="text-xs font-medium text-muted-foreground">Publicidade por plataforma</h3>
      <div className="mt-3 divide-y divide-border">
        {[{ platform: "meta" as const, label: "Meta Ads", value: meta, color: "#1877F2" }, { platform: "google" as const, label: "Google Ads", value: google, color: "#94a3b8" }].map(({ platform, label, value, color }) => (
          <div key={label} className="relative isolate flex items-center gap-3 overflow-hidden py-3 text-sm">
            <PlatformLogo platform={platform} className="pointer-events-none absolute left-[38%] top-1/2 -z-10 h-16 w-16 -translate-y-1/2 text-foreground/[0.07]" />
            <PlatformLogo platform={platform} className="h-4 w-4 shrink-0" style={{ color }} />
            <span className="relative text-muted-foreground">{label}</span>
            <span className="relative ml-auto font-medium tabular-nums">{formatCurrency(value, currency)}</span>
            <span className="relative w-9 text-right text-xs tabular-nums text-muted-foreground">{total > 0 ? ((value / total) * 100).toFixed(0) : "0"}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}
