"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncNowAction } from "@/lib/connections/actions";
import { cn } from "@/lib/utils";

export function SyncButton({ className }: { className?: string }) {
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function onClick() {
    setError(null);
    startTransition(async () => {
      const res = await syncNowAction();
      if (!res.ok) setError(res.error ?? "Sync failed");
      else router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-xs text-destructive">{error}</span>}
      <Button
        variant="outline"
        size="sm"
        onClick={onClick}
        disabled={isPending}
        className={className}
      >
        <RefreshCw className={cn("h-4 w-4", isPending && "animate-spin")} />
        {isPending ? "Syncing…" : "Sync now"}
      </Button>
    </div>
  );
}
