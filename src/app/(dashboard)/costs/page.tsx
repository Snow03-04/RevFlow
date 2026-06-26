import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings, getProductsForCogs, resolveFxRate } from "@/lib/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { CogsTable } from "@/components/cogs/cogs-table";
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

  const products = await getProductsForCogs(supabase, user.id, storeToDisplay);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Custos (COGS)"
        description="Define o custo de cada produto na tua moeda. Afeta o lucro em todo o lado."
        actions={<SyncProductsButton />}
      />
      <CogsTable products={products} currency={currency} />
    </div>
  );
}
