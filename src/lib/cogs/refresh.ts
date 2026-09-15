import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Tables } from "@/types/database";
import { recomputeDailyMetrics } from "@/lib/metrics";
import { projectPnlMonth } from "@/lib/trackers/pnl-import";
import { projectRoasMonth } from "@/lib/trackers/roas-import";
import { selectAllByUser } from "@/lib/supabase/paginate";
import { todayYmd, ymdInTz } from "@/lib/date";

/** Refresh every affected month using dated order costs. Historical ROAS must
 * never be overwritten with today's flat catalogue cost. Errors reach the UI. */
export async function refreshCostDependents(
  db: SupabaseClient<Database>,
  userId: string,
): Promise<void> {
  const [
    { data: settings, error },
    { data: firstOrder, error: orderError },
    pnl,
    roas,
  ] = await Promise.all([
    db.from("settings").select("*").eq("user_id", userId).single(),
    db
      .from("orders")
      .select("processed_at")
      .eq("user_id", userId)
      .order("processed_at")
      .limit(1)
      .maybeSingle(),
    selectAllByUser<Tables<"pnl_settings">>(db, "pnl_settings", "*", userId),
    selectAllByUser<Tables<"roas_settings">>(db, "roas_settings", "*", userId),
  ]);
  if (error) throw error;
  if (orderError) throw orderError;
  if (!firstOrder) return;
  const timezone = settings?.timezone ?? "UTC";
  const from = ymdInTz(new Date(firstOrder.processed_at), timezone);
  const to = todayYmd(timezone);
  // Month-sized windows bound query and write sizes and preserve past dates.
  for (
    let year = Number(from.slice(0, 4)), month = Number(from.slice(5, 7));
    ;

  ) {
    const prefix = `${year}-${String(month).padStart(2, "0")}`;
    if (prefix > to.slice(0, 7)) break;
    const last = `${prefix}-${new Date(year, month, 0).getDate()}`;
    await recomputeDailyMetrics(
      db,
      userId,
      { from: `${prefix}-01`, to: last < to ? last : to },
      { settings },
    );
    if (pnl.length)
      await projectPnlMonth(db, userId, year, month, { costsOnly: true });
    if (roas.length)
      await projectRoasMonth(db, userId, year, month, { costsOnly: true });
    if (++month > 12) {
      month = 1;
      year++;
    }
  }
}
