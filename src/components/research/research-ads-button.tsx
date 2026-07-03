"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Search, Loader2 } from "lucide-react";
import { researchProductAds } from "@/lib/research/actions";
import { Button } from "@/components/ui/button";

/**
 * "Procurar anúncios" — auto-finds ads for the product from the Meta Ad Library
 * (store page + keywords). Optionally runs once on mount (first visit).
 */
export function ResearchAdsButton({
  productId,
  auto = false,
}: {
  productId: string;
  auto?: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);
  const ran = useRef(false);

  function run() {
    setMsg(null);
    start(async () => {
      const res = await researchProductAds(productId);
      if (!res.ok) setMsg(res.error ?? "Falha na pesquisa.");
      else
        setMsg(
          res.added
            ? `+${res.added} anúncio(s) encontrado(s)`
            : "Sem anúncios novos.",
        );
      router.refresh();
    });
  }

  useEffect(() => {
    if (auto && !ran.current) {
      ran.current = true;
      run();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auto]);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="outline" onClick={run} disabled={pending}>
        {pending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Search className="h-4 w-4" />
        )}
        Procurar anúncios
      </Button>
      {pending ? (
        <span className="text-xs text-muted-foreground">
          A pesquisar na Meta Ad Library…
        </span>
      ) : (
        msg && <span className="text-xs text-muted-foreground">{msg}</span>
      )}
    </div>
  );
}
