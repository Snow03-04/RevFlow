import "server-only";
import { z } from "zod";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/types/database";
import { ymdInTz } from "@/lib/date";

const bucket = "google-daily-budgets";
export const ScriptBudget = z.object({
  date: z.string().date(), observedAt: z.string().datetime(), timeZone: z.string().min(1).max(100),
  budget: z.number().finite().nonnegative().nullable(), spent: z.number().finite().nonnegative(),
  forecast: z.number().finite().nonnegative().nullable().optional(),
  firstDayExtra: z.number().finite().nonnegative().nullable().optional(),
});
const StoredBudget = ScriptBudget.extend({ storeId: z.string().uuid(), currency: z.string().regex(/^[A-Z]{3}$/) });
type StoredBudget = z.infer<typeof StoredBudget>;
type DB = SupabaseClient<Database>;

export function currentBudget(snapshot: z.infer<typeof ScriptBudget>, now = new Date()) {
  const age = now.getTime() - Date.parse(snapshot.observedAt);
  if (age < -60_000 || age > 2 * 3600_000) return false;
  try { return snapshot.date === ymdInTz(now, snapshot.timeZone); }
  catch { return false; }
}

/** Called by authenticated store webhooks only. Immutable keys tolerate concurrent hourly runs and retries. */
export async function saveBudgetSnapshot(db: DB, userId: string, customer: string, snapshot: StoredBudget) {
  if (!currentBudget(snapshot)) return;
  const prefix = `${userId}/${customer.replace(/\D/g, "")}`;
  const filename = `${Date.parse(snapshot.observedAt)}.json`;
  const storage = db.storage.from(bucket);
  const upload = () => storage.upload(`${prefix}/${filename}`, JSON.stringify(snapshot), { contentType: "application/json", cacheControl: "0" });
  let { error } = await upload();
  if (error && /bucket not found/i.test(error.message)) {
    const created = await db.storage.createBucket(bucket, { public: false, fileSizeLimit: 4096, allowedMimeTypes: ["application/json"] });
    if (created.error && !/already exists/i.test(created.error.message)) throw created.error;
    ({ error } = await upload());
  }
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  const files = await storage.list(prefix);
  const older = files.data?.filter((f) => /^\d{13}(-[a-f\d-]{36})?\.json$/.test(f.name) && f.name.slice(0, 13) < filename.slice(0, 13)) ?? [];
  if (older.length) await storage.remove(older.map((f) => `${prefix}/${f.name}`));
}

/** Only called with the signed-in dashboard user's ID. Paths never come from the browser. */
export async function readBudgetSnapshots(db: DB, userId: string) {
  const storage = db.storage.from(bucket);
  const result = new Map<string, StoredBudget | null>();
  for (let offset = 0; ; offset += 100) {
    const accounts = await storage.list(userId, { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (accounts.error) {
      if (/bucket not found/i.test(accounts.error.message)) return result;
      throw accounts.error;
    }
    const folders = accounts.data.filter((f) => /^\d+$/.test(f.name));
    const reads = await Promise.allSettled(folders.map(async ({ name }) => {
      const prefix = `${userId}/${name}`;
      const files = await storage.list(prefix, { limit: 1, sortBy: { column: "name", order: "desc" } });
      if (files.error) throw files.error;
      if (!files.data.length) return null;
      const blob = await storage.download(`${prefix}/${files.data[0].name}`);
      if (blob.error) throw blob.error;
      const snapshot = StoredBudget.parse(JSON.parse(await blob.data.text()));
      const boundStore = files.data[0].name.match(/^\d{13}-([a-f\d-]{36})\.json$/)?.[1];
      return boundStore && boundStore !== snapshot.storeId ? null : snapshot;
    }));
    reads.forEach((read, index) => result.set(folders[index].name, read.status === "fulfilled" ? read.value : null));
    if (accounts.data.length < 100) return result;
  }
}
