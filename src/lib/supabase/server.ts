import "server-only";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";

/**
 * Supabase client for Server Components, Route Handlers and Server Actions.
 * Reads the user's session from cookies; RLS applies to every query.
 *
 * In Next.js 15 `cookies()` is async, so this returns a Promise.
 */
export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient<Database>(
    clientEnv.supabaseUrl,
    clientEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options),
            );
          } catch {
            // `setAll` was called from a Server Component. Safe to ignore when
            // a middleware is in charge of refreshing sessions.
          }
        },
      },
    },
  );
}

/** Convenience: the current authenticated user, or null. */
export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
