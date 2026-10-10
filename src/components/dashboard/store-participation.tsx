"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Loader2 } from "lucide-react";
import { saveStoreParticipation } from "@/lib/dashboard/participation-actions";
import { participationSchema, type ParticipationStore } from "@/lib/dashboard/store-participation";

function ParticipationRow({ store }: { store: ParticipationStore }) {
  const router = useRouter();
  const [value, setValue] = useState(String(store.percentage));
  const [savedValue, setSavedValue] = useState(store.percentage);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const parsed = value.trim() === "" ? NaN : Number(value.replace(",", "."));
  const dirty = parsed !== savedValue;

  async function save() {
    if (!participationSchema.safeParse(parsed).success) {
      setError("Usa um valor entre 0 e 100, com até duas casas decimais.");
      return;
    }
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveStoreParticipation(store.id, parsed);
      if (!result.ok) {
        setError(result.error ?? "Não foi possível guardar.");
        return;
      }
      setSavedValue(parsed);
      setValue(String(parsed));
      setSaved(true);
      router.refresh();
    } catch {
      setError("Não foi possível guardar. Tenta novamente.");
    } finally {
      setSaving(false);
    }
  }

  return <div className="space-y-1.5 rounded-lg border border-border bg-background/50 p-3">
    <label htmlFor={`participation-${store.id}`} className="block text-sm font-medium">{store.name}</label>
    <div className="flex items-center gap-2">
      <div className="relative min-w-0 flex-1">
        <input id={`participation-${store.id}`} aria-label={`A minha percentagem em ${store.name}`}
          inputMode="decimal" value={value} disabled={saving}
          onChange={(e) => { setValue(e.target.value); setSaved(false); setError(null); }}
          onKeyDown={(e) => { if (e.key === "Enter" && !saving) void save(); }}
          className="w-full rounded-lg border border-border bg-background py-2 pl-3 pr-8 text-sm tabular-nums outline-none focus:border-primary/50" />
        <span className="pointer-events-none absolute right-3 top-2 text-sm text-muted-foreground">%</span>
      </div>
      <button onClick={save} disabled={saving || !dirty} aria-label={`Guardar percentagem de ${store.name}`}
        className="flex items-center justify-center gap-1.5 rounded-lg bg-primary px-3 py-2 text-sm font-medium text-primary-foreground disabled:opacity-50">
        {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : saved ? <Check className="h-4 w-4" /> : null}
        {saved ? "Guardado" : "Guardar"}
      </button>
    </div>
    {error && <p role="alert" className="text-xs text-rose-500">{error}</p>}
    {saved && <p role="status" className="text-xs text-emerald-500">Percentagem guardada.</p>}
  </div>;
}

export function StoreParticipation({ stores }: { stores: ParticipationStore[] }) {
  return <div className="space-y-3">
    <div>
      <h3 className="text-sm font-medium">A minha participação</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
        Define a tua percentagem em cada loja. Em “Todas as lojas”, o lucro e as despesas refletem a tua parte.
        Ao abrir uma loja, vês os valores completos.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">Aplica-se a todos os períodos. Por defeito, cada loja conta a 100%.</p>
    </div>
    {stores.length ? stores.map((store) => <ParticipationRow key={store.id} store={store} />)
      : <p className="text-sm text-muted-foreground">Liga uma loja para definires a tua participação.</p>}
  </div>;
}
