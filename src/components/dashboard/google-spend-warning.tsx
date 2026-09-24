import Link from "next/link";
import { AlertCircle } from "lucide-react";
import type { GoogleScriptWarning } from "@/lib/google/script-health";
import { formatCurrency } from "@/lib/utils";

export function GoogleSpendWarning({ warnings, estimatedAmount = 0, currency = "EUR" }: { warnings: GoogleScriptWarning[]; estimatedAmount?: number; currency?: string }) {
  if (!warnings.length && !estimatedAmount) return null;
  return (
    <div role="status" className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
      <p className="flex items-center gap-2 font-medium"><AlertCircle className="h-4 w-4" />{estimatedAmount > 0 ? "Gastos Google incluídos · crédito por confirmar" : "Google Ads por atualizar"}</p>
      {estimatedAmount > 0 && <p className="text-muted-foreground">Os custos e o lucro estimado já incluem {formatCurrency(estimatedAmount, currency)} de anúncios Google sem descontar créditos ainda por confirmar. Quando a despesa após crédito chegar, o valor confirmado substitui esta estimativa.</p>}
      {warnings.map((warning) => (
        <p key={warning.storeId} className="text-muted-foreground">
          {warning.storeName}: {warning.reason === "stale"
            ? `os últimos dados recebidos são de ${warning.lastReport}. Executa o script RevFlow no Google Ads e verifica o registo de execução.`
            : "falta confirmar a despesa após créditos. O gasto dos anúncios já está disponível."}
        </p>
      ))}
      {!estimatedAmount && <p className="text-muted-foreground">Os custos e o lucro deste período podem estar incompletos. A falta de dados não confirma um gasto de zero.</p>}
      <Link href="/connections" className="inline-block underline underline-offset-4">Ver ligação e script</Link>
    </div>
  );
}
