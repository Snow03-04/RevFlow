"use client";

import { useLayoutEffect, useRef, useState } from "react";
import { Maximize2 } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";

/** Dense campaign sheets only. The main editable Finance sheet is untouched. */
export function CampaignSheet({ title, period, children }: { title: string; period: string; children: React.ReactNode }) {
  const [detailed, setDetailed] = useState(false);
  const [open, setOpen] = useState(false);
  const controls = <label className="flex cursor-pointer items-center gap-2 text-[11px] text-muted-foreground"><input type="checkbox" checked={detailed} onChange={(e) => setDetailed(e.target.checked)} className="accent-primary" />Todas as colunas</label>;
  return <>
    <section className="overflow-hidden rounded-lg border border-border bg-card">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2"><span className="text-xs font-medium">{period} <span className="ml-2 text-[10px] font-normal text-muted-foreground">Vista compacta</span></span><div className="flex items-center gap-4">{controls}<button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1.5 rounded px-2 py-1 text-xs text-primary hover:bg-primary/10"><Maximize2 className="h-3 w-3" />Mês inteiro</button></div></div>
      <div className="campaign-sheet" data-detailed={detailed}>{children}</div>
    </section>
    <Dialog open={open} onOpenChange={setOpen}><DialogContent className="flex h-[calc(100dvh-24px)] w-[calc(100vw-24px)] max-w-none flex-col rounded-xl p-3 data-[state=open]:animate-none sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2 pr-10"><div className="min-w-0"><DialogTitle className="truncate text-sm">{title} · {period}</DialogTitle><DialogDescription className="text-[11px]">Todos os dias e o total na mesma vista. Esc para fechar.</DialogDescription></div>{controls}</div>
      <FitSheet detailed={detailed}>{children}</FitSheet>
    </DialogContent></Dialog>
  </>;
}

function FitSheet({ detailed, children }: { detailed: boolean; children: React.ReactNode }) {
  const viewport = useRef<HTMLDivElement>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  useLayoutEffect(() => {
    const frame = viewport.current, content = sheet.current;
    if (!frame || !content) return;
    function fit() {
      const table = content!.querySelector("table");
      if (!table) return;
      // offset dimensions ignore the transform, avoiding measurement feedback.
      setScale(Math.min(1, frame!.clientWidth / Math.max(1, table.offsetWidth), frame!.clientHeight / Math.max(1, table.offsetHeight)));
    }
    const observer = new ResizeObserver(fit);
    observer.observe(frame);
    const table = content.querySelector("table");
    if (table) observer.observe(table);
    fit();
    return () => observer.disconnect();
  }, [detailed]);
  return <div ref={viewport} className="mt-3 min-h-0 flex-1 overflow-hidden"><div ref={sheet} className="campaign-sheet campaign-sheet-fit" data-detailed={detailed} style={{ transform: `scale(${scale})`, transformOrigin: "top left" }}>{children}</div></div>;
}
