"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface GoogleAdsScriptOption {
  storeId: string;
  label: string;
  script: string;
}

/**
 * Per-store Google Ads Script that pushes the account's daily cost into RevFlow
 * as "Google <store> …" despesas — automatic Google spend without API access.
 */
export function GoogleAdsScript({ options }: { options: GoogleAdsScriptOption[] }) {
  const [storeId, setStoreId] = useState(options[0]?.storeId ?? "");
  const [copied, setCopied] = useState(false);
  const current = options.find((o) => o.storeId === storeId) ?? options[0];
  if (!current) return null;

  function copy() {
    navigator.clipboard?.writeText(current.script).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="space-y-1">
        <p className="text-sm font-medium">Custos automáticos (script)</p>
        <p className="text-xs text-muted-foreground">
          Na conta Google Ads da loja: Ferramentas → Ações em massa → Scripts →
          novo script, colar, autorizar e agendar &quot;De hora a hora&quot;. O
          custo de cada dia entra como despesa &quot;Google {current.label} …&quot;.
        </p>
      </div>
      <div className="flex gap-2">
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
      </div>
      <textarea
        readOnly
        value={current.script}
        data-google-ads-script={current.storeId}
        className="h-40 w-full resize-y rounded-md border border-input bg-muted/40 p-2 font-mono text-[11px] leading-snug"
        onFocus={(e) => e.currentTarget.select()}
      />
    </div>
  );
}
