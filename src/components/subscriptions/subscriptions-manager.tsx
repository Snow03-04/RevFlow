"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BellRing, CalendarClock, Check, CircleAlert, CreditCard, ExternalLink, Loader2, Pencil, Plus, Search } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { todayYmd } from "@/lib/date";
import { CYCLES, STATUSES, daysUntil, dueLabel, isRunning, monthlyTotals, nextRenewalDate, type StoreSubscription } from "@/lib/subscriptions/model";
import { confirmSubscriptionRenewal, saveSubscription } from "@/lib/subscriptions/actions";

type Store = { id: string; label: string };
const field = "h-11 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
const money = (amount: number, currency: string) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(amount);
const date = (value: string) => new Date(`${value}T12:00:00Z`).toLocaleDateString("pt-PT", { timeZone: "UTC" });
function changed() { window.dispatchEvent(new Event("revflow:subscriptions-changed")); }

export function SubscriptionsManager({ rows, stores, initialToday, timezone, selectedStore, selectedId }: {
  rows: StoreSubscription[]; stores: Store[]; initialToday: string; timezone: string; selectedStore?: string; selectedId?: string;
}) {
  const router = useRouter();
  const [today, setToday] = useState(initialToday);
  const [filter, setFilter] = useState("running");
  const [search, setSearch] = useState("");
  const [editing, setEditing] = useState<StoreSubscription | "new" | null>(null);
  const [renewing, setRenewing] = useState<StoreSubscription | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const tick = () => setToday(todayYmd(timezone));
    const timer = setInterval(tick, 60_000);
    window.addEventListener("focus", tick);
    return () => { clearInterval(timer); window.removeEventListener("focus", tick); };
  }, [timezone]);
  const scoped = useMemo(() => rows.filter(s => !selectedStore || s.shopify_connection_id === selectedStore), [rows, selectedStore]);
  const running = scoped.filter(isRunning);
  const due = running.filter(s => daysUntil(s.next_due_date, today) >= 0 && daysUntil(s.next_due_date, today) <= 7);
  const overdue = running.filter(s => daysUntil(s.next_due_date, today) < 0);
  const monthly = monthlyTotals(scoped);
  const visible = scoped.filter(s => (filter === "all" || (filter === "running" ? isRunning(s) : s.status === filter)) &&
    `${s.name} ${stores.find(store => store.id === s.shopify_connection_id)?.label ?? ""}`.toLocaleLowerCase("pt-PT").includes(search.toLocaleLowerCase("pt-PT")))
    .sort((a, b) => Number(isRunning(b)) - Number(isRunning(a)) || a.next_due_date.localeCompare(b.next_due_date) || a.name.localeCompare(b.name));

  async function confirmRenewal() {
    if (!renewing) return;
    setBusy(true); setError("");
    try {
      const result = await confirmSubscriptionRenewal({ id: renewing.id, expectedUpdatedAt: renewing.updated_at });
      if (!result.ok) { setError(result.error ?? "Não foi possível confirmar."); return; }
      setRenewing(null); setNotice("Renovação confirmada. O próximo prazo já está agendado."); changed(); router.refresh();
    } catch { setError("Não foi possível confirmar. Tenta novamente."); }
    finally { setBusy(false); }
  }

  return <div className="mx-auto max-w-7xl space-y-7">
    <header className="flex flex-wrap items-start justify-between gap-4">
      <div><p className="mb-2 text-xs font-semibold uppercase tracking-[0.2em] text-primary">Controlo das lojas</p>
        <h1 className="text-3xl font-semibold tracking-tight">Subscrições</h1>
        <p className="mt-2 text-sm text-muted-foreground">Renovações e períodos gratuitos, loja a loja.</p></div>
      <Button className="h-11 gap-2 rounded-xl" onClick={() => { setNotice(""); setEditing("new"); }} disabled={!stores.length}><Plus className="h-4 w-4" />Nova subscrição</Button>
    </header>

    <section aria-label="Resumo de subscrições" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <div className="rounded-2xl border border-primary/20 bg-primary/5 p-5"><CreditCard className="mb-3 h-5 w-5 text-primary" /><p className="text-sm text-muted-foreground">Mensal estimado</p>
        <p className="mt-1 text-2xl font-semibold tabular-nums">{monthly.length ? monthly.map(([currency, amount]) => <span className="block" key={currency}>{money(amount, currency)}</span>) : "—"}</p>
        <p className="mt-2 text-xs text-muted-foreground">Inclui o preço após os períodos gratuitos.</p></div>
      <Summary icon={<Check className="h-5 w-5 text-emerald-400" />} title="Em curso" value={running.length} detail={`${running.filter(s => s.status === "trial").length} em período gratuito`} />
      <Summary icon={<CalendarClock className="h-5 w-5 text-amber-400" />} title="Nos próximos 7 dias" value={due.length} detail="Renovações e fins de período gratuito" />
      <Summary icon={<CircleAlert className={cn("h-5 w-5", overdue.length ? "text-rose-400" : "text-muted-foreground")} />} title="Por confirmar" value={overdue.length} detail="Prazos que já passaram" />
    </section>

    <div className="flex items-start gap-3 rounded-xl border border-border bg-card/50 px-4 py-3 text-sm text-muted-foreground"><BellRing className="mt-0.5 h-4 w-4 shrink-0 text-primary" />
      <p>Regista o serviço e a próxima data. O sino do RevFlow avisa-te com a antecedência escolhida, mesmo noutra página ou com outra loja selecionada.</p></div>
    {notice && <p role="status" className="rounded-lg border border-emerald-500/20 bg-emerald-500/10 p-3 text-sm text-emerald-400">{notice}</p>}
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex flex-wrap gap-1 rounded-xl border border-border p-1" aria-label="Estado das subscrições">
        {[["running", "Em curso"], ["paused", "Em pausa"], ["cancelled", "Canceladas"], ["all", "Todas"]].map(([value, label]) =>
          <button key={value} onClick={() => setFilter(value)} aria-pressed={filter === value} className={cn("rounded-lg px-3 py-2 text-sm transition-colors", filter === value ? "bg-primary/15 text-primary" : "text-muted-foreground hover:text-foreground")}>{label}</button>)}
      </div>
      <label className="relative w-full sm:w-72"><Search className="absolute left-3 top-3.5 h-4 w-4 text-muted-foreground" /><input className={cn(field, "pl-9")} value={search} onChange={e => setSearch(e.target.value)} placeholder="Pesquisar serviço ou loja…" aria-label="Pesquisar subscrições" /></label>
    </div>
    {!visible.length ? <section className="flex flex-col items-center rounded-2xl border border-dashed border-border bg-card/30 px-6 py-14 text-center">
      <div className="mb-4 rounded-2xl bg-primary/10 p-4"><CalendarClock className="h-8 w-8 text-primary" /></div>
      <h2 className="text-lg font-semibold">{rows.length ? "Sem subscrições neste filtro" : "O próximo pagamento, sem surpresas."}</h2>
      <p className="mt-2 max-w-md text-sm text-muted-foreground">{!stores.length ? "Liga uma loja para começares a acompanhar as suas subscrições." : rows.length ? "Experimenta outro estado, loja ou pesquisa." : "Adiciona Shopify, apps, domínios ou outros serviços e escolhe quando queres receber o aviso."}</p>
      {!stores.length ? <Link className="mt-5 text-sm text-primary hover:underline" href="/connections">Ligar uma loja</Link> : !rows.length && <Button className="mt-5" variant="outline" onClick={() => setEditing("new")}>Adicionar primeira subscrição</Button>}
    </section> : <div className="grid gap-4 lg:grid-cols-2">
      {visible.map(s => {
        const days = daysUntil(s.next_due_date, today), running = isRunning(s), warning = running && days <= s.reminder_days;
        return <article key={s.id} id={`subscription-${s.id}`} className={cn("flex flex-col rounded-2xl border bg-card p-5 transition-colors", selectedId === s.id ? "border-primary ring-2 ring-primary/20" : warning ? days < 0 ? "border-rose-500/30" : "border-amber-500/30" : "border-border")}>
          <div className="flex items-start justify-between gap-4"><div className="min-w-0"><p className="mb-1 truncate text-xs text-muted-foreground">{stores.find(store => store.id === s.shopify_connection_id)?.label ?? "Loja"}</p><h2 className="break-words text-lg font-semibold">{s.name}</h2></div>
            <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs", s.status === "trial" ? "bg-violet-500/10 text-violet-400" : running ? "bg-emerald-500/10 text-emerald-400" : "bg-muted text-muted-foreground")}>{STATUSES[s.status]}</span></div>
          <div className="my-5 flex flex-wrap items-end justify-between gap-3"><div><span className="text-2xl font-semibold tabular-nums">{money(s.amount, s.currency)}</span><span className="ml-2 text-xs text-muted-foreground">/ {CYCLES[s.billing_cycle].toLocaleLowerCase("pt-PT")}</span>{s.status === "trial" && <p className="mt-1 text-xs text-muted-foreground">Preço após o período gratuito</p>}</div>
            <div className="text-sm"><p className="text-xs text-muted-foreground">{s.status === "trial" ? "Fim do período gratuito" : "Próxima renovação"}</p><p className="mt-1 font-medium tabular-nums">{date(s.next_due_date)}</p></div></div>
          {running && <div className={cn("mb-4 flex items-center gap-2 rounded-lg px-3 py-2 text-sm", warning ? days < 0 ? "bg-rose-500/10 text-rose-400" : "bg-amber-500/10 text-amber-400" : "bg-muted/50 text-muted-foreground")}><CalendarClock className="h-4 w-4 shrink-0" />{dueLabel(s, today)}</div>}
          {s.notes && <p className="mb-4 whitespace-pre-wrap break-words text-sm text-muted-foreground">{s.notes}</p>}
          <div className="mt-auto flex flex-wrap items-center gap-2 border-t border-border pt-4">
            {running && <Button variant="outline" size="sm" className="gap-2" onClick={() => { setError(""); setRenewing(s); }}><Check className="h-3.5 w-3.5" />Confirmar renovação</Button>}
            <Button variant="ghost" size="sm" className="gap-2" aria-label={`Editar ${s.name}`} onClick={() => setEditing(s)}><Pencil className="h-3.5 w-3.5" />Editar</Button>
            {s.management_url && <a href={s.management_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 px-2 py-2 text-xs text-primary hover:underline">Gerir serviço<ExternalLink className="h-3 w-3" /></a>}
            {running && <span className="ml-auto text-xs text-muted-foreground">Aviso {s.reminder_days === 0 ? "no próprio dia" : `${s.reminder_days} ${s.reminder_days === 1 ? "dia" : "dias"} antes`}</span>}
          </div>
        </article>;
      })}
    </div>}
    <p className="text-xs leading-relaxed text-muted-foreground">Este registo acompanha os teus prazos; alterações ao estado não cancelam o serviço no fornecedor. Os valores não são lançados automaticamente no lucro. Datas no fuso {timezone}.</p>

    <Dialog open={!!editing} onOpenChange={open => { if (!open) setEditing(null); }}><DialogContent className="max-h-[90dvh] w-[calc(100%-2rem)] max-w-xl overflow-y-auto">
      <DialogHeader><DialogTitle>{editing === "new" ? "Nova subscrição" : "Editar subscrição"}</DialogTitle><DialogDescription>Escolhe a loja, o prazo e quando queres ser avisado.</DialogDescription></DialogHeader>
      {editing && <SubscriptionForm key={editing === "new" ? "new" : editing.id} subscription={editing === "new" ? null : editing} stores={stores} selectedStore={selectedStore} today={today} onSaved={() => { setEditing(null); setNotice("Subscrição guardada. Os avisos já estão configurados."); changed(); router.refresh(); }} />}
    </DialogContent></Dialog>
    <Dialog open={!!renewing} onOpenChange={open => { if (!open && !busy) setRenewing(null); }}><DialogContent className="w-[calc(100%-2rem)]"><DialogHeader>
      <DialogTitle>Confirmar renovação</DialogTitle><DialogDescription>{renewing?.name}: confirma apenas depois de verificares a renovação no fornecedor.</DialogDescription>
    </DialogHeader>{renewing && <><p className="text-sm">O próximo prazo passa de <strong>{date(renewing.next_due_date)}</strong> para <strong>{date(nextRenewalDate(renewing))}</strong>.</p>
      {renewing.status === "trial" && <p className="mt-2 text-sm text-muted-foreground">O período gratuito termina e o registo passa a ativo.</p>}
      <p className="mt-2 text-xs text-muted-foreground">Se o fornecedor indicou outra data, usa Editar.</p></>}
      {error && <p role="alert" className="mt-3 text-sm text-destructive">{error}</p>}
      <div className="mt-6 flex justify-end gap-2"><Button variant="outline" disabled={busy} onClick={() => setRenewing(null)}>Voltar</Button><Button disabled={busy} onClick={confirmRenewal}>{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Confirmar</Button></div>
    </DialogContent></Dialog>
  </div>;
}

function Summary({ icon, title, value, detail }: { icon: React.ReactNode; title: string; value: number; detail: string }) {
  return <div className="rounded-2xl border border-border bg-card p-5"><div className="mb-3">{icon}</div><p className="text-sm text-muted-foreground">{title}</p><p className="mt-1 text-2xl font-semibold tabular-nums">{value}</p><p className="mt-2 text-xs text-muted-foreground">{detail}</p></div>;
}

function SubscriptionForm({ subscription: s, stores, selectedStore, today, onSaved }: { subscription: StoreSubscription | null; stores: Store[]; selectedStore?: string; today: string; onSaved: () => void }) {
  const [status, setStatus] = useState(s?.status ?? "active");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setError(""); setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      const result = await saveSubscription({ ...(s ? { id: s.id, expectedUpdatedAt: s.updated_at } : {}),
        shopify_connection_id: data.get("store"), name: data.get("name"), amount: Number(String(data.get("amount")).replace(",", ".")),
        currency: data.get("currency"), billing_cycle: data.get("cycle"), status, next_due_date: data.get("date"),
        reminder_days: Number(data.get("reminder")), management_url: data.get("url"), notes: data.get("notes") });
      if (!result.ok) { setError(result.error ?? "Não foi possível guardar."); return; }
      onSaved();
    } catch { setError("Não foi possível guardar. Verifica a ligação e tenta novamente."); }
    finally { setBusy(false); }
  }
  return <form onSubmit={submit} className="space-y-4"><fieldset disabled={busy} className="space-y-4 disabled:opacity-70">
    <label className="block space-y-1.5 text-sm"><span>Serviço</span><input name="name" className={field} placeholder="Ex.: Shopify, AfterSell, domínio…" defaultValue={s?.name ?? ""} maxLength={100} required /></label>
    <label className="block space-y-1.5 text-sm"><span>Loja</span><select name="store" className={field} defaultValue={s?.shopify_connection_id ?? (stores.some(store => store.id === selectedStore) ? selectedStore : stores[0]?.id)} required>{stores.map(store => <option key={store.id} value={store.id}>{store.label}</option>)}</select></label>
    <div className="grid grid-cols-2 gap-3"><label className="block space-y-1.5 text-sm"><span>{status === "trial" ? "Preço após período gratuito" : "Valor por renovação"}</span><input className={field} type="number" step="0.01" min="0" max="9999999" name="amount" defaultValue={s?.amount ?? ""} placeholder="0,00" required /></label>
      <label className="block space-y-1.5 text-sm"><span>Moeda</span><select name="currency" className={field} defaultValue={s?.currency ?? "EUR"}>{["EUR", "USD", "GBP", "CAD", "AUD", "RON", "HUF", "PLN", "CZK", "SEK", "DKK", "NOK", "CHF"].map(c => <option key={c}>{c}</option>)}</select></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="block space-y-1.5 text-sm"><span>Periodicidade</span><select name="cycle" className={field} defaultValue={s?.billing_cycle ?? "monthly"}>{Object.entries(CYCLES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
      <label className="block space-y-1.5 text-sm"><span>Estado</span><select className={field} value={status} onChange={e => setStatus(e.target.value as StoreSubscription["status"])}>{Object.entries(STATUSES).map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label></div>
    <div className="grid grid-cols-2 gap-3"><label className="block space-y-1.5 text-sm"><span>{status === "trial" ? "Fim do período gratuito" : "Próxima renovação"}</span><input name="date" type="date" className={field} min="2000-01-01" max="2200-12-31" defaultValue={s?.next_due_date ?? today} required /></label>
      <label className="block space-y-1.5 text-sm"><span>Avisar quantos dias antes</span><input name="reminder" className={field} type="number" min="0" max="90" step="1" defaultValue={s?.reminder_days ?? 7} required /></label></div>
    <label className="block space-y-1.5 text-sm"><span>Ligação para gerir o serviço <span className="text-muted-foreground">(opcional)</span></span><input name="url" type="url" className={field} defaultValue={s?.management_url ?? ""} placeholder="https://…" maxLength={2000} /></label>
    <label className="block space-y-1.5 text-sm"><span>Notas <span className="text-muted-foreground">(opcional)</span></span><textarea name="notes" className={cn(field, "h-20 py-2")} maxLength={2000} defaultValue={s?.notes ?? ""} placeholder="Plano contratado, aviso de cancelamento…" /></label>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    <Button type="submit" className="h-11 w-full">{busy && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}Guardar subscrição</Button>
  </fieldset></form>;
}
