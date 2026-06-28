"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Languages, Loader2, Check, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { LANGUAGES, CURRENCIES } from "@/lib/products/languages";
import { localizeProductsAction } from "@/lib/products/actions";
import { cn } from "@/lib/utils";

export function LocalizeProducts({
  defaultFrom,
  defaultTo,
  currentLang,
}: {
  defaultFrom: string;
  defaultTo: string;
  currentLang?: string;
}) {
  const router = useRouter();
  const params = useSearchParams();

  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [lang, setLang] = useState(currentLang ?? "pt");
  const [from, setFrom] = useState(defaultFrom);
  const [to, setTo] = useState(defaultTo);
  const [charm, setCharm] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<number | null>(null);
  const [pending, start] = useTransition();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return LANGUAGES;
    return LANGUAGES.filter(
      (l) => l.name.toLowerCase().includes(q) || l.code.toLowerCase().includes(q),
    );
  }, [query]);

  const selectedName = LANGUAGES.find((l) => l.code === lang)?.name ?? lang;

  function run() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await localizeProductsAction({
        lang,
        fromCurrency: from,
        toCurrency: to,
        charm,
      });
      if (!res.ok) {
        setError(res.error ?? "Falha ao localizar.");
        return;
      }
      setDone(res.count ?? 0);
      const sp = new URLSearchParams(params.toString());
      sp.set("lang", lang);
      router.push(`/products?${sp.toString()}`);
      router.refresh();
    });
  }

  return (
    <div className="relative">
      <Button variant="outline" size="sm" onClick={() => setOpen((v) => !v)}>
        <Languages className="h-4 w-4" /> Localizar produtos
      </Button>

      {open && (
        <div className="absolute right-0 z-40 mt-2 w-80 rounded-xl border border-border bg-card p-4 shadow-xl">
          <label className="text-xs font-medium text-muted-foreground">Idioma</label>
          <div className="mt-1 flex items-center gap-2 rounded-lg border border-border px-2">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={`Pesquisar… (atual: ${selectedName})`}
              className="w-full bg-transparent py-2 text-sm outline-none"
            />
          </div>
          <div className="mt-1 max-h-40 overflow-y-auto rounded-lg border border-border scrollbar-thin">
            {filtered.map((l) => (
              <button
                key={l.code}
                type="button"
                onClick={() => {
                  setLang(l.code);
                  setQuery("");
                }}
                className={cn(
                  "flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-accent",
                  l.code === lang && "bg-accent",
                )}
              >
                {l.name}
                {l.code === lang && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
            {filtered.length === 0 && (
              <p className="px-3 py-2 text-xs text-muted-foreground">Sem resultados</p>
            )}
          </div>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Moeda origem
              </label>
              <select
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground">
                Moeda destino
              </label>
              <select
                value={to}
                onChange={(e) => setTo(e.target.value)}
                className="mt-1 w-full rounded-lg border border-border bg-transparent px-2 py-2 text-sm"
              >
                {CURRENCIES.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.code}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <label className="mt-3 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={charm}
              onChange={(e) => setCharm(e.target.checked)}
            />
            Preços a acabar em 9 (ex.: 123 → 129)
          </label>

          {error && <p className="mt-2 text-xs text-destructive">{error}</p>}
          {done != null && (
            <p className="mt-2 text-xs text-emerald-500">
              {done} produtos localizados.
            </p>
          )}

          <Button onClick={run} disabled={pending} size="sm" className="mt-3 w-full">
            {pending ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Languages className="h-4 w-4" />
            )}
            Traduzir &amp; converter
          </Button>
          <p className="mt-2 text-[11px] text-muted-foreground">
            Tradução grátis (deteta o idioma de origem). Não altera a tua loja
            Shopify.
          </p>
        </div>
      )}
    </div>
  );
}
