"use client";

import { useRef, useState } from "react";
import { updateStore } from "@/lib/research/store-actions";

export function StoreNotesEditor({
  storeId,
  initial,
}: {
  storeId: string;
  initial: string | null;
}) {
  const [value, setValue] = useState(initial ?? "");
  const [saved, setSaved] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function onChange(v: string) {
    setValue(v);
    setSaved(false);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      await updateStore(storeId, { notes: v || null });
      setSaved(true);
    }, 700);
  }

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
          Notas
        </label>
        {saved && <span className="text-[11px] text-emerald-400">Guardado ✓</span>}
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={8}
        placeholder="Produtos que vende, criativos, funil, preços, o que copiar/evitar…"
        className="w-full rounded-lg border border-border/60 bg-card px-3 py-2 text-sm outline-none focus:ring-1 focus:ring-ring"
      />
    </div>
  );
}
