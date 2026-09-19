"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { collectionHandle, googleCollectionLinkId } from "@/lib/google/collection-links";
import { getGooglePnlCatalog } from "./google-pnl-query";

export async function setGoogleCampaignCollection(key: string, year: number, value: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  const handle = collectionHandle(value);
  if ((value.trim() && !handle) || !Number.isInteger(year) || year < 2000 || year > 2100) return { ok: false, error: "Indica o endereço da coleção ou o seu identificador, por exemplo winter-cardigans." };
  const db = await createClient();
  const catalog = await getGooglePnlCatalog(db, user.id, year);
  const campaign = catalog.options.find((c) => c.key === key && c.storeId);
  if (!campaign) return { ok: false, error: "Campanha indisponível nesta loja." };
  const { error } = await db.from("campaign_links").upsert({ user_id: user.id,
    campaign_id: googleCollectionLinkId(key), collection_handle: handle,
    product_handle: null, link_kind: handle ? "google-manual" : "google-auto" }, { onConflict: "user_id,campaign_id" });
  if (error) return { ok: false, error: "Não foi possível guardar a associação." };
  revalidatePath("/finance/google");
  return { ok: true };
}
