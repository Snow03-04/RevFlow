"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Star, ExternalLink, Trash2, Loader2 } from "lucide-react";
import { updateProduct, deleteProduct, toggleFavorite } from "@/lib/research/actions";
import { StatusPicker } from "@/components/research/status-picker";
import { TagInput } from "@/components/research/tag-input";
import type { Tables } from "@/types/database";
import { cn } from "@/lib/utils";

export function ProductDetailHeader({
  product,
}: {
  product: Tables<"research_products">;
}) {
  const router = useRouter();
  const [name, setName] = useState(product.name);
  const [url, setUrl] = useState(product.url ?? "");
  const [fav, setFav] = useState(product.favorite);
  const [deleting, startDelete] = useTransition();

  function saveName() {
    if (name.trim() && name !== product.name) {
      updateProduct(product.id, { name: name.trim() });
    }
  }
  function saveUrl() {
    if (url !== (product.url ?? "")) {
      updateProduct(product.id, { url: url.trim() || null });
    }
  }
  function onFav() {
    const next = !fav;
    setFav(next);
    toggleFavorite(product.id, next);
  }
  function onDelete() {
    if (!confirm("Apagar este produto e todos os seus anúncios?")) return;
    startDelete(async () => {
      await deleteProduct(product.id);
      router.push("/research");
    });
  }

  return (
    <div className="space-y-3">
      <Link
        href="/research"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Product Research
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
        <StatusPicker productId={product.id} status={product.status} size="md" />
        <div className="flex flex-1 items-center gap-2">
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onBlur={saveUrl}
            placeholder="URL do produto…"
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
      </div>

      <TagInput productId={product.id} initial={product.tags} />
    </div>
  );
}
