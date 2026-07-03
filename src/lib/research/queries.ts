import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { ProductStatus } from "@/lib/research/constants";

type DB = SupabaseClient<Database>;

export interface ProductFilters {
  status?: string;
  tag?: string;
  favorite?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export type ResearchProduct = Tables<"research_products"> & { adCount: number };
export type ResearchAd = Tables<"research_ads">;

/** Product list with per-product ad counts, filtered + paginated server-side. */
export async function listProducts(
  supabase: DB,
  userId: string,
  f: ProductFilters = {},
): Promise<ResearchProduct[]> {
  const limit = f.limit ?? 60;
  const offset = f.offset ?? 0;

  let query = supabase
    .from("research_products")
    .select("*, ads:research_ads(count)")
    .eq("user_id", userId);

  if (f.status) query = query.eq("status", f.status);
  if (f.favorite) query = query.eq("favorite", true);
  if (f.tag) query = query.contains("tags", [f.tag]);
  if (f.q && f.q.trim()) {
    const s = f.q.trim().replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${s}%,brand.ilike.%${s}%,url.ilike.%${s}%`);
  }

  const { data } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return (data ?? []).map((p) => {
    const { ads, ...row } = p as Tables<"research_products"> & {
      ads?: { count: number }[];
    };
    return { ...row, adCount: ads?.[0]?.count ?? 0 };
  });
}

/** A single product with its ads (newest first). */
export async function getProduct(
  supabase: DB,
  userId: string,
  id: string,
): Promise<{ product: Tables<"research_products">; ads: ResearchAd[] } | null> {
  const [{ data: product }, { data: ads }] = await Promise.all([
    supabase
      .from("research_products")
      .select("*")
      .eq("user_id", userId)
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("research_ads")
      .select("*")
      .eq("user_id", userId)
      .eq("product_id", id)
      .order("created_at", { ascending: false }),
  ]);
  if (!product) return null;
  return { product, ads: ads ?? [] };
}

export interface ResearchStats {
  total: number;
  byStatus: Record<ProductStatus, number>;
  totalAds: number;
}

/** Dashboard counts: products per status + total saved ads. */
export async function researchStats(
  supabase: DB,
  userId: string,
): Promise<ResearchStats> {
  const [{ data: rows }, { count: totalAds }] = await Promise.all([
    supabase.from("research_products").select("status").eq("user_id", userId),
    supabase
      .from("research_ads")
      .select("id", { count: "exact", head: true })
      .eq("user_id", userId),
  ]);

  const byStatus: Record<ProductStatus, number> = {
    untested: 0,
    testing: 0,
    winner: 0,
    loser: 0,
    scaling: 0,
    archived: 0,
  };
  for (const r of rows ?? []) {
    const s = r.status as ProductStatus;
    if (s in byStatus) byStatus[s] += 1;
  }

  return { total: (rows ?? []).length, byStatus, totalAds: totalAds ?? 0 };
}

/** Distinct tags for the filter UI. */
export async function listTags(supabase: DB, userId: string): Promise<string[]> {
  const { data } = await supabase
    .from("research_products")
    .select("tags")
    .eq("user_id", userId);
  const set = new Set<string>();
  for (const r of data ?? []) for (const t of r.tags ?? []) set.add(t);
  return [...set].sort();
}
