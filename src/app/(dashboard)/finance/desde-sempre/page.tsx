import { redirect } from "next/navigation";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { getLifetimeData } from "@/lib/trackers/lifetime-query";
import { LifetimeFinancePage } from "@/components/trackers/lifetime-finance-page";

export const metadata = { title: "Desde Sempre · Finance" };
export const dynamic = "force-dynamic";

export default async function Page({ searchParams }: { searchParams: Promise<{ store?: string }> }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  const db = await createClient();
  const { store } = await searchParams;
  const data = await getLifetimeData(db, user.id, user.user_metadata, store);
  return <LifetimeFinancePage data={data} filtered={!!store} />;
}
