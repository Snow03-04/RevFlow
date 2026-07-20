import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import type { StoreStatus } from "@/lib/research/store-constants";

type DB = SupabaseClient<Database>;

export interface StoreFilters {
  status?: string;
  tag?: string;
  favorite?: boolean;
  q?: string;
  limit?: number;
  offset?: number;
}

export type ResearchStore = Tables<"research_stores">;

/** Store list, filtered + paginated server-side (mirrors listProducts). */
export async function listStores(
  supabase: DB,
  userId: string,
  f: StoreFilters = {},
): Promise<ResearchStore[]> {
  const limit = f.limit ?? 60;
  const offset = f.offset ?? 0;

  let query = supabase
    .from("research_stores")
    .select("*")
    .eq("user_id", userId);

  if (f.status) query = query.eq("status", f.status);
  if (f.favorite) query = query.eq("favorite", true);
  if (f.tag) query = query.contains("tags", [f.tag]);
  if (f.q && f.q.trim()) {
    const s = f.q.trim().replace(/[%,()]/g, "");
    query = query.or(`name.ilike.%${s}%,niche.ilike.%${s}%,url.ilike.%${s}%`);
  }

  const { data } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  return data ?? [];
}

/** A single store (owner-scoped). */
export async function getStore(
  supabase: DB,
  userId: string,
  id: string,
): Promise<ResearchStore | null> {
  const { data } = await supabase
    .from("research_stores")
    .select("*")
    .eq("user_id", userId)
    .eq("id", id)
    .maybeSingle();
  return data ?? null;
}

export interface StoreStats {
  total: number;
  byStatus: Record<StoreStatus, number>;
}

/** Counts per status for the stats bar. */
export async function storeStats(
  supabase: DB,
  userId: string,
): Promise<StoreStats> {
  const { data: rows } = await supabase
    .from("research_stores")
    .select("status")
    .eq("user_id", userId);

  const byStatus: Record<StoreStatus, number> = {
    watching: 0,
    interesting: 0,
    winner: 0,
    competitor: 0,
    archived: 0,
  };
  for (const r of rows ?? []) {
    const s = r.status as StoreStatus;
    if (s in byStatus) byStatus[s] += 1;
  }

  return { total: (rows ?? []).length, byStatus };
}

/** Distinct tags for the filter UI. */
export async function listStoreTags(
  supabase: DB,
  userId: string,
): Promise<string[]> {
  const { data } = await supabase
    .from("research_stores")
    .select("tags")
    .eq("user_id", userId);
  const set = new Set<string>();
  for (const r of data ?? []) for (const t of r.tags ?? []) set.add(t);
  return [...set].sort();
}
