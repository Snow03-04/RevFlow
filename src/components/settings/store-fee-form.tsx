"use client";

import { useActionState, useState } from "react";
import { Loader2, CheckCircle2, AlertCircle } from "lucide-react";
import { updateStoreFeeAction, type StoreFeeState } from "@/lib/settings/store-fee-actions";
import { Button } from "@/components/ui/button";

export function StoreFeeForm({ store }: { store: { id: string; name: string; enabled: boolean } }) {
  const [enabled, setEnabled] = useState(store.enabled);
  const [state, action, pending] = useActionState<StoreFeeState, FormData>(updateStoreFeeAction, {});
  const [changed, setChanged] = useState(false);
  return (
    <form action={action} className="rounded-xl border border-border bg-background/40 p-4">
      <input type="hidden" name="store_id" value={store.id} />
      <input type="hidden" name="enabled" value={String(enabled)} />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <p className="text-sm font-medium">{store.name}</p>
          <p className="mt-1 text-xs text-muted-foreground">5 € por encomenda para a UE · já incluídos no valor da sheet</p>
        </div>
        <div className="flex items-center gap-4">
          <label className="flex cursor-pointer items-center gap-2.5 text-xs">
            <span className={enabled ? "text-primary" : "text-muted-foreground"}>{enabled ? "Ativa" : "Desligada"}</span>
            <span className="relative inline-flex">
              <input type="checkbox" role="switch" aria-label={`Aplicar taxa UE — ${store.name}`}
                checked={enabled} disabled={pending} className="peer sr-only"
                onChange={e => { setEnabled(e.target.checked); setChanged(true); }} />
              <span className="h-6 w-11 rounded-full bg-muted transition-colors peer-checked:bg-primary peer-focus-visible:ring-2 peer-focus-visible:ring-primary peer-focus-visible:ring-offset-2 peer-focus-visible:ring-offset-background peer-disabled:opacity-50" />
              <span className="pointer-events-none absolute left-1 top-1 h-4 w-4 rounded-full bg-foreground transition-transform peer-checked:translate-x-5 peer-checked:bg-primary-foreground" />
            </span>
          </label>
          <Button type="submit" size="sm" variant="outline" disabled={pending} onClick={() => setChanged(false)}>
            {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" />} {pending ? "A guardar…" : "Guardar"}
          </Button>
        </div>
      </div>
      <div aria-live="polite">
        {changed ? <p className="mt-3 text-xs text-muted-foreground">Alteração por guardar.</p>
          : !pending && state.error ? <p className="mt-3 flex items-start gap-2 text-xs text-amber-500"><AlertCircle className="h-4 w-4 shrink-0" />{state.error}</p>
          : !pending && state.ok ? <p className="mt-3 flex items-center gap-2 text-xs text-primary"><CheckCircle2 className="h-4 w-4" />Guardado. Custos e resultados atualizados.</p> : null}
      </div>
    </form>
  );
}
