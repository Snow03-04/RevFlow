"use client";

import { useTransition } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Store } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const ALL = "all";

/**
 * Global store picker (lives in the dashboard header). Selecting a store — or
 * "Todas as lojas" — writes `?store=<id>` to the URL and pushes a client-side
 * navigation, so the dashboard's keyed <Suspense> swaps to a skeleton and
 * streams the fresh numbers in WITHOUT a full page reload. The selection is read
 * back from the URL, so it survives refreshes and shareable links.
 */
export function StoreSwitcher({
  stores,
}: {
  stores: { id: string; label: string }[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [isPending, startTransition] = useTransition();

  // Nothing to switch between until a store is connected.
  if (stores.length === 0) return null;

  const current = searchParams.get("store") ?? ALL;

  function change(value: string) {
    if (value === current) return;
    const params = new URLSearchParams(searchParams.toString());
    if (value === ALL) params.delete("store");
    else params.set("store", value);
    const qs = params.toString();
    startTransition(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }

  return (
    <Select value={current} onValueChange={change}>
      <SelectTrigger
        aria-label="Selecionar loja"
        className="h-9 w-[190px] gap-2 data-[pending]:opacity-60"
        data-pending={isPending ? "" : undefined}
      >
        <Store className="h-4 w-4 shrink-0 opacity-70" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>Todas as lojas</SelectItem>
        {stores.map((s) => (
          <SelectItem key={s.id} value={s.id}>
            {s.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
