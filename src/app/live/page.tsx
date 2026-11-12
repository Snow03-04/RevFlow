import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LiveBoard } from "@/components/live/live-board";
import { createClient, getAuthenticatedUser } from "@/lib/supabase/server";
import { storeLabel } from "@/lib/utils";

export const metadata: Metadata = { title: "Lojas em direto", robots: { index: false } };

export default async function LivePage() {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?redirectTo=%2Flive");
  const db = await createClient();
  const { data, error } = await db.from("shopify_connections")
    .select("id,shop_name,shop_domain").eq("user_id", user.id)
    .in("status", ["active", "error"]).order("created_at");
  const stores = (data ?? []).map(store => ({
    id: store.id, name: storeLabel(store.shop_name, store.shop_domain), domain: store.shop_domain, activity: "pending" as const,
  }));
  return <LiveBoard key={user.id} initialStores={stores} initialError={!!error} />;
}
