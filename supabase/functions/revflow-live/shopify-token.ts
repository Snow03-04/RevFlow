import type { LiveConnection } from "../_shared/live-snapshot.ts";

function bytes(hex: string) {
  if (!/^(?:[a-f\d]{2})+$/i.test(hex)) throw new Error("Invalid encrypted value");
  return Uint8Array.from(hex.match(/../g)!, pair => parseInt(pair, 16));
}

export function createTokenResolver(keyHex: string) {
  const key = crypto.subtle.importKey("raw", bytes(keyHex), "AES-GCM", false, ["decrypt"]);
  const cache = new Map<string, { version: string; token: string; expires: number }>();
  return async function resolveToken(store: LiveConnection) {
    const cached = cache.get(store.id);
    if (cached && cached.version === store.updated_at && cached.expires > Date.now()) return cached.token;
    const [iv, tag, ciphertext] = store.access_token.split(":");
    const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: bytes(iv) }, await key, bytes(ciphertext + tag));
    const secret = new TextDecoder().decode(plain);
    if (store.auth_type !== "client_credentials") return secret;
    if (!store.client_id) throw new Error("Missing Shopify client ID");
    const res = await fetch(`https://${store.shop_domain}/admin/oauth/access_token`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(8_000),
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ grant_type: "client_credentials", client_id: store.client_id, client_secret: secret }),
    });
    if (!res.ok) throw new Error("Shopify token unavailable");
    const { access_token: token, expires_in: seconds } = await res.json();
    if (typeof token !== "string" || !token) throw new Error("Missing Shopify token");
    if (Number.isFinite(seconds) && seconds > 60) {
      cache.set(store.id, { token, version: store.updated_at, expires: Date.now() + (seconds - 60) * 1000 });
    }
    return token;
  };
}
