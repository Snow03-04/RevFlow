import { NextResponse } from "next/server";

// Lightweight, auth-free endpoint hit by the keep-warm scheduled function so the
// serverless SSR handler stays warm (no cold start on the user's first click).
export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json({ ok: true, at: Date.now() });
}
