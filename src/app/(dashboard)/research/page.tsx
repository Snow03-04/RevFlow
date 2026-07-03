import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Telescope } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  listProducts,
  researchStats,
  listTags,
} from "@/lib/research/queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AddProductModal } from "@/components/research/add-product-modal";
import { ResearchStatsBar } from "@/components/research/research-stats";
import { ResearchFilters } from "@/components/research/research-filters";
import { ProductCard } from "@/components/research/product-card";

export const metadata: Metadata = { title: "Product Research" };
export const dynamic = "force-dynamic";

export default async function ResearchPage({
  searchParams,
}: {
  searchParams: Promise<{
    q?: string;
    status?: string;
    favorite?: string;
    tag?: string;
  }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const filters = {
    q: sp.q ?? "",
    status: sp.status ?? "",
    favorite: sp.favorite === "1",
    tag: sp.tag ?? "",
  };

  const [stats, tags, products] = await Promise.all([
    researchStats(supabase, user.id),
    listTags(supabase, user.id),
    listProducts(supabase, user.id, {
      status: filters.status || undefined,
      favorite: filters.favorite || undefined,
      tag: filters.tag || undefined,
      q: filters.q || undefined,
    }),
  ]);

  const filtering =
    !!filters.q || !!filters.status || filters.favorite || !!filters.tag;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Product Research"
        description="Guarda produtos e agrupa os anúncios que encontras na Meta Ad Library."
        actions={<AddProductModal />}
      />

      <ResearchStatsBar stats={stats} />

      <ResearchFilters tags={tags} current={filters} />

      {products.length === 0 ? (
        filtering ? (
          <div className="rounded-xl border border-border/60 bg-card p-10 text-center text-sm text-muted-foreground">
            Nenhum produto corresponde aos filtros.
          </div>
        ) : (
          <EmptyState
            icon={Telescope}
            title="Ainda não guardaste produtos"
            description="Adiciona o teu primeiro produto e começa a organizar a pesquisa de anúncios."
          />
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {products.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
      )}
    </div>
  );
}
