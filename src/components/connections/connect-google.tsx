"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, FlaskConical } from "lucide-react";
import { Button } from "@/components/ui/button";
import { connectGoogleMockAction } from "@/lib/connections/actions";

/**
 * Secondary "demo" button — seeds MOCK Google Ads data (no real OAuth). Handy to
 * preview the cross-platform dashboard before real credentials are set up.
 */
export function ConnectGoogleMock() {
  const [isPending, startTransition] = useTransition();
  const router = useRouter();

  function connect() {
    startTransition(async () => {
      const res = await connectGoogleMockAction();
      if (!res.ok) alert(res.error ?? "Falha ao criar dados de exemplo.");
      router.refresh();
    });
  }

  return (
    <Button
      onClick={connect}
      disabled={isPending}
      variant="outline"
      className="w-full"
    >
      {isPending ? (
        <Loader2 className="h-4 w-4 animate-spin" />
      ) : (
        <FlaskConical className="h-4 w-4" />
      )}
      Ver com dados de exemplo (demo)
    </Button>
  );
}
