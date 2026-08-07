import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getConnections,
  getProductsForCogs,
  getCogsCollections,
  getStoreFxRates,
} from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { CogsTable } from "@/components/cogs/cogs-table";
import { CollectionsManager } from "@/components/cogs/collections-manager";
import { SyncProductsButton } from "@/components/cogs/sync-products-button";
import { CogsStoreBanner } from "@/components/cogs/cogs-store-banner";
import { storeLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Custos (COGS)" };
export const dynamic = "force-dynamic";

export default async function CostsPage({
  searchParams,
}: {
  searchParams: Promise<{ store?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const [storeRates, { shopify }] = await Promise.all([
    getStoreFxRates(supabase, user.id, currency, settings?.fx_rate_override),
    getConnections(supabase, user.id),
  ]);
  // Respect the header store switcher: a selected store shows only its products.
  const storeId = shopify.some((s) => s.id === sp.store) ? sp.store : undefined;
  // Collections aren't store-scoped; their costs are stored in the display
  // currency, so the rate only matters for legacy base-currency entries.
  const collectionsRate = storeId ? storeRates.get(storeId) ?? 1 : 1;

  // Unfiltered product list too, purely to know which store each collection's
  // members belong to (getProductsForCogs already narrows `products` itself
  // to the selected store, so it can't answer that once a store is picked).
  const [products, allProductStores, collectionsRaw] = await Promise.all([
    getProductsForCogs(supabase, user.id, storeRates, storeId),
    storeId
      ? getProductsForCogs(supabase, user.id, storeRates)
      : Promise.resolve(null),
    getCogsCollections(supabase, user.id, collectionsRate),
  ]);

  // Collections aren't store-scoped in the schema (no shopify_connection_id
  // column), so a collection can in principle span products from several
  // stores. When a store is selected, keep only collections that actually
  // have a member in it — plus any collection with no members yet, so a
  // freshly created empty one doesn't disappear the moment you filter.
  const storeOfProduct = new Map(
    (allProductStores ?? products).map((p) => [p.productId, p.storeId]),
  );
  const collections = storeId
    ? collectionsRaw.filter(
        (c) =>
          c.productIds.length === 0 ||
          c.productIds.some((pid) => storeOfProduct.get(pid) === storeId),
      )
    : collectionsRaw;

  const stores = shopify.map((s) => ({
    id: s.id,
    label: storeLabel(s.shop_name, s.shop_domain),
  }));
  const currentStoreLabel = storeId
    ? (stores.find((s) => s.id === storeId)?.label ?? null)
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custos (COGS)"
        description="Define o custo de cada produto na tua moeda. Afeta o lucro em todo o lado."
        actions={<SyncProductsButton />}
      />
      <CogsStoreBanner stores={stores} currentLabel={currentStoreLabel} />
      <CogsTable
        // CogsTable seeds its editable row state from `products` only on
        // mount (useState initializer) — switching the store changes the
        // `products` prop but NOT this component's identity, so without a
        // key tied to the store, the table kept showing whichever store's
        // rows it happened to mount with. Keying on storeId forces a clean
        // remount (and re-seed) exactly when the selected store changes.
        key={storeId ?? "all"}
        products={products}
        currency={currency}
        collections={collections.map((c) => ({ id: c.id, name: c.name }))}
        stores={stores}
      />
      <CollectionsManager
        collections={collections}
        // Unfiltered so a cross-store collection's members always resolve a
        // name/store, even while a specific store is selected above.
        products={(allProductStores ?? products).map((p) => ({
          productId: p.productId,
          title: p.title,
          storeId: p.storeId,
        }))}
        currency={currency}
        stores={stores}
      />
    </div>
  );
}
