import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { resolveFx } from "@/lib/fx";
import { googleSpendStore, type NamedStore } from "./store-labels";
import { googleExpenseAccount } from "./account-expenses";
import { reconciledBilledCost } from "./billing-model";
import type { GooglePromotionReconciliation } from "./promotional-credits";
import { parseScriptCampaignId } from "./script-campaigns";
import { storeLabel } from "@/lib/utils";

type DB = SupabaseClient<Database>;
type Entry = Pick<Tables<"manual_entries">, "date" | "kind" | "amount" | "currency" | "label">;

export async function getGoogleBillingReports(db: DB, userId: string, range: DateRange) {
  try {
    return await selectAllByUser<Tables<"google_billing_reports">>(db, "google_billing_reports", "*", userId,
      q => q.gte("date", range.from).lte("date", range.to));
  } catch (error) {
    // Rolling deployments remain compatible until the migration is installed.
    if (["PGRST205", "42P01"].includes((error as { code?: string }).code ?? "")) return [];
    throw error;
  }
}

/** Virtual credits: never change raw imports, never let an old hourly script
 * overwrite billing evidence, and never deduct an account's credit from another. */
export async function withGoogleBillingCredits(db: DB, userId: string, range: DateRange, entries: Entry[], stores: NamedStore[], defaultCurrency: string, includeOAuth = false): Promise<Entry[]> {
  const reports = await getGoogleBillingReports(db, userId, range);
  if (!reports.length) return entries;
  const [campaigns, storeCurrencies, connections] = await Promise.all([
    selectAllByUser<Tables<"google_campaigns">>(db, "google_campaigns", "campaign_id,google_connection_id,date,spend,gross_spend", userId,
      q => q.gte("date", range.from).lte("date", range.to)),
    selectAllByUser<Pick<Tables<"shopify_connections">, "id" | "reporting_base_currency">>(db, "shopify_connections", "id,reporting_base_currency", userId),
    selectAllByUser<Pick<Tables<"google_connections">, "id" | "customer_id" | "shopify_connection_id">>(db, "google_connections", "id,customer_id,shopify_connection_id", userId),
  ]);
  const result = [...entries];
  const rates = new Map<string, number>();
  const fx = async (from: string, to: string) => {
    const key = `${from}:${to}`;
    if (!rates.has(key)) rates.set(key, await resolveFx(from, to, { required: true }));
    return rates.get(key)!;
  };
  const reconciliations: Record<string, GooglePromotionReconciliation[]> = JSON.parse(process.env.GOOGLE_ADS_BILLING_RECONCILIATIONS || "{}");
  for (const report of reports) {
    const owned = entries.filter(e => e.date === report.date && googleSpendStore(e.label, stores) === report.shopify_connection_id
      && googleExpenseAccount(e.label) === report.customer_id);
    if (!owned.length && !includeOAuth) continue;
    const store = stores.find(s => s.id === report.shopify_connection_id);
    if (!store) continue;
    const connectionIds = new Set(connections.filter(c => c.shopify_connection_id === report.shopify_connection_id && c.customer_id.replace(/\D/g, "") === report.customer_id).map(c => c.id));
    const facts = campaigns.filter(c => {
      if (c.date !== report.date) return false;
      const parsed = parseScriptCampaignId(c.campaign_id);
      return owned.length ? parsed && !parsed.grossOnly && parsed.storeId === report.shopify_connection_id && parsed.customerId === report.customer_id
        : c.google_connection_id && connectionIds.has(c.google_connection_id);
    });
    if (!owned.length && !facts.length) continue; // Never guess a legacy/unmapped account.
    const base = storeCurrencies.find(s => s.id === store.id)?.reporting_base_currency;
    const rate = base ? await fx(base, report.currency) : null;
    let gross = facts.length && rate != null && facts.every(c => c.gross_spend != null || c.google_connection_id)
      ? facts.reduce((sum, c) => sum + Number(c.gross_spend ?? c.spend), 0) * rate : null;
    let net = 0;
    for (const e of owned) net += Number(e.amount) * await fx(e.currency ?? defaultCurrency, report.currency) * (e.kind === "expense" ? 1 : -1);
    if (owned.length) {
      // Script campaign cost and gross use the same historical conversion.
      // Their ratio preserves promotion funding without reverse-converting a
      // historical base currency at today's FX (or a bookkeeping override).
      const paidFacts = facts.reduce((sum, c) => sum + Number(c.spend), 0);
      if (net > 0) gross = paidFacts > 0 && facts.every(c => c.gross_spend != null)
        ? net * facts.reduce((sum, c) => sum + Number(c.gross_spend), 0) / paidFacts : null;
    }
    if (!owned.length) {
      if (rate == null) continue;
      net = facts.reduce((sum, c) => sum + Number(c.spend), 0) * rate;
    }
    const applied = (reconciliations[`${userId}:${report.shopify_connection_id}`] ?? [])
      .filter(r => r.currency === report.currency && r.promotionId.startsWith(`customers/${report.customer_id}/`))
      .reduce((sum, r) => sum + (r.adjustments?.[report.date] ?? 0), 0);
    const discount = net - reconciledBilledCost(net, gross, Number(report.served_cost), Number(report.billed_cost), applied);
    if (Math.abs(discount) > 0.00001) result.push({ date: report.date, kind: discount > 0 ? "profit" : "expense", amount: Math.abs(discount) * await fx(report.currency, defaultCurrency), currency: defaultCurrency,
      label: owned[0]?.label ?? `Google ${storeLabel(store.shop_name, store.shop_domain)} · conta ${report.customer_id} · faturação` });
  }
  return result;
}

export async function googleOverspendTotal(db: DB, userId: string, range: DateRange, currency: string, storeId?: string, percentages = new Map<string, number>()) {
  const reports = await getGoogleBillingReports(db, userId, range);
  const rates = new Map<string, number>();
  let total = 0;
  for (const row of reports) {
    if (storeId && row.shopify_connection_id !== storeId) continue;
    if (!rates.has(row.currency)) rates.set(row.currency, await resolveFx(row.currency, currency, { required: true }));
    const share = storeId ? 1 : (percentages.get(row.shopify_connection_id) ?? 100) / 100;
    total += (Number(row.served_cost) - Number(row.billed_cost)) * rates.get(row.currency)! * share;
  }
  return Math.round(total * 100) / 100;
}
