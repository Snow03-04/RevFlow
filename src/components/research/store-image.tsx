"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw, Loader2, Store } from "lucide-react";
import { refetchStoreImage } from "@/lib/research/store-actions";
import { Button } from "@/components/ui/button";

export function StoreImage({
  storeId,
  imageUrl,
  hasUrl,
}: {
  storeId: string;
  imageUrl: string | null;
  hasUrl: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<string | null>(null);

  function refetch() {
    setMsg(null);
    start(async () => {
      const res = await refetchStoreImage(storeId);
      if (!res.ok) setMsg(res.error ?? "Falha ao obter a imagem.");
      router.refresh();
    });
  }

  return (
    <div className="space-y-2">
      <div className="aspect-square w-full overflow-hidden rounded-xl border border-border/60 bg-muted">
        {imageUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={imageUrl} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
        ) : (
          <div className="flex h-full w-full items-center justify-center">
            <Store className="h-10 w-10 text-muted-foreground/40" />
          </div>
        )}
      </div>
      {hasUrl && (
        <Button
          variant="outline"
          size="sm"
          onClick={refetch}
          disabled={pending}
          className="w-full"
        >
          {pending ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <RefreshCw className="h-4 w-4" />
          )}
          Atualizar imagem
        </Button>
      )}
      {msg && <p className="text-xs text-muted-foreground">{msg}</p>}
    </div>
  );
}
