import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/supabase/server";
import { getSupplierData } from "@/lib/supplier/actions";
import { PageHeader } from "@/components/dashboard/page-header";
import { SupplierPanel } from "@/components/supplier/supplier-panel";

export const metadata: Metadata = { title: "Fornecedor" };
export const dynamic = "force-dynamic";

export default async function SupplierPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const data = await getSupplierData();

  return (
    <div className="space-y-6">
      <PageHeader
        title="Fornecedor"
        description="Liga a tua Google Sheet de custos. A RevFlow mostra o que está pago / por pagar e atualiza os COGS por produto sozinha."
      />
      <SupplierPanel data={data} />
    </div>
  );
}
