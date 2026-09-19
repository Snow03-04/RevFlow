"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { Logo } from "@/components/brand";
import { NAV_SECTIONS } from "@/components/dashboard/nav";
import { cn } from "@/lib/utils";

/** Instant active-item highlight: the clicked link lights up immediately
 *  (optimistic) instead of waiting for the navigation to commit. */
function useOptimisticPath(): [string, (href: string) => void] {
  const pathname = usePathname();
  const [pending, setPending] = useState<string | null>(null);
  useEffect(() => setPending(null), [pathname]);
  return [pending ?? pathname, setPending];
}

/** Carry the header's `?store=` selection across nav clicks — every dashboard
 *  page reads it from its own URL (see StoreSwitcher), so a plain `href="/costs"`
 *  silently reset the selection back to "Todas as lojas" on every navigation. */
function useStoreParam(): string | null {
  return useSearchParams().get("store");
}

function withStoreParam(href: string, store: string | null): string {
  return store ? `${href}?store=${store}` : href;
}

export function Sidebar() {
  const [current, setPending] = useOptimisticPath();
  const store = useStoreParam();

  return (
    <aside className="app-sidebar sticky top-0 hidden h-screen w-56 shrink-0 flex-col self-start border-r border-border bg-card/40 lg:flex">
      <div className="flex h-16 items-center px-6">
        <Link href="/dashboard">
          <Logo />
        </Link>
      </div>
      <nav aria-label="Menu principal" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-3 py-3 scrollbar-thin">
        {NAV_SECTIONS.map((section) => <section key={section.label} aria-label={section.label}>
          <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground/60">{section.label}</p>
        {section.items.map((item) => {
          const active =
            current === item.href || current.startsWith(`${item.href}/`);
          return (
            <Link
              key={item.href}
              href={withStoreParam(item.href, store)}
              onClick={() => setPending(item.href)}
              aria-current={active ? "page" : undefined}
              className={cn(
                "app-nav-link flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
                active
                  ? "bg-primary/10 text-primary"
                  : "text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </Link>
          );
        })}</section>)}
      </nav>
      <div className="px-3 pb-4">
        <div className="rounded-lg border border-border bg-background/60 p-3 text-xs text-muted-foreground">
          <p className="flex items-center gap-2 font-medium text-foreground"><span className="h-1.5 w-1.5 rounded-full bg-primary" /> Atualização automática</p>
          <p className="mt-1.5 leading-relaxed">Ao abrir, ao regressar à app e a cada 2 minutos.</p>
        </div>
      </div>
    </aside>
  );
}

/** Mobile horizontal nav shown under the top bar on small screens. */
export function MobileNav() {
  const [current, setPending] = useOptimisticPath();
  const store = useStoreParam();
  return (
    <nav className="flex gap-1 overflow-x-auto border-b border-border px-2 py-2 lg:hidden scrollbar-thin">
      {NAV_SECTIONS.map((section) => <div key={section.label} aria-label={section.label} className="flex shrink-0 items-center gap-1 border-r border-border pr-2 last:border-0">
        <span className="px-2 text-[10px] uppercase tracking-wider text-muted-foreground/60">{section.label}</span>
      {section.items.map((item) => {
        const active =
          current === item.href || current.startsWith(`${item.href}/`);
        return (
          <Link
            key={item.href}
            href={withStoreParam(item.href, store)}
            onClick={() => setPending(item.href)}
            aria-current={active ? "page" : undefined}
            className={cn(
              "app-nav-link flex items-center gap-2 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium",
              active
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:bg-accent",
            )}
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </Link>
        );
      })}</div>)}
    </nav>
  );
}
