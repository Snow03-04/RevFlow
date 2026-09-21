"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { collectionHandle } from "@/lib/google/collection-links";
import { getMetaPnlCatalog } from "./meta-pnl-query";
import { getGooglePnlCatalog } from "./google-pnl-query";
import { generalCampaignLinkId } from "./general-sheet";
import { getCurrentMetaCampaigns } from "@/lib/meta/campaign-catalog";

export async function setGeneralCampaignCollection(platform: "meta" | "google", key: string, year: number, value: string) {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Sessão expirada." };
  const handle = collectionHandle(value);
  if (!handle || !["meta", "google"].includes(platform) || !Number.isInteger(year) || year < 2000 || year > 2100)
    return { ok: false, error: "Indica o endereço ou identificador da coleção." };
  const db = await createClient();
  const catalog = platform === "meta" ? await getMetaPnlCatalog(db, user.id, year) : await getGooglePnlCatalog(db, user.id, year);
  const campaign = catalog.options.find((c) => c.key === key && c.storeId)
    ?? (platform === "meta" ? (await getCurrentMetaCampaigns(db, user.id)).options.find((c) => c.key === key && c.storeId) : undefined);
  if (!campaign) return { ok: false, error: "Campanha indisponível nesta loja." };
  const { error } = await db.from("campaign_links").upsert({ user_id: user.id,
    campaign_id: generalCampaignLinkId(platform, key),
    collection_handle: handle, product_handle: null, link_kind: "general-manual",
  }, { onConflict: "user_id,campaign_id" });
  if (error) return { ok: false, error: "Não foi possível guardar a associação." };
  revalidatePath("/finance/general");
  return { ok: true };
}
