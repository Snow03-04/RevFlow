import type { LiveReading, StoreActivity } from "../../supabase/functions/_shared/live-snapshot";
export type { LiveReading, StoreActivity } from "../../supabase/functions/_shared/live-snapshot";
export type LiveStore = { id: string; name: string; domain: string; activity: StoreActivity | "pending"; reading?: LiveReading };
