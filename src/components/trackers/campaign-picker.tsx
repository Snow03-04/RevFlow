"use client";

import { useState, useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { MetaPnlOption } from "@/lib/trackers/meta-pnl-query";
import { pnlUrl } from "@/lib/trackers/pnl-navigation";

export function CampaignPicker({ options, selectedKey, platform }: { options: MetaPnlOption[]; selectedKey: string; platform: string }) {
  const router = useRouter();
  const params = useSearchParams();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();
  const [search, setSearch] = useState("");
  const filtered = options.filter((o) => o.key === selectedKey || `${o.name} ${o.storeName} ${o.campaignId}`.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <div aria-busy={pending} className="grid gap-3 rounded-xl border border-border bg-card p-4 sm:grid-cols-[1fr_2fr]">
    <label className="space-y-1.5 text-xs text-muted-foreground">
      <span>Procurar campanha</span>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Nome ou ID…" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm text-foreground" />
    </label>
    <label className="min-w-0 space-y-1.5 text-xs text-muted-foreground">
      <span>{platform} · {options.length} campanhas</span>
      <select aria-label={`Selecionar campanha ${platform}`} value={selectedKey} disabled={pending || !options.length}
        onChange={(e) => startTransition(() => router.push(pnlUrl(params.toString(), { campaign: e.target.value || null, collection: null }, pathname)))}
        className="h-10 w-full truncate rounded-md border border-input bg-background px-3 text-sm text-foreground">
        <option value="">Todas as campanhas</option>
        {filtered.map((o) => <option key={o.key} value={o.key}>{o.name} · {o.storeName} · ID {o.campaignId}</option>)}
      </select>
    </label>
  </div>;
}
