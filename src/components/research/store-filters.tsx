"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Search, Star } from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  STORE_STATUSES,
  STORE_STATUS_LABEL,
} from "@/lib/research/store-constants";
import { cn } from "@/lib/utils";

export function StoreFilters({
  tags,
  current,
}: {
  tags: string[];
  current: { q: string; status: string; favorite: boolean; tag: string };
}) {
  const router = useRouter();
  const [q, setQ] = useState(current.q);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  function push(next: Partial<typeof current>) {
    const merged = { ...current, ...next };
    const p = new URLSearchParams();
    if (merged.q) p.set("q", merged.q);
    if (merged.status) p.set("status", merged.status);
    if (merged.favorite) p.set("favorite", "1");
    if (merged.tag) p.set("tag", merged.tag);
    router.push(`/stores${p.toString() ? `?${p}` : ""}`);
  }

  // Debounced search.
  useEffect(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      if (q !== current.q) push({ q });
    }, 350);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Procurar por nome, nicho, URL…"
            className="w-[260px] pl-9"
          />
        </div>
        <button
          onClick={() => push({ favorite: !current.favorite })}
          className={cn(
            "inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-sm font-medium transition-colors",
            current.favorite
              ? "border-amber-500/40 bg-amber-500/10 text-amber-300"
              : "border-border text-muted-foreground hover:text-foreground",
          )}
        >
          <Star className={cn("h-4 w-4", current.favorite && "fill-amber-400 text-amber-400")} />
          Favoritas
        </button>
        {tags.length > 0 && (
          <select
            value={current.tag}
            onChange={(e) => push({ tag: e.target.value })}
            className="rounded-lg border border-border bg-card px-3 py-2 text-sm outline-none"
          >
            <option value="">Todas as tags</option>
            {tags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-1 rounded-lg border border-border bg-card p-1">
        <FilterChip
          active={!current.status}
          onClick={() => push({ status: "" })}
          label="Todas"
        />
        {STORE_STATUSES.map((s) => (
          <FilterChip
            key={s}
            active={current.status === s}
            onClick={() => push({ status: s })}
            label={STORE_STATUS_LABEL[s]}
          />
        ))}
      </div>
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        "rounded-md px-3 py-1.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary/15 text-primary"
          : "text-muted-foreground hover:text-foreground",
      )}
    >
      {label}
    </button>
  );
}
