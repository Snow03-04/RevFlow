"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, BellRing, Check, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { readSubscriptionAlert } from "@/lib/subscriptions/actions";
import type { SubscriptionAlert } from "@/lib/subscriptions/model";
import { cn } from "@/lib/utils";

export function SubscriptionNotifications() {
  const [alerts, setAlerts] = useState<SubscriptionAlert[]>([]);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const pending = useRef<AbortController | null>(null);
  const refresh = useCallback(async () => {
    if (document.visibilityState === "hidden" || pending.current) return;
    const controller = new AbortController(); pending.current = controller;
    const timeout = setTimeout(() => controller.abort(), 15_000);
    try {
      const response = await fetch("/api/subscriptions/notifications", { cache: "no-store", signal: controller.signal });
      if (!response.ok) throw new Error("Não foi possível verificar os avisos. Tenta novamente.");
      const data = await response.json(); setAlerts(data.alerts); setError("");
    } catch { if (pending.current === controller) setError("Não foi possível verificar os avisos. Tenta novamente."); }
    finally { clearTimeout(timeout); if (pending.current === controller) { pending.current = null; setLoading(false); } }
  }, []);
  useEffect(() => {
    void refresh();
    const tick = () => { void refresh(); };
    const interval = setInterval(tick, 60_000);
    window.addEventListener("focus", tick); document.addEventListener("visibilitychange", tick);
    window.addEventListener("revflow:subscriptions-changed", tick);
    return () => { clearInterval(interval); pending.current?.abort(); pending.current = null;
      window.removeEventListener("focus", tick); document.removeEventListener("visibilitychange", tick); window.removeEventListener("revflow:subscriptions-changed", tick); };
  }, [refresh]);
  async function markRead(alert: SubscriptionAlert) {
    setBusy(alert.id);
    try {
      const result = await readSubscriptionAlert({ id: alert.id, key: alert.key });
      if (!result.ok) { setError(result.error ?? "Não foi possível marcar como lido."); return; }
      setAlerts(current => current.map(a => a.id === alert.id && a.key === alert.key ? { ...a, unread: false } : a));
    } catch { setError("Não foi possível marcar como lido."); }
    finally { setBusy(null); }
  }
  const unread = alerts.filter(a => a.unread).length;
  return <Dialog open={open} onOpenChange={value => { setOpen(value); if (value) void refresh(); }}>
    <DialogTrigger asChild><button className="relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-transparent text-muted-foreground transition-colors hover:border-border hover:bg-muted hover:text-foreground" aria-label={`Notificações${unread ? ` · ${unread} por ler` : ""}`} title="Avisos de subscrições">
      {unread ? <BellRing className="h-5 w-5 text-primary" /> : <Bell className="h-5 w-5" />}
      {!!unread && <span className="absolute right-0 top-0 min-w-4 rounded-full bg-rose-500 px-1 text-[10px] font-bold leading-4 text-white">{unread > 99 ? "99+" : unread}</span>}
      {error && !unread && <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-amber-400" />}
    </button></DialogTrigger>
    <span role="status" className="sr-only">{unread ? `${unread} avisos de subscrições por ler` : ""}</span>
    <DialogContent className="max-h-[85dvh] w-[calc(100%-2rem)] max-w-lg overflow-y-auto"><DialogHeader><DialogTitle>Notificações</DialogTitle><DialogDescription>Renovações e períodos gratuitos de todas as tuas lojas.</DialogDescription></DialogHeader>
      {error && <div role="alert" className="mb-3 rounded-lg border border-amber-500/30 bg-amber-500/10 p-3 text-sm">{error}<button onClick={() => void refresh()} className="ml-2 text-primary underline">Tentar novamente</button></div>}
      {loading ? <p className="flex items-center gap-2 py-8 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" />A verificar prazos…</p> : !alerts.length && !error ? <div className="py-8 text-center"><Bell className="mx-auto mb-3 h-8 w-8 text-muted-foreground" /><p className="font-medium">Tudo em dia</p><p className="mt-1 text-sm text-muted-foreground">Os próximos avisos aparecerão aqui automaticamente.</p></div> : <div className="space-y-3">{alerts.map(a =>
        <article key={`${a.id}:${a.key}`} className={cn("rounded-xl border p-4", a.unread ? a.overdue ? "border-rose-500/30 bg-rose-500/5" : "border-primary/20 bg-primary/5" : "border-border")}>
          <div className="flex items-center justify-between gap-2"><p className="break-words font-medium">{a.name}</p>{a.unread && <span className="h-2 w-2 shrink-0 rounded-full bg-primary" />}</div>
          <p className="mt-1 text-xs text-muted-foreground">{a.store}</p><p className={cn("mt-2 text-sm", a.overdue ? "text-rose-400" : "text-foreground")}>{a.label}</p>
          <div className="mt-3 flex items-center justify-between gap-2"><Link onClick={() => setOpen(false)} href={`/subscriptions?subscription=${a.id}`} className="text-sm text-primary hover:underline">Ver subscrição</Link>
            {a.unread ? <button className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-50" disabled={!!busy} onClick={() => void markRead(a)}>{busy === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Check className="h-3.5 w-3.5" />}Marcar como lido</button> : <span className="text-xs text-muted-foreground">Lido</span>}</div>
        </article>)}</div>}
      <Button asChild variant="outline" className="mt-5 w-full"><Link href="/subscriptions" onClick={() => setOpen(false)}>Gerir subscrições</Link></Button>
    </DialogContent>
  </Dialog>;
}
