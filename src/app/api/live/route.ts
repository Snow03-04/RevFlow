import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { readLiveActivity } from "@/lib/shopify/live-activity";
import { storeLabel } from "@/lib/utils";
import type { LiveStore } from "@/types/live";

export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET() {
  const user = await getCurrentUser();
  if (!user) return Response.json({ error: "Inicia sessão para ver as lojas." }, { status: 401, headers });
  const db = await createClient();
  const { data, error } = await db.from("shopify_connections")
    .select("id,shop_name,shop_domain,access_token,auth_type,client_id,updated_at")
    .eq("user_id", user.id).in("status", ["active", "error"]).order("created_at");
  if (error) return Response.json({ error: "Não foi possível consultar as lojas." }, { status: 503, headers });
  const stores: LiveStore[] = await Promise.all(data.map(async store => ({
    id: store.id,
    name: storeLabel(store.shop_name, store.shop_domain),
    domain: store.shop_domain,
    reading: await readLiveActivity(store),
  })));
  return Response.json({ stores }, { headers });
}
