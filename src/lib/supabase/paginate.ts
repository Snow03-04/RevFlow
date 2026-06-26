import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type DB = SupabaseClient<Database>;
const PAGE = 1000;

/**
 * Fetch **all** rows for a user-scoped table, paging past Supabase's default
 * 1000-row cap. Stores with thousands of product variants would otherwise be
 * silently truncated (breaking COGS, matching and cost lookups).
 *
 * `extra` lets the caller add more filters (e.g. `.not("cost", "is", null)`).
 */
export async function selectAllByUser<T = Record<string, unknown>>(
  supabase: DB,
  table: keyof Database["public"]["Tables"],
  columns: string,
  userId: string,
  extra?: (q: any) => any,
): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    // Cast at the source: a runtime table name makes the typed column unions
    // collapse to `never`, so we operate on an untyped builder here.
    const base = supabase.from(table) as any;
    let q = base
      .select(columns)
      .eq("user_id", userId)
      .range(from, from + PAGE - 1);
    if (extra) q = extra(q);
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}
