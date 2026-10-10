import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readPaymentSnapshot, reconcilePayments } from "@/lib/shopify/payments-model";
import { round2 } from "@/lib/profit";
import { getSupplierPayables, type PayableStore } from "@/lib/supplier/payables";

export async function PendingPayments({ userId, storeId, stores, currency, storePercentages, fxOverride, fxOverrideCurrency, supplierSheetUrl }: {
  userId: string; storeId?: string; stores: PayableStore[]; currency: string;
  storePercentages: Map<string, number>; fxOverride?: number | null; fxOverrideCurrency?: string | null;
  supplierSheetUrl?: string | null;
}) {
  const db = await createClient();
  let query = db.from("shopify_payment_accounts").select("shopify_connection_id,snapshot,synced_at,last_error").eq("user_id", userId);
  if (storeId) query = query.eq("shopify_connection_id", storeId);
  const [{ data, error }, supplier] = await Promise.all([
    query,
    getSupplierPayables({ stores, storeId, currency, percentages: storePercentages, fxOverride, fxOverrideCurrency, sheetUrl: supplierSheetUrl })
      .catch(() => ({ status: "error" as const })),
  ]);
  const totals = new Map<string, { amount: number; transit: number; pending: number }>();
  let covered = 0, stale = false;
  for (const row of data ?? []) {
    const snapshot = readPaymentSnapshot(row.snapshot);
    if (!snapshot) continue;
    covered++;
    stale ||= Boolean(row.last_error || !row.synced_at || Date.now() - Date.parse(row.synced_at) > 3_600_000);
    for (const t of reconcilePayments(snapshot).totals) {
      const total = totals.get(t.currency) ?? { amount: 0, transit: 0, pending: 0 };
      total.amount += t.toArrive; total.transit += t.inTransit; total.pending += t.pending + t.scheduled;
      totals.set(t.currency, total);
    }
  }
  const partial = covered < (storeId ? 1 : stores.length);
  const personalView = !storeId && stores.some((store) => (storePercentages.get(store.id) ?? 100) !== 100);
  const money = (n: number, currency: string) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(round2(n));
  return <div className="rounded-xl border border-primary/20 bg-primary/5 p-5">
    <div className="flex flex-wrap justify-between gap-2"><div><h2 className="font-semibold">Por chegar à conta</h2>
      <p className="mt-1 text-xs text-muted-foreground">Saldo atual nas lojas selecionadas · independente do período de vendas</p></div>
      <Link href="/payments" className="text-sm text-primary underline">Ver recebimentos</Link></div>
    {error || !covered ? <p className="mt-3 text-sm text-muted-foreground">Recebimentos ainda por sincronizar.</p> : <>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{[...totals].sort(([a], [b]) => a.localeCompare(b)).map(([currency, t]) => <div key={currency}>
        <p className="text-2xl font-semibold tabular-nums">{money(t.amount, currency)} <span className="text-xs font-normal text-muted-foreground">{currency}{t.amount < 0 ? " · a debitar" : ""}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{money(t.transit, currency)} em trânsito · {money(t.pending, currency)} por transferir</p>
      </div>)}</div>
      {(partial || stale) && <p className="mt-3 text-xs text-amber-700 dark:text-amber-300">{partial ? "Algumas lojas ainda não têm pagamentos sincronizados. " : ""}{stale ? "Há dados por atualizar; consulta o estado em Recebimentos." : ""}</p>}
    </>}
    <div className="mt-5 border-t border-primary/20 pt-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-semibold">Dinheiro a dever ao fornecedor <span className="ml-1 text-xs font-normal text-muted-foreground">Estimado</span></h3>
          <p className="mt-1 text-xs text-muted-foreground">{personalView ? "A tua parte · " : ""}Apenas encomendas marcadas como por pagar na sheet</p>
        </div>
        <Link href="/supplier" className="text-sm text-primary underline">Ver fornecedor</Link>
      </div>
      {supplier.status !== "ready" ? <p className="mt-3 text-sm text-muted-foreground">{
        supplier.status === "unassigned" ? "Associa o separador da sheet à loja em Fornecedor para calcular o valor."
          : supplier.status === "not_connected" ? "Sheet do fornecedor ainda não ligada a esta seleção de lojas."
          : "Não foi possível carregar o valor por pagar."
      }</p> : <>
        <p className="mt-4 text-2xl font-semibold tabular-nums">{money(supplier.amount, currency)} <span className="text-xs font-normal text-muted-foreground">{currency}</span></p>
        <p className="mt-1 text-xs text-muted-foreground">{supplier.storeName} · {supplier.ordersCount} {supplier.ordersCount === 1 ? "encomenda por pagar" : "encomendas por pagar"}</p>
        {supplier.unpricedCount > 0 && <p className="mt-1 text-xs text-muted-foreground">{supplier.unpricedCount} encomendas sem preço na sheet não incluídas.</p>}
      </>}
    </div>
  </div>;
}
