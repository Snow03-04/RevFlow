"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { History, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { saveStoreHistory } from "@/lib/trackers/lifetime-actions";
import { storeHistorySchema, type LifetimeStore, type StoreHistory } from "@/lib/trackers/lifetime";

function StoreEditor({ store, history }: { store: LifetimeStore; history?: StoreHistory }) {
  const router = useRouter();
  const [periods, setPeriods] = useState<StoreHistory["periods"]>(history?.periods ?? [
    { id: "", name: store.shop_name || store.shop_domain, from: null },
  ]);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();
  const [dirty, setDirty] = useState(false);
  function edit(index: number, changes: Partial<StoreHistory["periods"][number]>) {
    setPeriods((current) => current.map((p, i) => i === index ? { ...p, ...changes } : p));
    setDirty(true); setMessage(null);
  }
  function save() {
    const input = { version: 1, periods: periods.map((p) => ({ ...p, id: p.id || crypto.randomUUID() })) };
    const parsed = storeHistorySchema.safeParse(input);
    if (!parsed.success) { setMessage({ ok: false, text: parsed.error.issues[0].message }); return; }
    startTransition(async () => {
      try {
        const result = await saveStoreHistory(store.id, parsed.data);
        setMessage({ ok: result.ok, text: result.ok ? "Histórico guardado. Os totais foram repartidos pelas marcas." : result.error! });
        if (result.ok) { setPeriods(parsed.data.periods); setDirty(false); router.refresh(); }
      } catch { setMessage({ ok: false, text: "Não foi possível guardar. Verifica a ligação e tenta novamente." }); }
    });
  }
  return <details className="group rounded-xl border border-border bg-background/40">
    <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-2 p-4 text-sm">
      <span><strong className="font-medium">{store.shop_name || store.shop_domain}</strong><span className="ml-2 text-xs text-muted-foreground">{store.shop_domain}</span></span>
      <span className={history ? "text-xs text-primary" : "text-xs text-amber-400"}>{history ? `${history.periods.length} marca${history.periods.length === 1 ? "" : "s"} · Editar` : "Configurar histórico"}</span>
    </summary>
    <form className="space-y-4 border-t border-border p-4" onSubmit={(event) => { event.preventDefault(); save(); }}>
      <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">Introduz as marcas da mais antiga para a mais recente. Cada marca fica com os dados até à véspera do início da seguinte. Se esta loja sempre teve o mesmo nome, basta guardar uma marca.</p>
      <fieldset disabled={pending} className="space-y-3">
        {periods.map((period, index) => <div key={period.id || "initial"} className="grid items-end gap-3 rounded-lg bg-muted/20 p-3 sm:grid-cols-[minmax(140px,1fr)_minmax(170px,1fr)_36px]">
          <label className="space-y-1.5 text-xs"><span className="text-muted-foreground">{index + 1}. Nome da marca</span><Input required maxLength={80} value={period.name} onChange={(e) => edit(index, { name: e.target.value })} placeholder="Ex.: Nadel Atelier" /></label>
          <label className="space-y-1.5 text-xs"><span className="text-muted-foreground">{index === 0 ? "Início (vazio = todo o histórico anterior)" : "Primeiro dia desta marca"}</span><Input type="date" aria-label={`Primeiro dia da marca ${index + 1}`} required={index > 0} value={period.from ?? ""} onChange={(e) => edit(index, { from: e.target.value || null })} /></label>
          <Button type="button" variant="ghost" size="icon" disabled={periods.length === 1} aria-label={`Retirar marca ${index + 1} do formulário`} onClick={() => { setPeriods((current) => current.filter((_, i) => i !== index)); setDirty(true); setMessage(null); }}><Trash2 className="h-4 w-4" /></Button>
        </div>)}
        <Button type="button" variant="outline" size="sm" disabled={periods.length >= 40} onClick={() => { setPeriods((current) => [...current, { id: crypto.randomUUID(), name: "", from: null }]); setDirty(true); setMessage(null); }}><Plus /> Acrescentar mudança de marca</Button>
      </fieldset>
      <div className="flex flex-wrap items-center gap-3"><Button size="sm" disabled={pending || (!!history && !dirty)}>{pending ? "A guardar…" : "Guardar histórico"}</Button><span className="text-xs text-muted-foreground">Altera a distribuição nesta página; os registos de vendas mantêm-se.</span></div>
      {message && <p role={message.ok ? "status" : "alert"} className={`text-xs ${message.ok ? "text-emerald-400" : "text-red-400"}`}>{message.text}</p>}
    </form>
  </details>;
}

export function LifetimeHistoryEditor({ stores, histories }: { stores: LifetimeStore[]; histories: Record<string, StoreHistory> }) {
  return <section id="historico" className="scroll-mt-24 space-y-4 rounded-xl border border-border bg-card p-5 sm:p-6">
    <div className="flex items-center gap-2"><History className="h-4 w-4 text-primary" /><h2 className="text-base font-semibold">Histórico das lojas</h2></div>
    <p className="max-w-3xl text-sm leading-relaxed text-muted-foreground">O mesmo Shopify pode ter tido várias marcas. Define quando mudou o nome para separar a faturação, os custos e os anúncios de cada uma, mesmo que a conta de anúncios seja a mesma.</p>
    <p className="max-w-3xl text-xs leading-relaxed text-muted-foreground">Exemplo: Nadel Atelier primeiro, Luisa Milano a partir da data de mudança. Se ambas venderam no mesmo dia, a separação por datas não chega: esses dias precisam de uma análise por encomenda e campanha.</p>
    <div className="space-y-3">{stores.map((store) => <StoreEditor key={store.id} store={store} history={histories[store.id]} />)}</div>
  </section>;
}
