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
        description="Liga o separador do fornecedor à loja certa e aplica os mesmos COGS ao dashboard, produtos, P&L e ROAS."
      />
      <SupplierPanel data={data} />
    </div>
  );
}
