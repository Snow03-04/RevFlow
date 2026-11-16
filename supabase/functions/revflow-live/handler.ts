import { createLiveReader, type LiveConnection } from "../_shared/live-snapshot.ts";
import { createTokenResolver } from "./shopify-token.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Cache-Control": "private, no-store",
};
const reply = (data: unknown, status = 200) => Response.json(data, { status, headers });

export function createHandler(url: string, anonKey: string, encryptionKey: string) {
  const snapshot = createLiveReader(createTokenResolver(encryptionKey));
  return async function handle(request: Request) {
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
    if (request.method !== "GET") return reply({ error: "Method not allowed" }, 405);
    const authorization = request.headers.get("authorization");
    if (!authorization?.startsWith("Bearer ")) return reply({ error: "Authentication required" }, 401);
    // Auth and PostgREST receive the caller's JWT. Store access remains subject to RLS.
    const caller = { apikey: anonKey, Authorization: authorization };
    try {
      const auth = await fetch(url + "/auth/v1/user", { headers: caller, signal: AbortSignal.timeout(5000) });
      if (!auth.ok) return reply({ error: "Unable to verify session" }, [401, 403].includes(auth.status) ? 401 : 503);
      const { id } = await auth.json();
      if (typeof id !== "string" || !id) return reply({ error: "Invalid session" }, 401);
      const access = await fetch(url + "/rest/v1/rpc/revflow_my_access", {
        method: "POST", headers: { ...caller, "Content-Type": "application/json" }, body: "{}", signal: AbortSignal.timeout(5000),
      });
      if (!access.ok) return reply({ error: "Account service unavailable" }, 503);
      if (!(await access.json())?.has_access) return reply({ error: "Subscription required" }, 402);
      const list = new URL("/rest/v1/shopify_connections", url);
      list.search = new URLSearchParams({
        select: "id,shop_name,shop_domain,auth_type,client_id,access_token,updated_at",
        user_id: "eq." + id, status: "in.(active,error)", order: "created_at.asc",
      }).toString();
      const rows = await fetch(list, { headers: caller, signal: AbortSignal.timeout(5000) });
      if (!rows.ok) return reply({ error: "Stores unavailable" }, 503);
      const stores: (LiveConnection & { shop_name: string | null })[] = await rows.json();
      return reply({ stores: await Promise.all(stores.map(async store => ({
        id: store.id, name: store.shop_name?.trim() || store.shop_domain.replace(/\.myshopify\.com$/i, ""),
        domain: store.shop_domain, ...await snapshot(store),
      }))) });
    } catch {
      return reply({ error: "Live temporarily unavailable" }, 503);
    }
  };
}
