"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  useTransition,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { usePathname } from "next/navigation";
import {
  Sparkles,
  Send,
  X,
  Loader2,
  Check,
  AlertTriangle,
  Zap,
  Command,
  AudioLines,
} from "lucide-react";
import { applyProductCostAction } from "@/lib/assistant/actions";
import { VoiceMode } from "@/components/assistant/voice-mode";
import { formatCurrency } from "@/lib/utils";

interface PendingAction {
  type: "set_product_cost";
  productId: string;
  title: string;
  cost: number;
  currency: string;
}

interface Message {
  id: string;
  role: "user" | "assistant";
  text: string;
  activities: string[];
  pending: PendingAction[];
}

const PAGE_NAMES: Record<string, string> = {
  dashboard: "Dashboard",
  products: "Produtos",
  costs: "Custos (COGS)",
  ads: "Ads",
  pnl: "P&L Sheet",
  roas: "ROAS Tracker",
  connections: "Ligações",
  settings: "Definições",
};

const SUGGESTIONS = [
  "Como está o lucro hoje vs ontem?",
  "Que produtos estão a perder dinheiro?",
  "Que campanhas devo matar ou escalar?",
  "Atualiza o ad spend e diz-me o ROAS de hoje",
];

function uid() {
  return typeof crypto !== "undefined" && crypto.randomUUID
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/** Tiny markdown-ish renderer: **bold**, bullet lines, paragraphs. */
function rich(text: string): ReactNode {
  const lines = text.split("\n");
  const out: ReactNode[] = [];
  let bullets: ReactNode[] = [];
  const flush = () => {
    if (bullets.length) {
      out.push(
        <ul key={`u${out.length}`} className="my-1 space-y-1 pl-1">
          {bullets}
        </ul>,
      );
      bullets = [];
    }
  };
  const inline = (s: string) =>
    s.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
      part.startsWith("**") && part.endsWith("**") ? (
        <strong key={i} className="font-semibold text-foreground">
          {part.slice(2, -2)}
        </strong>
      ) : (
        <span key={i}>{part}</span>
      ),
    );
  for (const raw of lines) {
    const line = raw.trimEnd();
    const m = line.match(/^\s*[-•*]\s+(.*)$/);
    if (m) {
      bullets.push(
        <li key={`b${out.length}-${bullets.length}`} className="flex gap-2">
          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary/70" />
          <span>{inline(m[1])}</span>
        </li>,
      );
    } else {
      flush();
      if (line.trim())
        out.push(
          <p key={`p${out.length}`} className="leading-relaxed">
            {inline(line)}
          </p>,
        );
    }
  }
  flush();
  return out;
}

export function Assistant() {
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [view, setView] = useState<"chat" | "voice">("chat");
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState(false);
  const [applied, setApplied] = useState<Record<string, "done" | "error">>({});
  const [, startApply] = useTransition();

  const pathname = usePathname();
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => setMounted(true), []);

  // ⌘K / Ctrl+K to toggle, Esc to close.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 50);
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, thinking]);

  const pageName = (() => {
    const seg = (pathname ?? "").split("/").filter(Boolean).pop() ?? "dashboard";
    return PAGE_NAMES[seg] ?? "Dashboard";
  })();

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      const priorForApi = messages.map((m) => ({ role: m.role, content: m.text }));
      const userMsg: Message = {
        id: uid(),
        role: "user",
        text: trimmed,
        activities: [],
        pending: [],
      };
      const asstId = uid();
      setMessages((prev) => [
        ...prev,
        userMsg,
        { id: asstId, role: "assistant", text: "", activities: [], pending: [] },
      ]);
      setInput("");
      setBusy(true);
      setThinking(true);

      const patch = (fn: (m: Message) => Message) =>
        setMessages((prev) => prev.map((m) => (m.id === asstId ? fn(m) : m)));

      try {
        const res = await fetch("/api/assistant", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            messages: [...priorForApi, { role: "user", content: trimmed }],
            context: {
              page: pageName,
              mode: view,
              period:
                typeof window !== "undefined"
                  ? new URLSearchParams(window.location.search).get("period") ?? undefined
                  : undefined,
            },
          }),
        });
        if (!res.ok) {
          // Surface a typed error (e.g. missing Gemini key) instead of a generic one.
          let msg = "A IA não respondeu.";
          try {
            const j = await res.json();
            if (j?.message) msg = String(j.message);
          } catch {
            /* keep the default */
          }
          throw new Error(msg);
        }
        if (!res.body) throw new Error("A IA não respondeu.");

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buf = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          buf += decoder.decode(value, { stream: true });
          const parts = buf.split("\n\n");
          buf = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.trim();
            if (!line.startsWith("data:")) continue;
            let evt: Record<string, unknown>;
            try {
              evt = JSON.parse(line.slice(5).trim());
            } catch {
              continue;
            }
            switch (evt.type) {
              case "text":
                setThinking(false);
                patch((m) => ({ ...m, text: m.text + String(evt.text ?? "") }));
                break;
              case "thinking":
                setThinking(true);
                break;
              case "activity":
                setThinking(false);
                patch((m) => ({ ...m, activities: [...m.activities, String(evt.label)] }));
                break;
              case "pending_action":
                patch((m) => ({
                  ...m,
                  pending: [...m.pending, evt.action as PendingAction],
                }));
                break;
              case "error":
                patch((m) => ({
                  ...m,
                  text: m.text + `\n\n⚠️ ${String(evt.message)}`,
                }));
                break;
            }
          }
        }
      } catch (err) {
        patch((m) => ({
          ...m,
          text: m.text || `⚠️ ${err instanceof Error ? err.message : "Falha."}`,
        }));
      } finally {
        setBusy(false);
        setThinking(false);
      }
    },
    [busy, messages, pageName, view],
  );

  function confirmCost(a: PendingAction) {
    startApply(async () => {
      const res = await applyProductCostAction(a.productId, a.cost);
      setApplied((p) => ({ ...p, [a.productId]: res.ok ? "done" : "error" }));
    });
  }

  return (
    <>
      {/* Launcher */}
      <button
        onClick={() => setOpen(true)}
        className="group flex items-center gap-2 rounded-full border border-primary/30 bg-gradient-to-r from-primary/15 to-purple-500/10 px-3 py-1.5 text-sm font-medium text-foreground shadow-sm transition-all hover:border-primary/50 hover:from-primary/25"
        title="Abrir o assistente (⌘K)"
      >
        <Sparkles className="h-4 w-4 text-primary" />
        <span className="hidden sm:inline">Assistente</span>
        <kbd className="hidden items-center gap-0.5 rounded border border-border bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground sm:flex">
          <Command className="h-2.5 w-2.5" />K
        </kbd>
      </button>

      {mounted && open && view === "chat" && createPortal(
        <div className="fixed inset-0 z-[100] flex justify-end">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-background/40 backdrop-blur-sm animate-fade-in"
            onClick={() => setOpen(false)}
          />

          {/* Panel */}
          <div className="relative flex h-dvh w-full max-w-lg flex-col border-l border-border bg-card shadow-2xl">
            <header className="flex items-center justify-between border-b border-border px-4 py-3">
              <div className="flex items-center gap-2.5">
                <div className="relative flex h-8 w-8 items-center justify-center rounded-lg bg-gradient-to-br from-primary to-purple-500">
                  <Sparkles className="h-4 w-4 text-white" />
                  <span className="absolute -inset-0.5 rounded-lg bg-primary/30 blur animate-pulse" />
                </div>
                <div className="leading-tight">
                  <p className="text-sm font-semibold">RevFlow Intelligence</p>
                  <p className="text-[11px] text-muted-foreground">
                    Analista de negócio · {pageName}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-0.5">
                <button
                  onClick={() => setView("voice")}
                  title="Modo voz"
                  className="rounded-md p-1.5 text-primary hover:bg-primary/10"
                >
                  <AudioLines className="h-4 w-4" />
                </button>
                <button
                  onClick={() => setOpen(false)}
                  className="rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </header>

            {/* Messages */}
            <div ref={scrollRef} className="flex-1 space-y-4 overflow-y-auto px-4 py-4 scrollbar-thin">
              {messages.length === 0 && (
                <div className="flex h-full flex-col items-center justify-center gap-5 text-center">
                  <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/20 to-purple-500/20">
                    <Sparkles className="h-7 w-7 text-primary" />
                  </div>
                  <div className="space-y-1">
                    <p className="text-base font-semibold">Olá 👋 Sou o teu analista.</p>
                    <p className="text-sm text-muted-foreground">
                      Pergunta-me sobre lucro, ROAS, produtos ou campanhas — uso os teus dados reais.
                    </p>
                  </div>
                  <div className="w-full space-y-2">
                    {SUGGESTIONS.map((s) => (
                      <button
                        key={s}
                        onClick={() => send(s)}
                        className="flex w-full items-center gap-2 rounded-xl border border-border bg-background/50 px-3 py-2.5 text-left text-sm text-foreground transition-colors hover:border-primary/40 hover:bg-primary/5"
                      >
                        <Zap className="h-3.5 w-3.5 shrink-0 text-primary" />
                        {s}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {messages.map((m) =>
                m.role === "user" ? (
                  <div key={m.id} className="flex justify-end">
                    <div className="max-w-[85%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2 text-sm text-primary-foreground">
                      {m.text}
                    </div>
                  </div>
                ) : (
                  <div key={m.id} className="space-y-2">
                    {m.activities.length > 0 && (
                      <div className="flex flex-wrap gap-1.5">
                        {m.activities.map((a, i) => (
                          <span
                            key={i}
                            className="flex items-center gap-1 rounded-full bg-primary/10 px-2 py-0.5 text-[11px] text-primary"
                          >
                            <Check className="h-2.5 w-2.5" /> {a}
                          </span>
                        ))}
                      </div>
                    )}
                    {m.text && (
                      <div className="space-y-2 text-[15px] leading-relaxed text-foreground/90">
                        {rich(m.text)}
                      </div>
                    )}
                    {m.pending.map((a) => {
                      const state = applied[a.productId];
                      return (
                        <div
                          key={a.productId}
                          className="rounded-xl border border-amber-500/30 bg-amber-500/5 p-3"
                        >
                          <p className="text-xs text-muted-foreground">Ação a confirmar</p>
                          <p className="mt-0.5 text-sm font-medium">
                            Definir COGS de <strong>{a.title}</strong> para{" "}
                            <strong>{formatCurrency(a.cost, a.currency)}</strong>
                          </p>
                          {state === "done" ? (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-emerald-400">
                              <Check className="h-3.5 w-3.5" /> Aplicado e recalculado ✓
                            </p>
                          ) : state === "error" ? (
                            <p className="mt-2 flex items-center gap-1.5 text-xs text-red-400">
                              <AlertTriangle className="h-3.5 w-3.5" /> Falhou — tenta no painel Custos.
                            </p>
                          ) : (
                            <div className="mt-2.5 flex gap-2">
                              <button
                                onClick={() => confirmCost(a)}
                                className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
                              >
                                Confirmar
                              </button>
                              <button
                                onClick={() =>
                                  setApplied((p) => ({ ...p, [a.productId]: "error" }))
                                }
                                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                              >
                                Cancelar
                              </button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                ),
              )}

              {thinking && (
                <div className="flex items-center gap-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3.5 w-3.5 animate-spin text-primary" />
                  A analisar os teus dados…
                </div>
              )}
            </div>

            {/* Composer */}
            <div className="border-t border-border p-3">
              <div className="flex items-end gap-2 rounded-2xl border border-border bg-background/60 px-3 py-2 focus-within:border-primary/50">
                <textarea
                  ref={inputRef}
                  rows={1}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !e.shiftKey) {
                      e.preventDefault();
                      send(input);
                    }
                  }}
                  placeholder="Pergunta sobre o teu negócio…"
                  className="max-h-32 flex-1 resize-none bg-transparent text-sm outline-none placeholder:text-muted-foreground"
                />
                <button
                  onClick={() => send(input)}
                  disabled={busy || !input.trim()}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-opacity disabled:opacity-40"
                >
                  {busy ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Send className="h-4 w-4" />
                  )}
                </button>
              </div>
              <p className="mt-1.5 px-1 text-[10px] text-muted-foreground">
                Sugestões, não aconselhamento financeiro. Pode cometer erros — confirma números importantes.
              </p>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {mounted &&
        open &&
        view === "voice" &&
        createPortal(
          <VoiceMode
            messages={messages.map((m) => ({ id: m.id, role: m.role, text: m.text }))}
            busy={busy}
            onSend={send}
            onClose={() => setOpen(false)}
            onChat={() => setView("chat")}
          />,
          document.body,
        )}
    </>
  );
}
