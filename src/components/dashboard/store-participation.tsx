"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveStoreParticipation } from "@/lib/dashboard/participation-actions";
import { participationSchema, type ParticipationStore } from "@/lib/dashboard/store-participation";

function parsePercentage(text: string) {
  const value = text.trim();
  return /^\d+(?:[.,]\d{1,2})?$/.test(value) ? Number(value.replace(",", ".")) : NaN;
}

function PercentageInput({ label, value, onChange, placeholder }: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string;
}) {
  return <label className="block min-w-0 text-xs text-muted-foreground">
    {label}
    <span className="relative mt-1 block">
      <input inputMode="decimal" value={value} placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-sm tabular-nums text-foreground outline-none focus:border-primary/50" />
      <span aria-hidden="true" className="pointer-events-none absolute right-3 top-2 text-sm">%</span>
    </span>
  </label>;
}

function ParticipationRow({ store }: { store: ParticipationStore }) {
  const router = useRouter();
  const [profit, setProfit] = useState(String(store.percentage));
  const [expenses, setExpenses] = useState(String(store.expenseOverride ?? ""));
  const [ads, setAds] = useState<string | null>(store.adSpendOverride == null ? null : String(store.adSpendOverride));
  const [stored, setStored] = useState(store);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const percentage = parsePercentage(profit);
  const expenseOverride = expenses.trim() === "" ? null : parsePercentage(expenses);
  const adSpendOverride = ads === null ? null : parsePercentage(ads);
  const dirty = percentage !== stored.percentage || expenseOverride !== stored.expenseOverride || adSpendOverride !== stored.adSpendOverride;

  async function save() {
    if (saving || !dirty) return;
    if (![percentage, expenseOverride, adSpendOverride].every((n) => n === null || participationSchema.safeParse(n).success)) {
      setError("Usa percentagens entre 0 e 100, com até duas casas decimais.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveStoreParticipation(store.id, percentage, expenseOverride, adSpendOverride);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível guardar.");
        return;
      }
      setStored({ ...store, percentage, expenseOverride, adSpendOverride });
      setSaved(true);
      router.refresh();
    } catch {
      setError("Não foi possível guardar. Tenta novamente.");
    } finally {
      setSaving(false);
    }
  }

  return <form onSubmit={(event) => { event.preventDefault(); void save(); }}
    onChange={() => { setError(null); setSaved(false); }}
    className="rounded-lg border border-border bg-background/50 p-3">
    <fieldset disabled={saving} className="min-w-0 space-y-3">
      <legend className="text-sm font-medium">{store.name}</legend>
      <div className="grid grid-cols-2 gap-2">
        <PercentageInput label="Lucro líquido que recebo" value={profit} onChange={setProfit} />
        <PercentageInput label="Despesas que pago" value={expenses} placeholder={profit} onChange={setExpenses} />
      </div>
      <label className="flex items-center gap-2 text-xs text-muted-foreground">
        <input type="checkbox" checked={ads !== null} onChange={(event) => setAds(event.target.checked ? expenses.trim() || profit : null)}
          className="accent-primary" />
        Definir outra percentagem para o adspend
      </label>
      {ads !== null && <PercentageInput label="Publicidade que pago (Meta e Google)" value={ads} onChange={setAds} />}
      <div className="flex items-center justify-end gap-2">
        {error && <p role="alert" className="mr-auto text-xs text-rose-500">{error}</p>}
        <button type="submit" disabled={saving || !dirty} aria-label={`Guardar participação de ${store.name}`}
          className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
          {saving ? "A guardar…" : saved ? "Guardado" : "Guardar"}
        </button>
      </div>
    </fieldset>
  </form>;
}

export function StoreParticipation({ stores }: { stores: ParticipationStore[] }) {
  return <div className="space-y-3">
    <div>
      <h3 className="text-sm font-medium">A minha participação</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        O lucro é repartido depois de descontar todos os custos da loja. A percentagem das despesas indica quanto pagas.
        Deixa-a em branco para acompanhar a percentagem do lucro.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Aplica-se a todos os períodos em “Todas as lojas”. Ao abrir uma loja, vês os totais.</p>
    </div>
    {stores.length ? stores.map((store) => <ParticipationRow key={store.id} store={store} />)
      : <p className="text-sm text-muted-foreground">Liga uma loja para definires a tua participação.</p>}
  </div>;
}
