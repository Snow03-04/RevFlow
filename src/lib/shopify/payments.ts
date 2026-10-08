import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { serverEnv } from "@/lib/env";
import { resolveShopifyToken } from "./auth";
import { shopifyGet } from "./client";
import { normalizePayments, readPaymentSnapshot, type PaymentOrderCheck, type PaymentSnapshot } from "./payments-model";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { resolveFx } from "@/lib/fx";
import { paymentRecalculation } from "./payment-changes";

type DB = SupabaseClient<Database>;
// Validated against Admin 2026-07; kept alongside payments-query.graphql for validation.
export const PAYMENT_COVERAGE_QUERY = `query RevFlowPaymentCoverage($ids: [ID!]!) {
  nodes(ids: $ids) { ... on Order { id updatedAt transactions {
    id kind status gateway test amountSet { shopMoney { amount currencyCode } }
  } } }
}`;

export async function fetchPaymentOrderChecks(shop: string, token: string, ids: string[]): Promise<Record<string, PaymentOrderCheck>> {
  const checks: Record<string, PaymentOrderCheck> = {};
  for (let offset = 0; offset < ids.length; offset += 25) {
    let body: any;
    for (let attempt = 0; attempt < 5; attempt++) {
      const response = await fetch(`https://${shop}/admin/api/${serverEnv.shopify.apiVersion}/graphql.json`, {
        method: "POST", headers: { "X-Shopify-Access-Token": token, "Content-Type": "application/json" },
        body: JSON.stringify({ query: PAYMENT_COVERAGE_QUERY, variables: { ids: ids.slice(offset, offset + 25).map((id) => `gid://shopify/Order/${id}`) } }),
        cache: "no-store", signal: AbortSignal.timeout(30_000),
      });
      if (response.status === 429) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      if (!response.ok) throw new Error(`Não foi possível verificar os pagamentos das encomendas (${response.status}).`);
      body = await response.json();
      if (body.errors?.some((e: any) => e.extensions?.code === "THROTTLED")) { await new Promise((r) => setTimeout(r, 2000)); continue; }
      if (body.errors?.length) throw new Error("A Shopify não permitiu verificar os pagamentos das encomendas.");
      break;
    }
    if (!body?.data?.nodes) throw new Error("Verificação de pagamentos incompleta; tenta sincronizar novamente.");
    for (const order of body.data.nodes) {
      if (!order) continue; // inaccessible orders remain estimates
      const tx = order.transactions.filter((t: any) => !t.test && t.status === "SUCCESS" && ["SALE", "CAPTURE", "REFUND"].includes(t.kind));
      const cur = new Set<string>(tx.map((t: any) => t.amountSet.shopMoney.currencyCode));
      checks[String(order.id).split("/").pop()!] = {
        updatedAt: order.updatedAt, transactionIds: tx.map((t: any) => String(t.id).split("/").pop()),
        captured: tx.filter((t: any) => t.kind !== "REFUND").reduce((n: number, t: any) => n + Number(t.amountSet.shopMoney.amount), 0),
        refunded: tx.filter((t: any) => t.kind === "REFUND").reduce((n: number, t: any) => n + Number(t.amountSet.shopMoney.amount), 0),
        currency: [...cur][0] ?? "", mixed: cur.size !== 1 || tx.some((t: any) => t.gateway !== "shopify_payments"),
      };
    }
  }
  return checks;
}

export async function fetchPaymentSnapshot(shop: string, token: string): Promise<PaymentSnapshot> {
  async function all(resource: string, key: string) {
    const rows: Record<string, unknown>[] = [];
    let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const { data, nextPageInfo }: { data: Record<string, Record<string, unknown>[]>; nextPageInfo: string | null } = await shopifyGet<Record<string, Record<string, unknown>[]>>(shop, token, resource,
        cursor ? { limit: 250, page_info: cursor } : { limit: 250 });
      if (!Array.isArray(data[key])) throw new Error("Extrato de pagamentos incompleto.");
      rows.push(...data[key]);
      cursor = nextPageInfo;
      if (cursor && seen.has(cursor)) throw new Error("Paginação de pagamentos incompleta.");
      if (cursor) seen.add(cursor);
    } while (cursor);
    return rows;
  }
  const [transactions, payouts, balance] = await Promise.all([
    all("shopify_payments/balance/transactions", "transactions"), all("shopify_payments/payouts", "payouts"),
    shopifyGet<{ balance: Record<string, unknown>[] }>(shop, token, "shopify_payments/balance"),
  ]);
  return normalizePayments(transactions, payouts, balance.data.balance);
}

export async function loadPaymentSnapshots(db: DB, userId: string): Promise<Map<string, PaymentSnapshot>> {
  const { data, error } = await db.from("shopify_payment_accounts").select("shopify_connection_id,snapshot").eq("user_id", userId);
  if (error) {
    // Existing installations continue showing estimates until migration 0037 is installed.
    if (error.code === "PGRST205" || error.code === "42P01") return new Map();
    throw error;
  }
  return new Map((data ?? []).flatMap((r) => {
    const snapshot = readPaymentSnapshot(r.snapshot);
    return snapshot ? [[r.shopify_connection_id, snapshot] as const] : [];
  }));
}

/** Settlement → reporting currency uses market FX, then the existing reporting → store-base rate.
 * Never apply a HUF bookkeeping override to an actual USD/EUR settlement pair. */
export async function paymentRates(snapshot: PaymentSnapshot | undefined, displayCurrency: string, storeToDisplay: number) {
  const rates = new Map<string, number>();
  for (const currency of new Set(snapshot?.transactions.map((t) => t.currency) ?? [])) {
    rates.set(currency, await resolveFx(currency, displayCurrency, { required: true }) / storeToDisplay);
  }
  return (currency: string) => {
    const rate = rates.get(currency);
    if (rate == null) throw new Error(`Falta a conversão de pagamentos em ${currency}.`);
    return rate;
  };
}

/** Atomic full ledger refresh. Keep last successful data on permission/network failure.
 * Dedicated payment credentials are optional and never replace the catalogue/webhook app. */
export async function syncShopifyPayments(db: DB, conn: Tables<"shopify_connections">): Promise<{ changed: boolean; available: boolean; months?: string[] }> {
  const { data: account, error } = await db.from("shopify_payment_accounts").select("*").eq("user_id", conn.user_id).eq("shopify_connection_id", conn.id).maybeSingle();
  if (error) {
    if (["PGRST205", "42P01"].includes(error.code)) return { changed: false, available: false };
    throw error;
  }
  const previous = readPaymentSnapshot(account?.snapshot);
  try {
    const token = await resolveShopifyToken(account?.encrypted_secret && account.client_id ? {
      shop_domain: conn.shop_domain, auth_type: "client_credentials", client_id: account.client_id, access_token: account.encrypted_secret,
    } : conn);
    const snapshot = await fetchPaymentSnapshot(conn.shop_domain, token);
    const orders = await selectAllByUser<{ shopify_order_id: string; processed_at: string; source_updated_at: string | null }>(db, "orders",
      "shopify_order_id,processed_at,source_updated_at:raw->>updated_at", conn.user_id, (q) => q.eq("shopify_connection_id", conn.id));
    const ids = new Set(snapshot.transactions.filter((t) => !t.test && t.orderId).map((t) => t.orderId!));
    const changedOrders = orders.filter((o) => ids.has(String(o.shopify_order_id)) && (!previous?.orders?.[o.shopify_order_id] ||
      !o.source_updated_at || Date.parse(o.source_updated_at) !== Date.parse(previous.orders[o.shopify_order_id].updatedAt)));
    snapshot.orders = { ...previous?.orders, ...await fetchPaymentOrderChecks(conn.shop_domain, token, changedOrders.map((o) => String(o.shopify_order_id))) };
    const { data: settings, error: settingsError } = await db.from("settings").select("timezone").eq("user_id", conn.user_id).maybeSingle();
    if (settingsError) throw settingsError;
    const { changed, months } = paymentRecalculation(previous, snapshot, orders, settings?.timezone ?? "UTC", Boolean(account?.refresh_pending));
    if (months) snapshot.refreshMonths = months;
    const { error: saveError } = await db.from("shopify_payment_accounts").upsert({ user_id: conn.user_id, shopify_connection_id: conn.id,
      snapshot, synced_at: new Date().toISOString(), last_error: null, refresh_pending: changed }, { onConflict: "shopify_connection_id" });
    if (saveError) throw saveError;
    return { changed, available: true, ...(months ? { months } : {}) };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Falha ao sincronizar pagamentos.";
    const safe = /403|access.scope|merchant approval/i.test(message)
      ? "A ligação precisa de permissão para consultar os pagamentos Shopify." : "Não foi possível atualizar os pagamentos. Os últimos dados foram mantidos.";
    const { error: writeError } = await db.from("shopify_payment_accounts").upsert({ user_id: conn.user_id, shopify_connection_id: conn.id, last_error: safe }, { onConflict: "shopify_connection_id" });
    if (writeError) throw writeError;
    return { changed: Boolean(account?.refresh_pending), available: Boolean(previous),
      ...(account?.refresh_pending && previous?.refreshMonths ? { months: previous.refreshMonths } : {}) };
  }
}
