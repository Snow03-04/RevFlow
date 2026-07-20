"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star, ExternalLink, Trash2, Loader2 } from "lucide-react";
import {
  updateStore,
  deleteStore,
  toggleStoreFavorite,
} from "@/lib/research/store-actions";
import { StoreStatusPicker } from "@/components/research/store-status-picker";
import { StoreTagInput } from "@/components/research/store-tag-input";
import type { Tables } from "@/types/database";
import { cn } from "@/lib/utils";

export function StoreDetailHeader({
  store,
}: {
  store: Tables<"research_stores">;
}) {
  const router = useRouter();
  const [name, setName] = useState(store.name);
  const [url, setUrl] = useState(store.url ?? "");
  const [niche, setNiche] = useState(store.niche ?? "");
  const [fav, setFav] = useState(store.favorite);
  const [deleting, startDelete] = useTransition();

  function saveName() {
    if (name.trim() && name !== store.name) {
      updateStore(store.id, { name: name.trim() });
    }
  }
  function saveUrl() {
    if (url !== (store.url ?? "")) {
      updateStore(store.id, { url: url.trim() || null });
    }
  }
  function saveNiche() {
    if (niche !== (store.niche ?? "")) {
      updateStore(store.id, { niche: niche.trim() || null });
    }
  }
  function onFav() {
    const next = !fav;
    setFav(next);
    toggleStoreFavorite(store.id, next);
  }
  function onDelete() {
    if (!confirm("Apagar esta loja?")) return;
    startDelete(async () => {
      await deleteStore(store.id);
      router.push("/stores");
    });
  }

  return (
    <div className="space-y-3">
      <Link
        href="/stores"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Store Research
      </Link>

      <div className="flex items-start justify-between gap-4">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          onBlur={saveName}
          className="w-full bg-transparent text-2xl font-semibold tracking-tight outline-none"
        />
        <div className="flex shrink-0 items-center gap-2">
          <button
            onClick={onFav}
            title={fav ? "Remover favorito" : "Favoritar"}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:text-foreground"
          >
            <Star className={cn("h-5 w-5", fav && "fill-amber-400 text-amber-400")} />
          </button>
          <button
            onClick={onDelete}
            disabled={deleting}
            className="rounded-md p-2 text-muted-foreground transition-colors hover:text-destructive"
          >
            {deleting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Trash2 className="h-5 w-5" />}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <StoreStatusPicker storeId={store.id} status={store.status} size="md" />
        <div className="flex flex-1 items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={saveUrl}
            placeholder="URL da loja…"
            className="min-w-0 flex-1 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
          />
          {url.trim() && (
            <a
              href={url.startsWith("http") ? url : `https://${url}`}
              target="_blank"
              rel="noreferrer"
              className="rounded-md p-2 text-muted-foreground hover:text-foreground"
            >
              <ExternalLink className="h-4 w-4" />
            </a>
          )}
        </div>
        <input
          value={niche}
          onChange={(e) => setNiche(e.target.value)}
          onBlur={saveNiche}
          placeholder="Nicho (ex.: Beauty)…"
          className="w-44 rounded-lg border border-border/60 bg-card px-3 py-1.5 text-sm text-muted-foreground outline-none focus:ring-1 focus:ring-ring"
        />
      </div>

      <StoreTagInput storeId={store.id} initial={store.tags} />
    </div>
  );
}
