import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LiveGlobe } from "@/components/live/globe/live-globe";
import { getAuthenticatedUser } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Globo ao vivo", robots: { index: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function GlobePage({ searchParams }: { searchParams: Promise<{ store?: string | string[] }> }) {
  const user = await getAuthenticatedUser();
  if (!user) redirect("/login?redirectTo=%2Fglobe");
  const { store } = await searchParams;
  // The sidebar's store switcher travels as ?store=<id>: open the globe on that store.
  const initialStore = typeof store === "string" && UUID.test(store) ? store : null;
  return <LiveGlobe key={user.id} initialStore={initialStore} />;
}
