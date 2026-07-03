"use client";

import { useState, useRef, useEffect, useTransition } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { ChevronDown, Check } from "lucide-react";
import { updateProduct } from "@/lib/research/actions";
import { STATUSES, STATUS_LABEL, STATUS_CLASS, type ProductStatus } from "@/lib/research/constants";
import { cn } from "@/lib/utils";

export function StatusPicker({
  productId,
  status,
  size = "sm",
}: {
  productId: string;
  status: string;
  size?: "sm" | "md";
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [current, setCurrent] = useState(status);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const [, start] = useTransition();
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Close on outside click / scroll / resize (menu lives in a portal on body).
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (btnRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onScrollResize() {
      setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScrollResize, true);
    window.addEventListener("resize", onScrollResize);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScrollResize, true);
      window.removeEventListener("resize", onScrollResize);
    };
  }, [open]);

  function toggle(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (open) {
      setOpen(false);
      return;
    }
    const r = btnRef.current?.getBoundingClientRect();
    if (r) {
      const left = Math.min(r.left, window.innerWidth - 176); // keep 160px menu on-screen
      setCoords({ top: r.bottom + 4, left: Math.max(8, left) });
    }
    setOpen(true);
  }

  function choose(s: ProductStatus, e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    setCurrent(s);
    setOpen(false);
    start(async () => {
      await updateProduct(productId, { status: s });
      router.refresh();
    });
  }

  const cls = STATUS_CLASS[current as ProductStatus] ?? STATUS_CLASS.untested;

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        className={cn(
          "inline-flex items-center gap-1 rounded-full font-medium transition-colors",
          size === "sm" ? "px-2 py-0.5 text-xs" : "px-2.5 py-1 text-sm",
          cls,
        )}
      >
        {STATUS_LABEL[current as ProductStatus] ?? current}
        <ChevronDown className="h-3 w-3 opacity-70" />
      </button>

      {open &&
        coords &&
        typeof document !== "undefined" &&
        createPortal(
          <div
            ref={menuRef}
            style={{ position: "fixed", top: coords.top, left: coords.left }}
            className="z-[200] w-40 rounded-lg border border-border bg-popover p-1 shadow-xl"
          >
            {STATUSES.map((s) => (
              <button
                key={s}
                onClick={(e) => choose(s, e)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent"
              >
                <span className="flex items-center gap-2">
                  <span className={cn("h-2 w-2 rounded-full", STATUS_CLASS[s])} />
                  {STATUS_LABEL[s]}
                </span>
                {current === s && <Check className="h-3.5 w-3.5 text-primary" />}
              </button>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
