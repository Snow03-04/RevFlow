import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { DateRange } from "@/types";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { getStoreFxRates } from "@/lib/queries";
import { storeLabel } from "@/lib/utils";
import { resolveShopifyToken } from "@/lib/shopify/auth";
import { fetchCollectionProductIds } from "@/lib/shopify/collection-products";
import { fetchProductCollections } from "@/lib/shopify/product-collections";
import { parseScriptCampaignId } from "@/lib/google/script-campaigns";
import { getCurrentMetaCampaigns } from "@/lib/meta/campaign-catalog";
import { getGooglePnlCatalog } from "./google-pnl-query";
import { getMetaPnlCatalog } from "./meta-pnl-query";
import { metaCampaignKey } from "./meta-pnl";
import { buildResolver, type CampaignLinkTarget } from "./match";
import { fetchTrackerOrderSales } from "./sales";
import { buildGeneralCollections, generalCollectionKey, generalCampaignLinkId, type GeneralCampaign, type GeneralCollectionDefinition, type GeneralFact } from "./general-sheet";

// Only collection metadata is cached, scoped to user and store. Failures are never cached.
const membersCache = new Map<string, { expires: number; ids: string[] }>();
const productCollectionsCache = new Map<string, { expires: number; collections: { handle: string; title: string }[] }>();

export async function getGeneralSheetData(db: SupabaseClient<Database>, userId: string, year: number, range: DateRange, currency: string, storeId?: string) {
  const { data: settings, error } = await db.from("settings").select("timezone,currency,fx_rate_override").eq("user_id", userId).maybeSingle();
  if (error) throw error;
  const iso = ({ "€": "EUR", "$": "USD", "£": "GBP" } as Record<string, string>)[currency] ?? currency;
  const [meta, google, links, stores, products, rates, orders, currentMeta] = await Promise.all([
    getMetaPnlCatalog(db, userId, year), getGooglePnlCatalog(db, userId, year),
    selectAllByUser<Tables<"campaign_links">>(db, "campaign_links", "campaign_id,collection_handle,product_handle,link_kind", userId),
    selectAllByUser<Tables<"shopify_connections">>(db, "shopify_connections", "*", userId),
    selectAllByUser<Pick<Tables<"products">, "handle" | "shopify_product_id" | "shopify_connection_id" | "title" | "price" | "cost">>(db, "products", "handle,shopify_product_id,shopify_connection_id,title,price,cost", userId),
    getStoreFxRates(db, userId, iso, settings?.fx_rate_override, true, settings?.currency ?? iso),
    fetchTrackerOrderSales(db, userId, range, settings?.timezone ?? "UTC", "all"),
    getCurrentMetaCampaigns(db, userId, storeId),
  ]);
  const byStore = new Map(stores.map((store) => [store.id, store]));
  const byLink = new Map(links.map((link) => [link.campaign_id, link]));
  const targets = new Map<string, CampaignLinkTarget>(links.map((link) => [link.campaign_id, {
    product: link.product_handle, collection: link.collection_handle,
    kind: link.collection_handle && (!link.product_handle || link.link_kind === "collection") ? "collection" : "product",
  }]));
  const matchProducts = [...new Map(products.map((p) => [`${p.shopify_connection_id}:${p.shopify_product_id}`, {
    productId: p.shopify_product_id, storeId: p.shopify_connection_id, handle: p.handle, title: p.title,
    price: Number(p.price), cost: p.cost == null ? null : Number(p.cost),
  }])).values()];
  const resolvers = new Map(stores.map((store) => [store.id, buildResolver(matchProducts, targets, store.id)]));
  const campaigns: GeneralCampaign[] = [
    ...[...new Map([...meta.options, ...currentMeta.options].map((c) => [c.key, c])).values()].map((c): GeneralCampaign => {
      const link = byLink.get(generalCampaignLinkId("meta", c.key)) ?? byLink.get(c.campaignId);
      const target = c.storeId ? resolvers.get(c.storeId)?.(c.campaignId, c.name) : null;
      return { key: c.key, platform: "meta", name: c.name, storeId: c.storeId,
        collectionHandle: link?.collection_handle ?? target?.collectionHandle ?? null,
        productId: target?.productId ?? null, active: c.status === "ACTIVE" };
    }),
    ...google.options.map((c): GeneralCampaign => ({ key: c.key, platform: "google", name: c.name, storeId: c.storeId,
      collectionHandle: byLink.get(generalCampaignLinkId("google", c.key))?.collection_handle ?? c.collectionHandle,
      productId: products.find((p) => p.shopify_connection_id === c.storeId && p.handle === c.productHandle)?.shopify_product_id ?? null,
      active: c.status === "ENABLED" })),
  ].filter((c) => !storeId || storeId === "all" || c.storeId === storeId);
  const tokens = new Map<string, Promise<string>>();
  async function access(id: string) {
    const store = byStore.get(id);
    if (!store) return null;
    if (!tokens.has(id)) tokens.set(id, resolveShopifyToken(store));
    return { shop: store.shop_domain, token: await tokens.get(id)! };
  }
  const definitions = new Map<string, GeneralCollectionDefinition>();
  function addCollection(id: string, handle: string, name?: string) {
    const store = byStore.get(id);
    if (!store) return;
    const key = generalCollectionKey(id, handle);
    if (!definitions.has(key)) definitions.set(key, { key, handle, name: name || handle.replace(/-/g, " ").replace(/^./u, (c) => c.toUpperCase()),
      storeId: id, storeName: storeLabel(store.shop_name, store.shop_domain), productIds: null, rate: rates.get(id) ?? 1, campaigns: [] });
  }
  for (const c of campaigns) if (c.active && c.storeId && c.collectionHandle) addCollection(c.storeId, c.collectionHandle);
  const productLookups = new Map<string, Promise<{ handle: string; title: string }[] | null>>();
  for (const c of campaigns) {
    if (!c.active || !c.storeId || c.collectionHandle || !c.productId) continue;
    const key = `${userId}:${c.storeId}:${c.productId}`;
    if (!productLookups.has(key)) productLookups.set(key, (async () => {
      const cached = productCollectionsCache.get(key);
      if (cached && cached.expires > Date.now()) return cached.collections;
      try {
        const auth = await access(c.storeId!);
        const result = auth ? await fetchProductCollections(auth.shop, auth.token, c.productId!) : null;
        if (result != null) {
          if (productCollectionsCache.size >= 500) productCollectionsCache.clear();
          productCollectionsCache.set(key, { expires: Date.now() + 300_000, collections: result });
        }
        return result;
      } catch { return null; }
    })());
  }
  await Promise.all(campaigns.map(async (c) => {
    if (!c.active || !c.storeId || c.collectionHandle || !c.productId) return;
    const collections = await productLookups.get(`${userId}:${c.storeId}:${c.productId}`);
    if (collections?.length === 1) {
      c.collectionHandle = collections[0].handle;
      addCollection(c.storeId, collections[0].handle, collections[0].title);
    }
  }));
  await Promise.all([...definitions.values()].map(async (collection) => {
    const key = `${userId}:${collection.key}`;
    const cached = membersCache.get(key);
    if (cached && cached.expires > Date.now()) { collection.productIds = cached.ids; return; }
    try {
      const auth = await access(collection.storeId);
      collection.productIds = auth ? await fetchCollectionProductIds(auth.shop, auth.token, collection.handle) : null;
      if (collection.productIds != null) {
        if (membersCache.size >= 500) membersCache.clear();
        membersCache.set(key, { expires: Date.now() + 300_000, ids: collection.productIds });
      }
    } catch { collection.productIds = null; }
  }));
  // Product ads can join one known advertised collection; never allocate their cost to several.
  for (const c of campaigns) {
    if (!c.storeId) continue;
    if (!c.collectionHandle && c.productId) {
      const candidates = [...definitions.values()].filter((d) => d.storeId === c.storeId && d.productIds?.includes(c.productId!));
      if (candidates.length === 1) c.collectionHandle = candidates[0].handle;
    }
    if (c.collectionHandle) definitions.get(generalCollectionKey(c.storeId, c.collectionHandle))?.campaigns.push(c);
  }
  const facts: GeneralFact[] = [
    ...meta.rows.map((r): GeneralFact => ({ key: metaCampaignKey(r.meta_connection_id, r.campaign_id), platform: "meta", date: r.date, spend: Number(r.spend) })),
    ...google.rows.map((r): GeneralFact => ({ key: r.key, platform: "google", date: r.date,
      spend: r.gross_spend != null ? Number(r.gross_spend) : parseScriptCampaignId(r.campaign_id) ? null : Number(r.spend) })),
  ];
  const collections = buildGeneralCollections([...definitions.values()], facts, orders, range)
    .sort((a, b) => a.storeName.localeCompare(b.storeName) || a.name.localeCompare(b.name));
  const unresolved = campaigns.filter((c) => c.active && (!c.storeId || !c.collectionHandle || !definitions.has(generalCollectionKey(c.storeId, c.collectionHandle))))
    .map((c) => ({ ...c, storeName: c.storeId && byStore.has(c.storeId) ? storeLabel(byStore.get(c.storeId)!.shop_name, byStore.get(c.storeId)!.shop_domain) : "Sem loja associada" }));
  return { collections, unresolved, unavailableMeta: currentMeta.unavailable };
}
