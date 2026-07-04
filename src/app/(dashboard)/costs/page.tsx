import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  getSettings,
  getProductsForCogs,
  getCogsCollections,
  resolveFxRate,
} from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { CogsTable } from "@/components/cogs/cogs-table";
import { CollectionsManager } from "@/components/cogs/collections-manager";
import { SyncProductsButton } from "@/components/cogs/sync-products-button";

export const metadata: Metadata = { title: "Custos (COGS)" };
export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();

  const settings = await getSettings(supabase, user.id);
  const currency = settings?.currency ?? "USD";
  const storeToDisplay = await resolveFxRate(supabase, user.id, currency);

  const [products, collections] = await Promise.all([
    getProductsForCogs(supabase, user.id, storeToDisplay),
    getCogsCollections(supabase, user.id, storeToDisplay),
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
