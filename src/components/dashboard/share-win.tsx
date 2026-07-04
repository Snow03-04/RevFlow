"use client";

import { useEffect, useState } from "react";
import { Share2, Camera, Copy, Check, TrendingUp, Loader2 } from "lucide-react";
import { Logo } from "@/components/brand";
import { Dialog, DialogTrigger, DialogContent } from "@/components/ui/dialog";
import { getShareWinStats, type WinStats } from "@/lib/dashboard/actions";
import { formatCurrency, formatCompact, cn } from "@/lib/utils";

const PERIOD_PT: Record<string, string> = {
  today: "Hoje",
  yesterday: "Ontem",
  last7: "Últimos 7 dias",
  last30: "Últimos 30 dias",
  week: "Esta semana",
  month: "Este mês",
  year: "Este ano",
};

/** A small always-green "up" marker (no number) — makes the card read as a win. */
function WinArrow() {
  return <TrendingUp className="h-4 w-4 shrink-0 text-emerald-400" aria-hidden />;
}

/**
 * A discreet "share" button (sits next to "Atualizar gastos" in the header) that
 * opens a premium, screenshot-ready "win" card with Revenue · Sessões ·
 * Encomendas. Data is fetched lazily on open. The card themes off the accent
 * tokens, so it looks premium in both the Purple and Gold themes.
 */
export function ShareWin({
  period,
  from,
  to,
}: {
  period: string;
  from?: string;
  to?: string;
}) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<WinStats | null>(null);
  const [loading, setLoading] = useState(false);
  const [copied, setCopied] = useState(false);
  const periodLabel = PERIOD_PT[period] ?? "Período";

  useEffect(() => {
    if (!open) return;
    let alive = true;
    setLoading(true);
    getShareWinStats(period, from, to).then((s) => {
      if (!alive) return;
      setStats(s);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [open, period, from, to]);

  function copySummary() {
    if (!stats) return;
    const text =
      `🏆 ${periodLabel}\n` +
      `Revenue: ${formatCurrency(stats.revenue, stats.currency)}\n` +
      `Sessões: ${formatCompact(stats.sessions)}\n` +
      `Encomendas: ${formatCompact(stats.orders)}`;
    navigator.clipboard?.writeText(text).then(
      () => {
        setCopied(true);
        setTimeout(() => setCopied(false), 1800);
      },
      () => {},
    );
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <button
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground"
          title="Partilhar um resumo para guardar como win"
        >
          <Share2 className="h-3.5 w-3.5" />
          Partilhar
        </button>
      </DialogTrigger>

      <DialogContent className="max-w-md border-0 bg-transparent p-0 shadow-none">
        <div className="win-card relative overflow-hidden rounded-3xl border border-white/10 p-7">
          {/* accent glow */}
          <div
            aria-hidden
            className="pointer-events-none absolute -right-10 -top-16 h-56 w-56 rounded-full blur-3xl"
            style={{
              background:
                "radial-gradient(circle, rgb(var(--accent-glow) / 0.40) 0%, transparent 70%)",
            }}
          />
          {/* faint grid */}
          <div className="bg-grid pointer-events-none absolute inset-0 opacity-[0.05]" />

          <div className="relative">
            {/* header — logo mark only (keep the top-right clear for close) */}
            <div className="flex items-center pr-8">
              <Logo showText={false} />
            </div>

            {loading || !stats ? (
              <div className="flex h-56 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-white/40" />
              </div>
            ) : (
              <>
                {/* revenue hero */}
                <div className="mt-7 flex items-center gap-2.5">
                  <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-white/45">
                    Revenue
                  </p>
                  <span className="rounded-full border border-white/10 bg-white/5 px-2.5 py-0.5 text-[11px] font-medium text-white/60">
                    {periodLabel}
                  </span>
                </div>
                <div className="mt-1 flex items-center gap-2">
                  <span className="win-metric text-5xl font-bold leading-none tabular-nums">
                    {formatCurrency(stats.revenue, stats.currency)}
                  </span>
                  <WinArrow />
                </div>

                {/* stats */}
                <div className="mt-7 grid grid-cols-2 gap-3">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-1.5">
                      <p className="text-2xl font-bold tabular-nums text-white">
                        {formatCompact(stats.sessions)}
                      </p>
                      <WinArrow />
                    </div>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-white/45">
                      Sessões
                    </p>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <div className="flex items-center gap-1.5">
                      <p className="text-2xl font-bold tabular-nums text-white">
                        {formatCompact(stats.orders)}
                      </p>
                      <WinArrow />
                    </div>
                    <p className="mt-1 text-[11px] font-semibold uppercase tracking-widest text-white/45">
                      Encomendas
                    </p>
                  </div>
                </div>

              </>
            )}
          </div>
        </div>

        {/* actions below the card (not part of the screenshot area) */}
        <div className="mt-3 flex items-center justify-center gap-4">
          <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
            <Camera className="h-3.5 w-3.5" /> Tira um print para guardar
          </span>
          <button
            onClick={copySummary}
            disabled={!stats}
            className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:text-foreground disabled:opacity-50"
          >
            {copied ? (
              <>
                <Check className="h-3.5 w-3.5 text-emerald-400" /> Copiado
              </>
            ) : (
              <>
                <Copy className="h-3.5 w-3.5" /> Copiar texto
              </>
            )}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
