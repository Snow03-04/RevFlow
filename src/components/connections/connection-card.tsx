"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import { Loader2, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  disconnectShopifyAction,
  disconnectMetaAction,
  disconnectGoogleAction,
} from "@/lib/connections/actions";

export function ConnectionCard({
  provider,
  id,
  title,
  subtitle,
  status,
  lastSyncedAt,
  error,
}: {
  provider: "shopify" | "meta" | "google";
  id: string;
  title: string;
  subtitle: string;
  status: string;
  lastSyncedAt: string | null;
  error: string | null;
}) {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function disconnect() {
    startTransition(async () => {
      const fn =
        provider === "shopify"
          ? disconnectShopifyAction
          : provider === "google"
            ? disconnectGoogleAction
            : disconnectMetaAction;
      await fn(id);
      router.refresh();
    });
  }

  const statusVariant =
    status === "active" ? "success" : status === "error" ? "destructive" : "muted";

  return (
    <div className="flex items-start justify-between gap-4 rounded-lg border border-border bg-background/50 p-4">
      <div className="min-w-0 space-y-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-medium">{title}</p>
          <Badge variant={statusVariant as any}>{status}</Badge>
        </div>
        <p className="truncate text-xs text-muted-foreground">{subtitle}</p>
        <p className="text-xs text-muted-foreground">
          {lastSyncedAt
            ? `Last synced ${formatDistanceToNow(new Date(lastSyncedAt), {
                addSuffix: true,
              })}`
            : "Awaiting first sync…"}
        </p>
        {error && (
          <p className="text-xs text-destructive">Sync error: {error}</p>
        )}
      </div>
      <Button
        variant="ghost"
        size="sm"
        onClick={disconnect}
        disabled={isPending}
        className="text-muted-foreground hover:text-destructive"
      >
        {isPending ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : (
          <Trash2 className="h-4 w-4" />
        )}
      </Button>
    </div>
  );
}
