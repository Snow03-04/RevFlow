import { Store } from "lucide-react";
import { StoreSwitcher } from "@/components/dashboard/store-switcher";

/**
 * Unmissable "which store am I editing costs for" banner for the Custos page.
 * The header's global StoreSwitcher already filters this page, but a merchant
 * with several stores (different currencies, different costs) kept editing
 * costs without noticing which store was selected — this repeats the same
 * control right above the table, plus a plain-language state of what's
 * currently shown, so there's no ambiguity.
 */
export function CogsStoreBanner({
  stores,
  currentLabel,
}: {
  stores: { id: string; label: string }[];
  currentLabel: string | null; // null = "all stores" view
}) {
  if (stores.length <= 1) return null; // nothing to disambiguate

  return (
    <div className="flex flex-col gap-3 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
      <div className="flex items-center gap-2 text-sm">
        <Store className="h-4 w-4 shrink-0 text-primary" />
        {currentLabel ? (
          <span>
            A editar custos de{" "}
            <span className="font-semibold text-foreground">{currentLabel}</span>
            . Os custos de cada loja são independentes.
          </span>
        ) : (
          <span>
            <span className="font-semibold text-foreground">
              A ver TODAS as lojas
            </span>{" "}
            — cada produto usa o custo da sua própria loja, mas se duas lojas
            tiverem produtos com o mesmo nome pode ser mais fácil confundir.
            Seleciona uma loja para editar com confiança.
          </span>
        )}
      </div>
      <StoreSwitcher stores={stores} />
    </div>
  );
}
