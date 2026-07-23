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

  const [products, collections] = await Promise.all([
    getProductsForCogs(supabase, user.id, storeRates, storeId),
    getCogsCollections(supabase, user.id, collectionsRate),
  ]);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custos (COGS)"
        description="Define o custo de cada produto na tua moeda. Afeta o lucro em todo o lado."
        actions={<SyncProductsButton />}
      />
      <CogsTable
        products={products}
        currency={currency}
        collections={collections.map((c) => ({ id: c.id, name: c.name }))}
      />
      <CollectionsManager
        collections={collections}
        products={products.map((p) => ({ productId: p.productId, title: p.title }))}
        currency={currency}
      />
    </div>
  );
}
