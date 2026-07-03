"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { ExternalLink, Trash2, ImageOff, Megaphone } from "lucide-react";
import { deleteAd } from "@/lib/research/actions";
import type { Tables } from "@/types/database";
import { cn } from "@/lib/utils";

export function AdCard({ ad }: { ad: Tables<"research_ads"> }) {
  const router = useRouter();
  const [, start] = useTransition();
  const img = ad.image_urls?.[0] ?? null;

  function onDelete() {
    start(async () => {
      await deleteAd(ad.id, ad.product_id);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card">
      <div className="relative aspect-square w-full bg-muted">
        {ad.video_url ? (
          <video src={ad.video_url} controls className="h-full w-full object-cover" />
        ) : img ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={img} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 text-muted-foreground/50">
            <ImageOff className="h-7 w-7" />
            <span className="text-[11px]">sem media</span>
          </div>
        )}
        <span
          className={cn(
            "absolute left-2 top-2 rounded-full px-2 py-0.5 text-[10px] font-semibold",
            ad.active
              ? "bg-emerald-500/20 text-emerald-300"
              : "bg-muted/80 text-muted-foreground",
          )}
        >
          {ad.active ? "Ativo" : "Inativo"}
        </span>
        <button
          onClick={onDelete}
          title="Remover"
          className="absolute right-2 top-2 rounded-full bg-background/70 p-1.5 text-muted-foreground backdrop-blur-sm transition-colors hover:text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        {ad.page_name && (
          <p className="flex items-center gap-1.5 text-xs font-medium">
            <Megaphone className="h-3.5 w-3.5 text-muted-foreground" />
            <span className="truncate">{ad.page_name}</span>
          </p>
        )}
        {ad.title && (
          <p className="line-clamp-2 text-sm font-medium leading-snug">{ad.title}</p>
        )}
        {ad.body && (
          <p className="line-clamp-4 whitespace-pre-line text-xs text-muted-foreground">
            {ad.body}
          </p>
        )}
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-1 text-[11px] text-muted-foreground">
          {ad.cta && <span className="rounded bg-muted px-1.5 py-0.5">{ad.cta}</span>}
          {ad.countries?.length > 0 && <span>{ad.countries.join(", ")}</span>}
          {ad.started_at && <span>desde {ad.started_at}</span>}
        </div>
        {ad.snapshot_url && (
          <a
            href={ad.snapshot_url}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline"
          >
            <ExternalLink className="h-3.5 w-3.5" /> Abrir na Ad Library
          </a>
        )}
      </div>
    </div>
  );
}
