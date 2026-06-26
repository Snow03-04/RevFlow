"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { RANGE_OPTIONS } from "@/lib/date";

/** URL-driven date range picker. Writes `?range=` and refreshes the page. */
export function RangeSelect({ paramKey = "range" }: { paramKey?: string }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const current = searchParams.get(paramKey) ?? "30d";

  function onChange(value: string) {
    const params = new URLSearchParams(searchParams.toString());
    params.set(paramKey, value);
    router.push(`${pathname}?${params.toString()}`);
  }

  return (
    <Select value={current} onValueChange={onChange}>
      <SelectTrigger className="w-[160px]">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {RANGE_OPTIONS.map((o) => (
          <SelectItem key={o.value} value={o.value}>
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
