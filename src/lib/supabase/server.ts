import "server-only";
import { cache } from "react";
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
// React cache lives for this server render only. Layout, page and nested server
// components share a client without sharing sessions between users or requests.
export const createClient = cache(async () => {
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
});

/** Convenience: the current authenticated user, or null. */
export const getCurrentUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});
