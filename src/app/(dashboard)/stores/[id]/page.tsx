import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getStore } from "@/lib/research/store-queries";
import { StoreDetailHeader } from "@/components/research/store-detail-header";
import { StoreImage } from "@/components/research/store-image";
import { StoreNotesEditor } from "@/components/research/store-notes-editor";

export const metadata: Metadata = { title: "Loja · Research" };
export const dynamic = "force-dynamic";

export default async function StoreDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { id } = await params;

  const store = await getStore(supabase, user.id, id);
  if (!store) notFound();

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <StoreDetailHeader store={store} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
        <StoreImage
          storeId={store.id}
          imageUrl={store.image_url}
          hasUrl={!!store.url}
        />
        <StoreNotesEditor storeId={store.id} initial={store.notes} />
      </div>
    </div>
  );
}
