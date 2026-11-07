import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getSubscriptionData } from "@/lib/subscriptions/queries";
import { SubscriptionsManager } from "@/components/subscriptions/subscriptions-manager";

export const metadata: Metadata = { title: "Subscrições" };
export const dynamic = "force-dynamic";
export default async function SubscriptionsPage({ searchParams }: { searchParams: Promise<{ store?: string; subscription?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const params = await searchParams;
  try {
    const data = await getSubscriptionData(await createClient(), user.id);
    return <SubscriptionsManager rows={data.rows} stores={data.stores} initialToday={data.today} timezone={data.timezone}
      selectedStore={params.store} selectedId={params.subscription} />;
  } catch {
    return <div className="mx-auto max-w-5xl space-y-4"><h1 className="text-3xl font-semibold">Subscrições</h1>
      <p role="alert" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">Não foi possível carregar as subscrições. Atualiza a página para tentar novamente.</p></div>;
  }
}
