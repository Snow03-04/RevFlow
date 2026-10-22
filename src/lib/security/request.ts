import "server-only";
import { createHmac } from "node:crypto";
import { clientEnv, serverEnv } from "@/lib/env";
import { billingRpc } from "@/lib/billing/server";

export function isSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expected = new URL(clientEnv.appUrl).origin;
  return origin === expected || (process.env.NODE_ENV !== "production" && origin === new URL(request.url).origin);
}
/** Reject oversized streamed bodies too, not just declared Content-Length. */
export async function readLimitedBody(request: Request, maxBytes: number) {
  if (Number(request.headers.get("content-length")) > maxBytes) throw new Error("payload_too_large");
  const reader = request.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder(); let size = 0; let body = "";
  try {
    for (;;) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > maxBytes) { await reader.cancel(); throw new Error("payload_too_large"); } body += decoder.decode(value, { stream: true }); }
    return body + decoder.decode();
  } finally { reader.releaseLock(); }
}
export async function rateLimit(request: Request, area: string, limit: number, seconds: number, userId?: string) {
  // Netlify supplies this header; never trust a client-provided X-Forwarded-For.
  const identity = userId ?? request.headers.get("x-nf-client-connection-ip") ?? "unknown-public-client";
  const hash = createHmac("sha256", serverEnv.supabaseServiceRoleKey).update(`${area}:${identity}`).digest("hex");
  return billingRpc<boolean>("revflow_rate_limit", { p_key: hash, p_limit: limit, p_seconds: seconds });
}
