"use client";

import { useState } from "react";
import { Check, Copy, Download } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GoogleAdsScriptOption {
  storeId: string;
  label: string;
  script: string;
  localTesting?: boolean;
}

/**
 * Per-store Google Ads Script that pushes the account's daily cost into RevFlow
 * as "Google <store> …" despesas — automatic Google spend without API access.
 */
export function GoogleAdsScript({ options }: { options: GoogleAdsScriptOption[] }) {
  const [storeId, setStoreId] = useState(options[0]?.storeId ?? "");
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const current = options.find((o) => o.storeId === storeId) ?? options[0];
  if (!current) return null;

  async function copy() {
    try {
      await navigator.clipboard.writeText(current.script);
      setCopyError(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopyError(true); }
  }

  function download() {
    const url = URL.createObjectURL(new Blob([current.script], { type: "text/javascript;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `revflow-google-ads-v5-${current.label.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.js`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Custos, campanhas e histórico · v5</p>
        <p className="text-xs text-muted-foreground">
          Na conta Google Ads da loja: Ferramentas → Ações em massa → Scripts.
          Abre o script RevFlow existente e substitui o conteúdo por esta versão. O
          custo de cada dia entra como despesa &quot;Google {current.label} …&quot;.
        </p>
        <p className="text-xs text-muted-foreground">{current.localTesting ? "Envia para a versão online e para o localhost. A ligação local é temporária e precisa do PC ligado; se falhar, o envio online continua." : "A versão online da RevFlow precisa de suportar campanhas e coleções."} Guarda e executa o script uma vez, mantendo o agendamento de hora a hora. Importa alterações de orçamento, estado e lances dos últimos 30 dias, além de hoje e dos 31 dias anteriores, com as páginas dos anúncios para organizar Finance → Google por coleção.</p>
        <p className="text-xs text-muted-foreground">Lê automaticamente os créditos concedidos pelo Google e o saldo disponível. Dashboard e P&L descontam os anúncios cobertos por crédito; ROAS, CPC e scale usam o gasto bruto. Se o Google não permitir confirmar o valor pago, a importação pede a conferência da faturação antes de alterar despesas.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {options.length > 1 && (
          <select
            value={current.storeId}
            onChange={(e) => setStoreId(e.target.value)}
            className="h-9 flex-1 rounded-md border border-input bg-background px-2 text-sm"
          >
            {options.map((o) => (
              <option key={o.storeId} value={o.storeId}>
                {o.label}
              </option>
            ))}
          </select>
        )}
        <Button onClick={copy} variant="outline" className="flex-1">
          {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
          {copied ? "Copiado" : "Copiar script"}
        </Button>
        <Button onClick={download} variant="outline" className="flex-1"><Download className="h-4 w-4" />Descarregar .js</Button>
      </div>
      {copyError && <p role="status" className="text-xs text-muted-foreground">Não foi possível copiar. Usa “Descarregar .js” ou seleciona o texto abaixo.</p>}
      <textarea
        readOnly
        aria-label={`Script Google Ads v5 — ${current.label}`}
        value={current.script}
        data-google-ads-script={current.storeId}
        className="h-40 w-full resize-y rounded-md border border-input bg-muted/40 p-2 font-mono text-[11px] leading-snug"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
