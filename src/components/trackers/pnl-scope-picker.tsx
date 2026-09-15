"use client";

import { useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";
import { cn } from "@/lib/utils";

export function PnlScopePicker({ options, isMeta, selectedKey }: {
  options: MetaPnlOption[];
  isMeta: boolean;
  selectedKey: string;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) => o.key === selectedKey ||
    `${o.name} ${o.storeName} ${o.campaignId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  function navigate(changes: Record<string, string | null>) {
    startTransition(() => router.push(pnlUrl(params.toString(), changes)));
  }
  return (
    <section aria-label="Escolher P&L" aria-busy={pending} className={cn("space-y-3 rounded-xl border border-border bg-card p-4", pending && "opacity-60")}>
      <div className="flex flex-wrap gap-2">
        {[{ meta: false, label: "P&L geral" }, { meta: true, label: "Campanha Meta" }].map((scope) => (
          <button key={scope.label} type="button" disabled={pending} aria-pressed={isMeta === scope.meta}
            onClick={() => navigate({ scope: scope.meta ? "meta" : null, campaign: null })}
            className={cn("rounded-lg px-4 py-2 text-sm font-medium transition-colors", isMeta === scope.meta ? "bg-primary/15 text-primary" : "text-muted-foreground hover:bg-accent")}>
            {scope.label}
          </button>
        ))}
      </div>
      {isMeta ? (
        <>
          <div className="grid gap-3 md:grid-cols-[minmax(180px,1fr)_3fr]">
            <label className="space-y-1.5 text-xs text-muted-foreground">
              <span>Procurar campanha</span>
              <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou ID…"
                className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
            </label>
            <label className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
              <span>Campanha Meta · {options.length} disponíveis</span>
              <select aria-label="Selecionar campanha Meta" value={selectedKey} disabled={pending || !options.length}
                onChange={(e) => navigate({ scope: "meta", campaign: e.target.value || null })}
                className="h-10 w-full truncate rounded-md border border-input bg-background px-3 text-sm text-foreground">
                <option value="">Selecionar campanha…</option>
                {filtered.map((o) => <option key={o.key} value={o.key}>{o.name} · {o.storeName} · {o.accountName} · ID {o.campaignId}</option>)}
              </select>
            </label>
          </div>
          <p className="text-xs text-muted-foreground">Campanhas com dados importados neste ano. A lista acompanha a loja escolhida no topo.</p>
          {!options.length && <p className="text-sm text-muted-foreground">Sem campanhas Meta importadas para esta loja neste ano.</p>}
        </>
      ) : <p className="text-xs text-muted-foreground">Consolidado de todas as lojas, incluindo Meta e Google.</p>}
    </section>
  );
}
