import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";

type DB = SupabaseClient<Database>;

/** Wrap a sync unit of work and record its outcome in `sync_logs`. */
export async function withSyncLog<T>(
  supabase: DB,
  params: { userId: string; source: string; jobType: string },
  fn: () => Promise<{ records: number; result?: T }>,
): Promise<T | undefined> {
  const startedAt = new Date().toISOString();
  try {
    const { records, result } = await fn();
    await supabase.from("sync_logs").insert({
      user_id: params.userId,
      source: params.source,
      job_type: params.jobType,
      status: "success",
      records_processed: records,
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    return result;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await supabase.from("sync_logs").insert({
      user_id: params.userId,
      source: params.source,
      job_type: params.jobType,
      status: "error",
      error: message.slice(0, 1000),
      started_at: startedAt,
      finished_at: new Date().toISOString(),
    });
    throw err;
  }
}
