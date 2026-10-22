import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";
import type { Database } from "@/types/database";
import { safeRedirect } from "@/lib/auth/redirect";

const PUBLIC_PATHS = [
  "/",
  "/privacidade", "/termos", "/cookies", "/dados-google", "/contacto",
  "/robots.txt", "/sitemap.xml",
  "/login",
  "/signup",
  "/auth/callback",
  "/api/shopify/webhooks",
  "/api/cron/sync",
  "/api/billing/webhook",
  "/api/contact",
  "/api/ping",
  // Called by the Google Ads Script (HMAC token in the body, no session).
  "/api/google/script-costs",
  "/api/google/script-gross-costs",
];

/**
 * Refreshes the Supabase session on every request and guards private routes.
 * Called from the root middleware.
 */
export async function updateSession(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const isPublic = PUBLIC_PATHS.includes(pathname);
  // Public information and signed provider callbacks do not need an Auth read.
  if (isPublic && pathname !== "/login" && pathname !== "/signup") return NextResponse.next({ request });
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(
    clientEnv.supabaseUrl,
    clientEnv.supabaseAnonKey,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(
          cookiesToSet: {
            name: string;
            value: string;
            options?: Record<string, unknown>;
          }[],
        ) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // IMPORTANT: getUser() revalidates the token with Supabase Auth.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const finalize = (result: NextResponse) => {
    response.cookies.getAll().forEach(cookie => result.cookies.set(cookie));
    result.headers.set("Cache-Control", "private, no-store");
    return result;
  };

  // Unauthenticated user hitting a protected page -> send to /login.
  if (!user && !isPublic && pathname !== "/") {
    if (pathname.startsWith("/api/")) {
      return finalize(NextResponse.json({ ok: false, error: "Sessão expirada. Inicia sessão novamente." }, { status: 401 }));
    }
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("redirectTo", `${pathname}${request.nextUrl.search}`);
    return finalize(NextResponse.redirect(url));
  }

  // Authenticated user hitting auth pages -> send to dashboard.
  if (user && (pathname === "/login" || pathname === "/signup")) {
    const target = safeRedirect(request.nextUrl.searchParams.get("redirectTo"));
    return finalize(NextResponse.redirect(new URL(target, request.url)));
  }

  if (user && !isPublic && pathname !== "/subscribe" && !pathname.startsWith("/api/billing/") && pathname !== "/admin") {
    const { data, error } = await supabase.rpc("revflow_my_access");
    if (error) return finalize(NextResponse.json({ error: "O serviço de contas está temporariamente indisponível." }, { status: 503 }));
    const access = data as { has_access?: boolean } | null;
    if (!access?.has_access) {
      if (pathname.startsWith("/api/")) return finalize(NextResponse.json({ error: "É necessária uma subscrição ativa." }, { status: 402 }));
      return finalize(NextResponse.redirect(new URL("/subscribe", request.url)));
    }
  }

  return finalize(response);
}
