import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Store } from "lucide-react";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import {
  listStores,
  storeStats,
  listStoreTags,
} from "@/lib/research/store-queries";
import { PageHeader } from "@/components/dashboard/page-header";
import { EmptyState } from "@/components/dashboard/empty-state";
import { AddStoreModal } from "@/components/research/add-store-modal";
import { StoreStatsBar } from "@/components/research/store-stats";
import { StoreFilters } from "@/components/research/store-filters";
import { StoreCard } from "@/components/research/store-card";

export const metadata: Metadata = { title: "Store Research" };
export const dynamic = "force-dynamic";

export default async function StoresPage({
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

  const [stats, tags, stores] = await Promise.all([
    storeStats(supabase, user.id),
    listStoreTags(supabase, user.id),
    listStores(supabase, user.id, {
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
        title="Store Research"
        description="Guarda lojas que encontras — concorrentes, inspiração e top stores."
        actions={<AddStoreModal />}
      />

      <StoreStatsBar stats={stats} />

      <StoreFilters tags={tags} current={filters} />

      {stores.length === 0 ? (
        filtering ? (
          <div className="rounded-xl border border-border/60 bg-card p-10 text-center text-sm text-muted-foreground">
            Nenhuma loja corresponde aos filtros.
          </div>
        ) : (
          <EmptyState
            icon={Store}
            title="Ainda não guardaste lojas"
            description="Adiciona a tua primeira loja e começa a organizar a pesquisa de concorrentes."
          />
        )
      ) : (
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
          {stores.map((s) => (
            <StoreCard key={s.id} store={s} />
          ))}
        </div>
      )}
    </div>
  );
}
