"use client";

import Link from "next/link";
import { useState, useTransition } from "react";
import { Star, Package, Megaphone, Globe } from "lucide-react";
import { toggleFavorite } from "@/lib/research/actions";
import { StatusPicker } from "@/components/research/status-picker";
import type { ResearchProduct } from "@/lib/research/queries";
import { cn } from "@/lib/utils";

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
  });
}

function daysAgo(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return "hoje";
  if (d === 1) return "há 1 dia";
  return `há ${d} dias`;
}

function normHref(url: string): string {
  return url.startsWith("http") ? url : `https://${url}`;
}
function storeDomain(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(normHref(url)).hostname.replace(/^www\./, "");
  } catch {
    return null;
  }
}

export function ProductCard({ product }: { product: ResearchProduct }) {
  const [fav, setFav] = useState(product.favorite);
  const [, start] = useTransition();

  function onFav(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    start(() => {
      toggleFavorite(product.id, next);
    });
  }

  return (
    <Link
      href={`/research/${product.id}`}
      className="group flex flex-col overflow-hidden rounded-xl border border-border/60 bg-card transition-colors hover:border-foreground/20"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-muted">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover transition-transform group-hover:scale-[1.02]"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Package className="h-8 w-8 text-muted-foreground/50" />
          </div>
        )}
        <button
          onClick={onFav}
          className="absolute right-2 top-2 rounded-full bg-background/70 p-1.5 backdrop-blur-sm transition-colors hover:bg-background"
          title={fav ? "Remover favorito" : "Favoritar"}
        >
          <Star
            className={cn(
              "h-4 w-4",
              fav ? "fill-amber-400 text-amber-400" : "text-muted-foreground",
            )}
          />
        </button>
        <span
          className="absolute left-2 top-2 rounded-full bg-background/70 px-2 py-0.5 text-[10px] font-medium text-muted-foreground backdrop-blur-sm"
          title={`Adicionado a ${shortDate(product.created_at)}`}
        >
          {daysAgo(product.created_at)}
        </span>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-3">
        <p className="line-clamp-2 text-sm font-medium leading-snug">
          {product.name}
        </p>
        {storeDomain(product.url) && (
          <span
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              window.open(normHref(product.url!), "_blank", "noopener");
            }}
            title={product.url ?? ""}
            className="flex w-fit max-w-full cursor-pointer items-center gap-1 text-[11px] text-muted-foreground hover:text-primary"
          >
            <Globe className="h-3 w-3 shrink-0" />
            <span className="truncate">{storeDomain(product.url)}</span>
          </span>
        )}
        <div className="mt-auto flex items-center justify-between gap-2">
          <StatusPicker productId={product.id} status={product.status} />
          <span className="flex items-center gap-1 text-xs text-muted-foreground">
            <Megaphone className="h-3.5 w-3.5" />
            {product.adCount}
          </span>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Criado {shortDate(product.created_at)}
          {product.last_researched_at
            ? ` · atualizado ${shortDate(product.last_researched_at)}`
            : ""}
        </p>
      </div>
    </Link>
  );
}
