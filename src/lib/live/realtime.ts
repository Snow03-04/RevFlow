import "server-only";
import { createHmac } from "node:crypto";
import { clientEnv, serverEnv } from "@/lib/env";

/**
 * Realtime topic of one account's live view.
 *
 * Supabase Realtime broadcast channels are joined by name with the public anon
 * key, so the name itself is the capability: it is derived from a server
 * secret, handed only to the signed-in owner (see /api/live/globe) and never
 * guessable from a user id. Messages carry no customer data.
 */
export function liveTopic(userId: string): string {
  return `live-${createHmac("sha256", serverEnv.cronSecret).update(`revflow:live:${userId}`).digest("hex").slice(0, 40)}`;
}

/**
 * Push one event to every open live view of an account. Sent over Realtime's
 * HTTP endpoint: a serverless function cannot hold a socket open.
 *
 * Best-effort by design. The order is already stored when this runs, so a view
 * that misses the push still gets it on its next state read.
 */
export async function broadcastLive(userId: string, event: "order" | "update" | "cancel", payload: unknown): Promise<boolean> {
  try {
    const key = serverEnv.supabaseServiceRoleKey;
    const response = await fetch(`${clientEnv.supabaseUrl}/realtime/v1/api/broadcast`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(2_500),
      headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messages: [{ topic: liveTopic(userId), event, payload }] }),
    });
    return response.ok;
  } catch {
    return false;
  }
}
