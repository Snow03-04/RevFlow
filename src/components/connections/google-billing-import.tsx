"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";

export function GoogleBillingImport({ stores }: { stores: { id: string; label: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false), [message, setMessage] = useState("");
  return <form className="space-y-3 rounded-xl border border-border p-4" onSubmit={async event => {
    event.preventDefault();
    if (busy) return;
    const form = new FormData(event.currentTarget), file = form.get("report") as File;
    if (!file?.size || file.size > 1_000_000) { setMessage("Escolhe um CSV até 1 MB."); return; }
    setBusy(true); setMessage("");
    try {
      const response = await fetch("/api/google/billing-report", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ storeId: form.get("store"), customerId: String(form.get("account")).replace(/\D/g, ""), csv: await file.text() }), signal: AbortSignal.timeout(120_000) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Não foi possível importar.");
      setMessage(`Faturação confirmada e P&L recalculada para ${result.days} dias.`); router.refresh();
    } catch (error) { setMessage(error instanceof Error && error.name !== "TimeoutError" ? error.message : "A confirmação demorou mais do que o esperado. Podes repetir o ficheiro sem duplicar custos."); }
    finally { setBusy(false); }
  }}>
    <h3 className="text-sm font-medium">Confirmar o custo faturado Google</h3>
    <p className="text-xs text-muted-foreground">O Google não fornece o custo faturado na sincronização automática. Exporta o CSV em Relatórios → Faturação → Custo faturado, com todos os orçamentos e dias. A RevFlow retira o excesso confirmado da dashboard e da P&L, mantendo os créditos promocionais.</p>
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="space-y-1 text-xs">Loja<select name="store" required disabled={busy} className="block min-h-11 w-full rounded border border-border bg-background p-2">{stores.map(s => <option key={s.id} value={s.id}>{s.label}</option>)}</select></label>
      <label className="space-y-1 text-xs">Número da conta Google<input name="account" required inputMode="numeric" placeholder="123-456-7890" pattern="[0-9 -]{10,14}" disabled={busy} className="block min-h-11 w-full rounded border border-border bg-background p-2" /></label>
    </div>
    <label className="block space-y-1 text-xs">Relatório CSV<input name="report" type="file" accept=".csv,text/csv" required disabled={busy} className="block min-h-11 max-w-full py-2" /></label>
    <Button type="submit" disabled={busy || !stores.length} className="min-h-11">{busy ? "A confirmar faturação…" : "Importar custo faturado"}</Button>
    {message && <p role="status" className="text-xs">{message}</p>}
  </form>;
}
