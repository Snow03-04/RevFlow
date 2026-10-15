import { formatCurrency } from "@/lib/utils";
import { PlatformLogo } from "./platform-logo";

/** Platform details complement the advertising total in the cost breakdown. */
export function AdPlatformBreakdown({ meta, google, currency, googlePending = false, googleEstimated = false, googleOverspend = 0 }: {
  meta: number;
  google: number;
  currency: string;
  googlePending?: boolean;
  googleEstimated?: boolean;
  googleOverspend?: number;
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
            <span className="relative flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-muted-foreground">{label}
              {platform === "google" && googleOverspend > 0 && <span className="rounded border border-amber-500/30 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-600 dark:text-amber-400">Overspend</span>}
            </span>
            <span className="relative ml-auto shrink-0 font-medium tabular-nums">{platform === "google" && googlePending && value === 0 ? "Por atualizar" : formatCurrency(value, currency)}{platform === "google" && googlePending && !googleEstimated && value !== 0 ? " (parcial)" : ""}</span>
            <span className="relative w-9 text-right text-xs tabular-nums text-muted-foreground">{googlePending ? "—" : `${total > 0 ? ((value / total) * 100).toFixed(0) : "0"}%`}</span>
          </div>
        ))}
      </div>
      {googleEstimated && <p className="mt-2 text-xs text-muted-foreground">Inclui gasto Google antes dos créditos por confirmar.</p>}
      {googleOverspend > 0 && <p className="mt-2 text-xs text-muted-foreground">O relatório de faturação confirma {formatCurrency(googleOverspend, currency)} de gasto não cobrado. Esse excesso não entra nos custos. Gasto posterior ao relatório aguarda confirmação.</p>}
    </div>
  );
}
