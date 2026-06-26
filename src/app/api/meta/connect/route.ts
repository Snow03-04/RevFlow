import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { getCurrentUser } from "@/lib/supabase/server";
import { buildMetaAuthUrl } from "@/lib/meta/oauth";
import { randomState } from "@/lib/crypto";
import { clientEnv } from "@/lib/env";

/** Kicks off Meta (Facebook) OAuth for the authenticated merchant. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.redirect(`${clientEnv.appUrl}/login`);

  const state = randomState();
  const cookieStore = await cookies();
  cookieStore.set("meta_oauth_state", state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });

  return NextResponse.redirect(buildMetaAuthUrl(state));
}
