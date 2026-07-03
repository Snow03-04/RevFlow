import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildGoogleAuthUrl } from "@/lib/google/oauth";
import { randomState } from "@/lib/crypto";
import { clientEnv, isGoogleConfigured } from "@/lib/env";

/** Kicks off Google Ads OAuth for the authenticated merchant. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${clientEnv.appUrl}/login`);

  if (!isGoogleConfigured()) {
    return NextResponse.redirect(
      `${clientEnv.appUrl}/connections?error=google_not_configured`,
    );
  }

  const state = randomState();
  const cookieStore = await cookies();
  cookieStore.set("google_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildGoogleAuthUrl(state));
}
