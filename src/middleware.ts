import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image
     * - favicon and common static assets
     * Webhook + OAuth callback routes are handled inside updateSession.
     */
    "/((?!_next/static|_next/image|favicon.ico|audio/hello-sir\\.mp3$|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
