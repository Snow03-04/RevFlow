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
    // A unique tie-breaker keeps successive pages stable even when many rows
    // share the date/order used by the caller.
    const keys =
      table === "order_supplier_costs"
        ? ["shopify_connection_id", "order_number"]
        : table === "campaign_links"
          ? ["campaign_id"]
          : ["settings", "pnl_settings", "roas_settings"].includes(table)
            ? ["user_id"]
            : ["id"];
    for (const key of keys) q = q.order(key, { ascending: true });
    const { data, error } = await q;
    if (error) throw error;
    const rows = (data ?? []) as T[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

/** Paginate every chunk too: 200 orders can contain more than 1,000 lines. */
export async function selectAllIn<T>(
  supabase: DB,
  table: keyof Database["public"]["Tables"],
  columns: string,
  userId: string,
  column: string,
  ids: string[],
): Promise<T[]> {
  const out: T[] = [];
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    out.push(
      ...(await selectAllByUser<T>(supabase, table, columns, userId, (q) =>
        q.in(column, unique.slice(i, i + 200)),
      )),
    );
  }
  return out;
}
