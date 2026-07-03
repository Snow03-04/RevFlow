"use server";

import { revalidatePath } from "next/cache";
import { createClient, getCurrentUser } from "@/lib/supabase/server";
import { decryptToken } from "@/lib/crypto";
import {
  parseAdArchiveId,
  deriveSearchTerms,
  discoverPageId,
  searchAdsArchive,
} from "@/lib/research/adlibrary";
import { fetchProductMeta } from "@/lib/research/scrape";

export interface ResearchResult {
  ok: boolean;
  error?: string;
  id?: string;
  added?: number;
}

/** Best-effort product name from a URL (last path segment or host). */
function nameFromUrl(url: string): string {
  try {
    const u = new URL(url.startsWith("http") ? url : `https://${url}`);
    const seg = u.pathname.split("/").filter(Boolean).pop();
    const base = (seg ?? u.hostname)
      .replace(/[-_]+/g, " ")
      .replace(/\.[a-z]+$/i, "")
      .trim();
    return base ? base.slice(0, 120) : u.hostname;
  } catch {
    return "";
  }
}

export async function createProduct(input: {
  url?: string;
  name?: string;
  notes?: string;
}): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  // Grab the product photo + title straight from the URL (og:image / og:title).
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
    "Novo produto";

  const { data, error } = await supabase
    .from("research_products")
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
  revalidatePath("/research");
  return { ok: true, id: data.id };
}

export async function updateProduct(
  id: string,
  patch: {
    name?: string;
    url?: string | null;
    brand?: string | null;
    status?: string;
    tags?: string[];
    notes?: string | null;
    favorite?: boolean;
  },
): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("research_products")
    .update(patch)
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/research");
  revalidatePath(`/research/${id}`);
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { error } = await supabase
    .from("research_products")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/research");
  return { ok: true };
}

export async function toggleFavorite(
  id: string,
  favorite: boolean,
): Promise<ResearchResult> {
  return updateProduct(id, { favorite });
}

/** Re-fetch the product photo (og:image) from its URL. */
export async function refetchProductImage(id: string): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("research_products")
    .select("url")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!product?.url) {
    return { ok: false, error: "Este produto não tem URL." };
  }

  const meta = await fetchProductMeta(product.url);
  if (!meta.image) {
    return { ok: false, error: "Não consegui obter a foto deste URL." };
  }

  const { error } = await supabase
    .from("research_products")
    .update({ image_url: meta.image })
    .eq("id", id)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/research");
  revalidatePath(`/research/${id}`);
  return { ok: true };
}

/**
 * Add an ad to a product by pasting its Ad Library link. In Phase A this saves
 * the link + archive id (deduped); Phase B hydrates media/text from the snapshot.
 */
export async function addAdByLink(
  productId: string,
  link: string,
): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };

  const adId = parseAdArchiveId(link);
  if (!adId) {
    return { ok: false, error: "Link inválido — cola o link do anúncio da Meta Ad Library." };
  }
  const supabase = await createClient();

  const { error } = await supabase.from("research_ads").upsert(
    {
      user_id: user.id,
      product_id: productId,
      ad_archive_id: adId,
      snapshot_url: link.trim(),
      active: true,
    },
    { onConflict: "product_id,ad_archive_id", ignoreDuplicates: true },
  );
  if (error) return { ok: false, error: error.message };

  await supabase
    .from("research_products")
    .update({ last_researched_at: new Date().toISOString() })
    .eq("id", productId)
    .eq("user_id", user.id);

  revalidatePath(`/research/${productId}`);
  return { ok: true };
}

/**
 * Automatically find ads for a product in the Meta Ad Library, using the store's
 * Facebook Page (discovered from the product URL) and/or keywords. Inserts only
 * ads that don't exist yet (dedup by ad_archive_id). Needs an active Meta
 * connection; only returns commercial ads for EU markets.
 */
export async function researchProductAds(
  productId: string,
): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();

  const { data: product } = await supabase
    .from("research_products")
    .select("id, url, name")
    .eq("id", productId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!product) return { ok: false, error: "Produto não encontrado." };

  const { data: conn } = await supabase
    .from("meta_connections")
    .select("access_token")
    .eq("user_id", user.id)
    .in("status", ["active", "error"])
    .limit(1)
    .maybeSingle();
  if (!conn) {
    return {
      ok: false,
      error: "Liga o Meta em Connections para pesquisar anúncios automaticamente.",
    };
  }

  try {
    const token = decryptToken(conn.access_token);
    const pageId = await discoverPageId(product.url, token);
    const searchTerms = deriveSearchTerms(product.url, product.name);
    const found = await searchAdsArchive(token, {
      userId: user.id,
      productId,
      pageId,
      searchTerms,
    });

    const { data: existing } = await supabase
      .from("research_ads")
      .select("ad_archive_id")
      .eq("user_id", user.id)
      .eq("product_id", productId);
    const have = new Set((existing ?? []).map((e) => e.ad_archive_id));
    const fresh = found.filter((a) => !have.has(a.ad_archive_id));

    if (fresh.length > 0) {
      const { error } = await supabase.from("research_ads").insert(fresh);
      if (error) return { ok: false, error: error.message };
    }

    await supabase
      .from("research_products")
      .update({ last_researched_at: new Date().toISOString() })
      .eq("id", productId)
      .eq("user_id", user.id);

    revalidatePath(`/research/${productId}`);
    return { ok: true, added: fresh.length };
  } catch (err) {
    const raw = err instanceof Error ? err.message : "";
    // Meta error 10 on ads_archive = the account hasn't been granted Ad Library
    // API access (a separate gate from the Ads API).
    if (/error 10\b|does not have permission|permission for this action/i.test(raw)) {
      return {
        ok: false,
        error:
          "A Meta Ad Library API precisa que confirmes a identidade e localização em facebook.com/id (passo único, separado da ligação de Ads). Depois disso, re-liga o Meta e tenta de novo.",
      };
    }
    return { ok: false, error: raw || "Falha na pesquisa da Ad Library." };
  }
}

export async function deleteAd(
  adId: string,
  productId: string,
): Promise<ResearchResult> {
  const user = await getCurrentUser();
  if (!user) return { ok: false, error: "Não autenticado." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("research_ads")
    .delete()
    .eq("id", adId)
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath(`/research/${productId}`);
  return { ok: true };
}
