import type { DateRange } from "@/types";
import type { PnlFees } from "./pnl";
import type { TrackerOrderSales } from "./sales";
import { collectionOrderShare } from "./collection-sales";

export type GeneralCampaign = {
  key: string; platform: "meta" | "google"; name: string; storeId: string | null;
  collectionHandle: string | null; productId: string | null; active: boolean;
};
export type GeneralCollectionDefinition = {
  key: string; handle: string; name: string; storeId: string; storeName: string;
  productIds: string[] | null; rate: number; campaigns: GeneralCampaign[];
};
export type GeneralFact = { key: string; platform: "meta" | "google"; date: string; spend: number | null };
export type GeneralDay = {
  date: string; orders: number; units: number; grossRevenue: number; refunds: number;
  cogs: number; feeOrders: number; metaSpend: number | null; googleSpend: number | null;
};
export type GeneralCollection = GeneralCollectionDefinition & { days: GeneralDay[] };
export const generalCollectionKey = (storeId: string, handle: string) => `${storeId}:${handle}`;
export const generalCampaignLinkId = (platform: "meta" | "google", key: string) => `general:${platform}:${key}`;

/** Membership, not click attribution, determines sales. Each order counts once per collection. */
export function buildGeneralCollections(definitions: GeneralCollectionDefinition[], facts: GeneralFact[], orders: TrackerOrderSales[], range: DateRange): GeneralCollection[] {
  return definitions.map((collection) => {
    const days = new Map<string, GeneralDay>();
    const platforms = new Set(collection.campaigns.map((c) => c.platform));
    const campaignKeys = new Set(collection.campaigns.map((c) => `${c.platform}:${c.key}`));
    const imported = new Set<string>();
    const getDay = (date: string) => {
      if (!days.has(date)) days.set(date, { date, orders: 0, units: 0, grossRevenue: 0, refunds: 0, cogs: 0, feeOrders: 0,
        metaSpend: 0, googleSpend: 0 });
      return days.get(date)!;
    };
    for (const fact of facts) {
      if (!campaignKeys.has(`${fact.platform}:${fact.key}`) || fact.date < range.from || fact.date > range.to) continue;
      const day = getDay(fact.date);
      const field = fact.platform === "meta" ? "metaSpend" : "googleSpend";
      day[field] = day[field] == null || fact.spend == null ? null : day[field] + fact.spend * collection.rate;
      imported.add(`${fact.platform}:${fact.date}`);
    }
    const products = new Set(collection.productIds ?? []);
    const seen = new Set<string>();
    for (const order of orders) {
      if (order.storeId !== collection.storeId || order.date < range.from || order.date > range.to || seen.has(order.id)) continue;
      const share = collectionOrderShare(order, products);
      if (!share) continue;
      seen.add(order.id);
      const day = getDay(order.date);
      day.orders++; day.units += share.units;
      day.grossRevenue += share.grossRevenue * collection.rate;
      day.refunds += share.refunds * collection.rate;
      day.cogs += share.cogs * collection.rate;
      day.feeOrders += share.feeOrders;
    }
    for (const day of days.values()) {
      if (platforms.has("meta") && !imported.has(`meta:${day.date}`)) day.metaSpend = null;
      if (platforms.has("google") && !imported.has(`google:${day.date}`)) day.googleSpend = null;
    }
    return { ...collection, days: [...days.values()].sort((a, b) => a.date.localeCompare(b.date)) };
  });
}

export function summariseGeneralSheet(days: GeneralDay[], salesKnown: boolean, fees: (date: string) => PnlFees) {
  let orders = 0, units = 0, gross = 0, refunds = 0, cogs = 0, payments = 0, agency = 0;
  let metaSpend: number | null = 0, googleSpend: number | null = 0;
  for (const day of days) {
    const fee = fees(day.date);
    orders += day.orders; units += day.units; gross += day.grossRevenue; refunds += day.refunds; cogs += day.cogs;
    payments += day.grossRevenue * fee.paymentPct + day.feeOrders * fee.txFee;
    agency += (day.metaSpend ?? 0) * fee.feeFb + (day.googleSpend ?? 0) * fee.feeGoogle;
    metaSpend = metaSpend == null || day.metaSpend == null ? null : metaSpend + day.metaSpend;
    googleSpend = googleSpend == null || day.googleSpend == null ? null : googleSpend + day.googleSpend;
  }
  const revenue = gross - refunds;
  const spend = metaSpend == null || googleSpend == null ? null : metaSpend + googleSpend;
  const profit = salesKnown && spend != null ? revenue - cogs - payments - agency - spend : null;
  const contribution = revenue - cogs - payments;
  return {
    orders: salesKnown ? orders : null, units: salesKnown ? units : null,
    revenue: salesKnown ? revenue : null, gross: salesKnown ? gross : null, refunds: salesKnown ? refunds : null,
    cogs: salesKnown ? cogs : null, payments: salesKnown ? payments : null, agency: spend == null ? null : agency,
    metaSpend, googleSpend, spend, profit,
    margin: profit != null && revenue !== 0 ? profit / revenue : null,
    roas: salesKnown && spend != null && spend > 0 ? revenue / spend : null,
    breakEven: salesKnown && contribution > 0 && spend != null ? revenue * (spend > 0 ? 1 + agency / spend : 1) / contribution : null,
    salesKnown, spendKnown: spend != null,
  };
}
