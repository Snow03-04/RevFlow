"use client";

import Link, { useLinkStatus } from "next/link";
import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";

function NavigationProgress() {
  const { pending } = useLinkStatus();
  return pending ? <Loader2 aria-hidden="true" className="ml-auto h-3 w-3 shrink-0 animate-spin" /> : null;
}

/** Prefetch only the menu being approached, not every expensive page at once.
 * Keep Next's automatic/partial mode: dynamic financial data still loads fresh.
 * Native Link navigation preserves modifier clicks, history and cancellation. */
export function MenuLink({ href, active, onNavigate, className, children }: {
  href: string; active: boolean; onNavigate: () => void; className: string; children: React.ReactNode;
}) {
  const [intent, setIntent] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  function cancel() {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setIntent(false);
  }
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, [href]);
  return <Link href={href} prefetch={intent ? null : false}
    onMouseEnter={() => { if (!active) timer.current = setTimeout(() => setIntent(true), 100); }}
    onMouseLeave={cancel} onFocus={() => { if (!active) setIntent(true); }} onBlur={cancel}
    onTouchStart={() => { if (!active) setIntent(true); }}
    onNavigate={onNavigate} aria-current={active ? "page" : undefined} className={className}>
    {children}<NavigationProgress />
  </Link>;
}
