import "server-only";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { clientEnv, serverEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Service-role Supabase client. BYPASSES Row Level Security.
 *
 * Use ONLY in trusted server contexts that have no user session but must act
 * on a user's behalf: cron jobs and verified webhooks. Never expose this to
 * the browser and never call it with unvalidated user input as the user_id.
 */
export function createAdminClient() {
  return createSupabaseClient<Database>(
    clientEnv.supabaseUrl,
    serverEnv.supabaseServiceRoleKey,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
