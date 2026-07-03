"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Plus, Loader2 } from "lucide-react";
import { addAdByLink } from "@/lib/research/actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function AddAdForm({ productId }: { productId: string }) {
  const router = useRouter();
  const [link, setLink] = useState("");
  const [pending, start] = useTransition();

  function submit() {
    if (!link.trim()) return;
    start(async () => {
      const res = await addAdByLink(productId, link);
      if (!res.ok) {
        alert(res.error ?? "Falha ao adicionar anúncio.");
        return;
      }
      setLink("");
      router.refresh();
    });
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Input
        value={link}
        onChange={(e) => setLink(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && submit()}
        placeholder="Cola o link do anúncio da Meta Ad Library…"
        className="min-w-0 flex-1"
      />
      <Button onClick={submit} disabled={pending || !link.trim()}>
        {pending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
        Adicionar anúncio
      </Button>
    </div>
  );
}
