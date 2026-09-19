"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { setGoogleCampaignCollection } from "@/lib/trackers/google-collection-actions";

export function GoogleCollectionPicker({ options, selected }: { options: { key: string; name: string; storeName: string }[]; selected: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const [search, setSearch] = useState("");
  const [pending, start] = useTransition();
  const filtered = options.filter((c) => c.key === selected || `${c.name} ${c.storeName}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div className="grid gap-3 sm:grid-cols-2" aria-busy={pending}>
    <label className="space-y-1.5 text-xs text-muted-foreground"><span>Procurar coleção</span><input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome da coleção ou loja…" className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground" /></label>
    <label className="space-y-1.5 text-xs text-muted-foreground"><span>P&L por coleção</span><select value={selected} disabled={pending} onChange={(e) => start(() => router.push(pnlUrl(params.toString(), { collection: e.target.value || null, campaign: null }, "/finance/google")))} className="h-10 w-full rounded-md border border-input bg-card px-3 text-sm text-foreground">
      <option value="">Todas as coleções</option>{filtered.map((c) => <option key={c.key} value={c.key}>{c.name} · {c.storeName}</option>)}
    </select></label>
  </div>;
}

export function GoogleCollectionAssociation({ campaignKey, year, current }: { campaignKey: string; year: number; current: string | null }) {
  const [value, setValue] = useState(current ?? "");
  const [pending, start] = useTransition();
  const [message, setMessage] = useState("");
  const router = useRouter();
  function save(next: string) {
    start(async () => {
      try {
        const result = await setGoogleCampaignCollection(campaignKey, year, next);
        setMessage(result.ok ? next ? "Associação guardada." : "Associação automática reposta. Executa o script para voltar a ler os destinos." : result.error ?? "Não foi possível guardar.");
        if (result.ok) { setValue(next); router.refresh(); }
      } catch { setMessage("Não foi possível guardar. Tenta novamente."); }
    });
  }
  return <details className="rounded-md border border-border bg-card p-3 text-sm"><summary className="cursor-pointer text-muted-foreground">{current ? `Coleção: ${current} · alterar` : "Associar campanha a uma coleção"}</summary>
    <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={(e) => { e.preventDefault(); save(value); }}>
      <label className="min-w-0 flex-1 space-y-1 text-xs text-muted-foreground"><span>Endereço ou identificador da coleção nesta loja</span><input required value={value} onChange={(e) => setValue(e.target.value)} placeholder="https://loja.com/collections/winter-cardigans" className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" /></label>
      <button disabled={pending} className="h-9 rounded-md bg-primary px-4 text-xs font-medium text-primary-foreground disabled:opacity-50">{pending ? "A guardar…" : "Guardar"}</button>
      {current && <button type="button" disabled={pending} onClick={() => save("")} className="h-9 rounded-md border border-border px-3 text-xs disabled:opacity-50">Usar automático</button>}
      <p className="w-full text-xs text-muted-foreground">A associação aplica-se à análise de todos os períodos desta campanha.</p>
      {message && <p role="status" className="w-full text-xs">{message}</p>}
    </form>
  </details>;
}
