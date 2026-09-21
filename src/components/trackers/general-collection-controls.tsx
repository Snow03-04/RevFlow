"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { setGeneralCampaignCollection } from "@/lib/trackers/general-sheet-actions";
import type { GeneralCampaign } from "@/lib/trackers/general-sheet";

export function GeneralCollectionAssociation({ campaign, year }: { campaign: GeneralCampaign; year: number }) {
  const [value, setValue] = useState("");
  const [message, setMessage] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  return <form className="flex flex-wrap items-center gap-2" onSubmit={(event) => {
    event.preventDefault();
    start(async () => {
      try {
        const result = await setGeneralCampaignCollection(campaign.platform, campaign.key, year, value);
        setMessage(result.ok ? "Coleção associada." : result.error ?? "Não foi possível guardar.");
        if (result.ok) router.refresh();
      } catch { setMessage("Não foi possível guardar. Tenta novamente."); }
    });
  }}>
    <input aria-label={`Coleção de ${campaign.name}`} value={value} onChange={(e) => setValue(e.target.value)} placeholder="URL ou identificador da coleção" required disabled={pending} className="h-8 min-w-[220px] flex-1 rounded-md border border-input bg-background px-2 text-xs" />
    <button disabled={pending} className="rounded-md bg-primary/10 px-3 py-2 text-xs font-medium text-primary disabled:opacity-50">{pending ? "A guardar…" : "Associar coleção"}</button>
    {message && <p role="status" className="w-full text-xs text-muted-foreground">{message}</p>}
  </form>;
}
