"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { NAV_ITEMS } from "@/components/dashboard/nav";
import { cn } from "@/lib/utils";

/** Instant active-item highlight: the clicked link lights up immediately
 *  (optimistic) instead of waiting for the navigation to commit. */
function useOptimisticPath(): [string, (href: string) => void] {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname]);
  return [pending ?? pathname, setPending];
}

export function Sidebar() {
  const [current, setPending] = useOptimisticPath();

  return (
    <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col self-start border-r border-border bg-card/40 lg:flex">
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard">
          <Logo />
        </Link>
      </div>
      <nav className="flex-1 space-y-1 px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const active =
            current === item.href || current.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={() => setPending(item.href)}
              className={cn(
                "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}
      </nav>
      <div className="px-3 pb-4">
        <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground">
          <p className="font-medium text-foreground">Auto-sync on</p>
          <p className="mt-1">Data refreshes every 15 minutes.</p>
        </div>
      </div>
    </aside>
  );
}

/** Mobile horizontal nav shown under the top bar on small screens. */
export function MobileNav() {
  const [current, setPending] = useOptimisticPath();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 lg:hidden scrollbar-thin">
      {NAV_ITEMS.map((item) => {
        const active =
          current === item.href || current.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => setPending(item.href)}
            className={cn(
              "flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-1.5 text-sm font-medium",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
