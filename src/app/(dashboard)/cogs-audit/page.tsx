import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSettings } from "@/lib/queries";
import { getCogsAudit } from "@/lib/cogs/audit";
import { dashboardRanges } from "@/lib/date";
import { PageHeader } from "@/components/dashboard/page-header";
import { RangeSelect } from "@/components/dashboard/range-select";
import { AuditTable } from "@/components/cogs/audit-table";

export const metadata: Metadata = { title: "Auditoria COGS" };
export const dynamic = "force-dynamic";

export default async function CogsAuditPage({
  searchParams,
}: {
  searchParams: Promise<{ range?: string; store?: string }>;
}) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const supabase = await createClient();
  const sp = await searchParams;

  const settings = await getSettings(supabase, user.id);
  const tz = settings?.timezone ?? "UTC";
  const { current } = dashboardRanges(sp.range ?? "last7", tz);
  const audit = await getCogsAudit(current, sp.store);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Auditoria COGS"
        description="Como o custo de cada encomenda foi calculado — os mesmos números que o dashboard usa."
        actions={<RangeSelect />}
      />
      <AuditTable audit={audit} rangeLabel={`${current.from} → ${current.to}`} />
    </div>
  );
}
