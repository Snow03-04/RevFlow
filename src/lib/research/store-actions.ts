"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { fetchProductMeta } from "@/lib/research/scrape";

export interface StoreResult {
  ok: boolean;
  error?: string;
  id?: string;
}

/** Best-effort store name from a URL: the hostname, capitalised. */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const base = u.hostname.replace(/^www\./, "").split(".")[0] ?? "";
    return base ? base.charAt(0).toUpperCase() + base.slice(1) : u.hostname;
  } catch {
    return "";
  }
}

export async function createStore(input: {
  url?: string;
  name?: string;
  notes?: string;
}): Promise<StoreResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  // Grab the store's logo/banner + name straight from the homepage
  // (og:image / og:title) — same scraper the product hub uses.
  let image: string | null = null;
  let scrapedTitle = "";
  const url = input.url?.trim() || null;
  if (url) {
    const meta = await fetchProductMeta(url);
    image = meta.image;
    scrapedTitle = meta.title ?? "";
  }

  const name =
    (input.name ?? "").trim() ||
    scrapedTitle ||
    (url ? nameFromUrl(url) : "") ||
    "Nova loja";

  const { data, error } = await supabase
    .from("research_stores")
    .insert({
      user_id: user.id,
      name,
      url,
      notes: input.notes?.trim() || null,
      image_url: image,
    })
    .select("id")
    .single();

  if (error || !data) {
    return { ok: false, error: error?.message ?? "Falha ao criar." };
  }
  revalidatePath("/stores");
  return { ok: true, id: data.id };
}

export async function updateStore(
  id: string,
  patch: {
    name?: string;
    url?: string | null;
    niche?: string | null;
    status?: string;
    tags?: string[];
    notes?: string | null;
    favorite?: boolean;
  },
): Promise<StoreResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("research_stores")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/stores");
  revalidatePath(`/stores/${id}`);
  return { ok: true };
}

export async function deleteStore(id: string): Promise<StoreResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("research_stores")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/stores");
  return { ok: true };
}

export async function toggleStoreFavorite(
  id: string,
  favorite: boolean,
): Promise<StoreResult> {
  return updateStore(id, { favorite });
}

/** Re-fetch the store image (og:image) from its URL. */
export async function refetchStoreImage(id: string): Promise<StoreResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: store } = await supabase
    .from("research_stores")
    .select("url")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!store?.url) {
    return { ok: false, error: "Esta loja não tem URL." };
  }

  const meta = await fetchProductMeta(store.url);
  if (!meta.image) {
    return { ok: false, error: "Não consegui obter a imagem deste URL." };
  }

  const { error } = await supabase
    .from("research_stores")
    .update({ image_url: meta.image })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/stores");
  revalidatePath(`/stores/${id}`);
  return { ok: true };
}
