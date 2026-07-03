import type { Metadata } from "next";
import { redirect, notFound } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getProduct } from "@/lib/research/queries";
import { ProductDetailHeader } from "@/components/research/product-detail-header";
import { ProductImage } from "@/components/research/product-image";
import { NotesEditor } from "@/components/research/notes-editor";

export const metadata: Metadata = { title: "Produto · Research" };
export const dynamic = "force-dynamic";

export default async function ProductDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const { id } = await params;

  const data = await getProduct(supabase, user.id, id);
  if (!data) notFound();
  const { product } = data;

  return (
    <div className="mx-auto max-w-5xl space-y-6">
      <ProductDetailHeader product={product} />

      <div className="grid grid-cols-1 gap-6 md:grid-cols-[280px_1fr]">
        <ProductImage
          productId={product.id}
          imageUrl={product.image_url}
          hasUrl={!!product.url}
        />
        <NotesEditor productId={product.id} initial={product.notes} />
      </div>
    </div>
  );
}
