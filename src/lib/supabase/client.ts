"use client";

import { createBrowserClient } from "@supabase/ssr";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for use in Client Components.
 * Uses the public anon key; all access is constrained by Row Level Security.
 */
export function createClient() {
  return createBrowserClient<Database>(
    clientEnv.supabaseUrl,
    clientEnv.supabaseAnonKey,
  );
}
