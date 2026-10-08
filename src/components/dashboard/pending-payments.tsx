import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { readPaymentSnapshot, reconcilePayments } from "@/lib/shopify/payments-model";
import { round2 } from "@/lib/profit";

export async function PendingPayments({ userId, storeId, storeCount }: { userId: string; storeId?: string; storeCount: number }) {
  const db = await createClient();
  let query = db.from("shopify_payment_accounts").select("shopify_connection_id,snapshot,synced_at,last_error").eq("user_id", userId);
  if (storeId) query = query.eq("shopify_connection_id", storeId);
  const { data, error } = await query;
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
  const partial = covered < (storeId ? 1 : storeCount);
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
  </div>;
}
