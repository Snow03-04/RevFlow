import type { Metadata } from "next";
import { redirect } from "next/navigation";
import Link from "next/link";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { PageHeader } from "@/components/dashboard/page-header";
import { Card } from "@/components/ui/card";
import { readPaymentSnapshot, reconcilePayments } from "@/lib/shopify/payments-model";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { SyncButton } from "@/components/dashboard/sync-button";

export const metadata: Metadata = { title: "Recebimentos Shopify" };
export const dynamic = "force-dynamic";
const money = (n: number, currency: string) => new Intl.NumberFormat("pt-PT", { style: "currency", currency }).format(n);
const statuses: Record<string, string> = { paid: "Pago pela Shopify", in_transit: "Em trânsito", scheduled: "Agendado", failed: "Falhou", canceled: "Cancelado" };

export default async function PaymentsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await createClient();
  const [stores, accounts, metrics] = await Promise.all([
    db.from("shopify_connections").select("id,shop_domain,shop_name").eq("user_id", user.id),
    db.from("shopify_payment_accounts").select("shopify_connection_id,snapshot,synced_at,last_error,refresh_pending").eq("user_id", user.id),
    selectAllByUser<{ shopify_connection_id: string; payment_orders_actual: number; payment_orders_estimated: number }>(db, "daily_metrics",
      "shopify_connection_id,payment_orders_actual,payment_orders_estimated", user.id),
  ]);
  if (stores.error) throw stores.error;
  if (accounts.error) throw accounts.error;
  return <div className="space-y-6">
    <PageHeader title="Recebimentos Shopify" description="Valores líquidos, taxas e transferências, na moeda da conta que recebe o dinheiro." />
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-sm">
      <p className="max-w-3xl text-muted-foreground">Atualiza automaticamente com as lojas. USD permanece USD. “Pago” é o estado informado pela Shopify; a confirmação no extrato bancário é separada. <Link href="/pnl" className="text-primary underline">Ver lucro</Link></p>
      <SyncButton />
    </div>
    {(stores.data ?? []).map((store) => {
      const account = accounts.data?.find((a) => a.shopify_connection_id === store.id);
      const snapshot = readPaymentSnapshot(account?.snapshot);
      const report = snapshot ? reconcilePayments(snapshot) : null;
      const coverage = metrics.filter((m) => m.shopify_connection_id === store.id).reduce((n, m) => ({
        actual: n.actual + Number(m.payment_orders_actual), estimated: n.estimated + Number(m.payment_orders_estimated),
      }), { actual: 0, estimated: 0 });
      const stale = account?.synced_at && Date.now() - Date.parse(account.synced_at) > 60 * 60 * 1000;
      return <Card key={store.id} className="space-y-5 p-5">
        <div><h2 className="text-lg font-semibold">{store.shop_name || store.shop_domain}</h2>
          <p className="text-xs text-muted-foreground">{account?.synced_at ? `Última atualização: ${new Date(account.synced_at).toLocaleString("pt-PT", { timeZone: "Europe/Lisbon" })}` : "A aguardar a primeira sincronização dos pagamentos."}</p></div>
        {(account?.last_error || stale || account?.refresh_pending) && <p className="rounded-lg bg-amber-500/10 p-3 text-sm text-amber-700 dark:text-amber-300">{account?.last_error || (account?.refresh_pending ? "Movimentos importados; o lucro ainda está a ser atualizado." : "Os dados têm mais de uma hora. Sincroniza para confirmar o estado atual.")}</p>}
        {report && <>
          {report.totals.map((t) => <div key={t.currency} className="space-y-3">
            <h3 className="text-sm font-semibold">Conta em {t.currency}</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {[[t.toArrive < 0 ? "A debitar na conta" : "Por chegar à conta", t.toArrive], ["Pago pela Shopify", t.paid], ["Em trânsito", t.inTransit], ["Saldo na Shopify", t.balance]].map(([label, value]) => <div className="rounded-lg border p-4" key={String(label)}>
                <p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-xl font-semibold tabular-nums">{money(Number(value), t.currency)}</p>
              </div>)}
            </div>
            <p className="text-sm text-muted-foreground">Histórico: cobranças {money(t.gross, t.currency)} · reembolsos {money(t.refunds, t.currency)} · disputas e outros movimentos {money(t.other, t.currency)} · taxas {money(t.fees, t.currency)} · líquido {money(t.net, t.currency)}.</p>
            {(t.failed !== 0 || t.cancelled !== 0 || t.scheduled !== 0) && <p className="text-sm">Agendado: {money(t.scheduled, t.currency)} · Falhou: {money(t.failed, t.currency)} · Cancelado: {money(t.cancelled, t.currency)}.</p>}
            {Math.abs(t.balanceDifference) > 0.01 && <p className="text-sm text-amber-600">Diferença entre saldo atual e movimentos pendentes: {money(t.balanceDifference, t.currency)}. Pode haver movimentos a atualizar.</p>}
          </div>)}
          <p className="text-sm text-muted-foreground">Lucro: {coverage.actual} encomendas com pagamentos verificados; {coverage.estimated} com taxas estimadas ou pagamentos por verificar. {report.unreconciled ? `${report.unreconciled} transferências com diferenças por reconciliar.` : "Todas as transferências correspondem aos movimentos importados."}</p>
          <details className="rounded-lg border p-3"><summary className="cursor-pointer text-sm font-medium">Transferências ({report.payouts.length})</summary>
            <div className="mt-3 max-h-96 overflow-auto"><table className="w-full text-sm"><thead><tr className="border-b text-left"><th className="p-2">Data</th><th className="p-2">Estado</th><th className="p-2 text-right">Valor líquido</th><th className="p-2 text-right">Conferência</th></tr></thead>
              <tbody>{[...report.payouts].sort((a,b) => b.date.localeCompare(a.date)).map((p) => <tr key={p.id} className="border-b"><td className="p-2">{p.date}</td><td className="p-2">{statuses[p.status] ?? p.status}{p.amount < 0 ? " · Débito na conta" : ""}</td><td className="p-2 text-right tabular-nums">{money(p.amount,p.currency)}</td><td className="p-2 text-right">{p.matched ? "Confere" : `Diferença ${money(p.difference,p.currency)}`}</td></tr>)}</tbody></table></div>
          </details>
        </>}
      </Card>;
    })}
    <p className="text-xs text-muted-foreground">As taxas do extrato Shopify Payments já incluem o que a Shopify descontou nesses movimentos. Não são descontadas novamente percentagens de câmbio. Mensalidades, aplicações, pagamentos externos e comissões do banco precisam dos respetivos extratos ou despesas registadas. O equivalente noutra moeda nos relatórios é uma valorização; não altera estes recebimentos.</p>
  </div>;
}
