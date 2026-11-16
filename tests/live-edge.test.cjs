require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const { createHandler } = require("../supabase/functions/revflow-live/handler.ts");
const { createCipheriv, randomBytes } = require("node:crypto");
const { createTokenResolver } = require("../supabase/functions/revflow-live/shopify-token.ts");

const base = "https://example.supabase.co";
const key = randomBytes(32);
const users = ["account-a", "account-b", "new-account"];
const handle = createHandler(base, "public-key", key.toString("hex"));
const request = () => new Request(base + "/functions/v1/revflow-live?user_id=another-user", { headers: { authorization: "Bearer test-caller" } });

test("preflight, anonymous and unsupported methods never reach Shopify or Postgres", async () => {
  const preflight = await handle(new Request(base, { method: "OPTIONS" }));
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get("access-control-allow-headers"), /authorization/);
  assert.equal((await handle(new Request(base))).status, 401);
  assert.equal((await handle(new Request(base, { method: "POST" }))).status, 405);
});

test("existing and new accounts can read only their own authorized connections", async t => {
  let userId, subscribed = true, valid = true, queries = 0;
  t.mock.method(global, "fetch", async (url, init) => {
    const target = new URL(url);
    assert.equal(target.origin, base);
    assert.equal(init.headers.Authorization, "Bearer test-caller");
    assert.equal(init.headers.apikey, "public-key");
    if (target.pathname === "/auth/v1/user") return Response.json({ id: userId }, { status: valid ? 200 : 401 });
    if (target.pathname === "/rest/v1/rpc/revflow_my_access") return Response.json({ has_access: subscribed });
    assert.equal(target.pathname, "/rest/v1/shopify_connections");
    assert.equal(target.searchParams.get("user_id"), "eq." + userId);
    queries++;
    return Response.json([{ id: userId + "-shop", shop_domain: "invalid.example", shop_name: "Test store", access_token: "never sent" }]);
  });
  for (userId of users) {
    const response = await handle(request());
    assert.equal(response.status, 200);
    const { stores } = await response.json();
    assert.deepEqual(stores, [{ id: userId + "-shop", domain: "invalid.example", name: "Test store", activity: "unknown", reading: { status: "unavailable" } }]);
  }
  subscribed = false;
  assert.equal((await handle(request())).status, 402);
  valid = false;
  assert.equal((await handle(request())).status, 401);
  assert.equal(queries, users.length);
});

test("Edge decrypts the existing Shopify credentials and refreshes rotated installations", async t => {
  function encrypt(value) {
    const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv);
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    return [iv, cipher.getAuthTag(), ciphertext].map(buf => buf.toString("hex")).join(":");
  }
  const store = { id: "shop", updated_at: "1", shop_domain: "example.myshopify.com", client_id: "client", access_token: encrypt("credential") };
  const resolve = createTokenResolver(key.toString("hex"));
  assert.equal(await resolve(store), "credential");
  const mock = t.mock.method(global, "fetch", async (url, init) => {
    assert.equal(url, "https://example.myshopify.com/admin/oauth/access_token");
    assert.equal(JSON.parse(init.body).client_secret, "credential");
    return Response.json({ access_token: "exchanged", expires_in: 3600 });
  });
  store.auth_type = "client_credentials";
  assert.equal(await resolve(store), "exchanged");
  assert.equal(await resolve(store), "exchanged");
  store.updated_at = "2";
  assert.equal(await resolve(store), "exchanged");
  assert.equal(mock.mock.callCount(), 2);
});
