process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test";
process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
process.env.CRON_SECRET = "cron-secret";
process.env.SHOPIFY_API_KEY = "shared-key";
process.env.SHOPIFY_API_SECRET = "shared-secret";
require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const Module = require("node:module");

const realSync = require("../src/lib/shopify/sync.ts");
const realCrypto = require("../src/lib/crypto.ts");
const { liveTopic } = require("../src/lib/live/realtime.ts");

// ---- what the receiver touches, replaced by recorders
let connections = [], upserts = [], updates = [], recomputes = [], refetched = [], failUpsert = false, storedOrder = null;
const settings = { currency: "EUR", timezone: "Europe/Lisbon", fx_rate_override: null, fx_override_currency: null };
const admin = {
  from(table) {
    if (table === "shopify_connections") return {
      select: columns => ({ eq: async (_column, domain) => { assert.equal(columns, "*"); return { data: connections.filter(c => c.shop_domain === domain), error: null }; } }),
      update: values => ({ in: async (_column, ids) => { updates.push({ values, ids }); return { error: null }; } }),
    };
    if (table === "orders") return { select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: storedOrder, error: null }) }) }) }) };
    if (table === "settings") return { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: settings, error: null }) }) }) };
    throw new Error(`unexpected table ${table}`);
  },
};
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "@/lib/supabase/admin") return { createAdminClient: () => admin };
  if (request === "@/lib/crypto") return { ...realCrypto, decryptToken: value => value.replace(/^enc:/, "") };
  if (request === "@/lib/shopify/auth") return { resolveShopifyToken: async () => "shop-token" };
  if (request === "@/lib/shopify/client") return { shopifyGet: async (_shop, _token, path) => { refetched.push(path); return { data: { order: order({ id: 9001, refunds: [{ id: 77 }] }) } }; } };
  if (request === "@/lib/metrics") return { recomputeDailyMetrics: async (_db, userId, range) => { recomputes.push([userId, range]); return 1; } };
  if (request === "@/lib/fx") return { resolveFx: async (from, to) => (String(from).toUpperCase() === String(to).toUpperCase() ? 1 : 0.04) };
  if (request === "@/lib/shopify/sync") return { ...realSync, buildVariantCostMap: async () => new Map(),
    upsertOrder: async (ctx, order) => { if (failUpsert) throw new Error("database unavailable"); upserts.push({ userId: ctx.userId, connectionId: ctx.connectionId, hasToken: "token" in ctx, id: order.id }); } };
  return load.call(this, request, ...rest);
};
const { POST } = require("../src/app/api/shopify/webhooks/route.ts");
Module._load = load;

const store = (overrides = {}) => ({ id: "store-1", user_id: "user-1", shop_domain: "shop.myshopify.com", access_token: "enc:store-secret",
  auth_type: "client_credentials", client_id: "client", status: "active", reporting_base_currency: "CZK", ...overrides });
const order = (overrides = {}) => ({
  id: 9001, name: "#SHOP1001", created_at: "2026-11-24T19:49:40Z", processed_at: "2026-11-24T19:49:40Z", total_price: "2847.00", currency: "CZK",
  financial_status: "paid", test: false, email: "buyer@example.com",
  shipping_address: { city: "  Praha ", country_code: "cz", address1: "Dlouhá 12", zip: "110 00", latitude: 50.0969921, longitude: 14.363364, name: "Jana Nováková" },
  line_items: [{ id: 1, title: "Křídla ve větru", quantity: 1, variant_id: 11 }, { id: 2, title: "Druhý", quantity: 2, variant_id: 12 }],
  ...overrides,
});
const deliver = (body, { topic = "orders/create", secret = "store-secret", domain = "shop.myshopify.com" } = {}) => {
  const raw = JSON.stringify(body);
  return POST(new Request("http://localhost:3000/api/shopify/webhooks", { method: "POST", body: raw, headers: {
    "x-shopify-hmac-sha256": crypto.createHmac("sha256", secret).update(raw, "utf8").digest("base64"),
    "x-shopify-topic": topic, "x-shopify-shop-domain": domain,
  } }));
};
/** Run one delivery and return what it pushed to Realtime. */
async function run(t, body, options) {
  upserts = []; updates = []; recomputes = []; refetched = [];
  const pushed = [];
  t.mock.method(global, "fetch", async (url, init) => {
    assert.equal(String(url), "https://test.invalid/realtime/v1/api/broadcast");
    assert.equal(init.headers.Authorization, "Bearer service-key");
    pushed.push(...JSON.parse(init.body).messages);
    return new Response(null, { status: 202 });
  });
  const response = await deliver(body, options);
  return { response, pushed };
}

test("the live summary keeps a town and rounded coordinates, never the address or the buyer", () => {
  assert.deepEqual(realSync.liveSummary(order()), { city: "Praha", lat: 50.1, lng: 14.36, item: "Křídla ve větru", lines: 2 });
  assert.deepEqual(realSync.liveSummary({ billing_address: { city: "Lyon" }, line_items: [] }), { city: "Lyon", lat: null, lng: null, item: null, lines: 0 });
  // Half a coordinate is no coordinate: the globe falls back to the country.
  assert.deepEqual(realSync.liveSummary({ shipping_address: { city: "", latitude: "61.47", longitude: null } }), { city: null, lat: null, lng: null, item: null, lines: 0 });
  const raw = realSync.mapOrder("user-1", "store-1", order()).raw;
  assert.deepEqual(raw.live, { city: "Praha", lat: 50.1, lng: 14.36, item: "Křídla ve větru", lines: 2 });
  assert.deepEqual(Object.keys(raw).sort(), ["live", "payment_gateway_names", "updated_at"]);
  assert.doesNotMatch(JSON.stringify(raw), /Dlouh|Nov[aá]kov|buyer@|110 00/);
});

test("an account's live topic is stable, unguessable from its id and unique", () => {
  const topic = liveTopic("user-1");
  assert.match(topic, /^live-[0-9a-f]{40}$/);
  assert.equal(liveTopic("user-1"), topic);
  assert.notEqual(liveTopic("user-2"), topic);
  assert.ok(!topic.includes("user-1"));
});

test("a signed order is stored from the delivery itself and pushed to the owner's live views", async t => {
  connections = [store()];
  const { response, pushed } = await run(t, order());
  assert.equal(response.status, 200);
  // Stored without a Shopify token: nothing is fetched back from Shopify.
  assert.deepEqual(upserts, [{ userId: "user-1", connectionId: "store-1", hasToken: false, id: 9001 }]);
  // Nor are the day's totals recalculated on every sale: the next refresh repairs that day.
  assert.deepEqual(recomputes, []);
  assert.equal(pushed.length, 1);
  assert.equal(pushed[0].topic, liveTopic("user-1"));
  assert.equal(pushed[0].event, "order");
  assert.deepEqual(pushed[0].payload, { id: "store-1:9001", store: "store-1", num: "#SHOP1001", ts: Date.parse("2026-11-24T19:49:40Z"),
    total: 2847, cur: "CZK", amount: 113.88, city: "Praha", cc: "CZ", lat: 50.1, lng: 14.36, title: "Křídla ve větru", more: 1 });
});

test("a delivery no connected store signed is refused and changes nothing", async t => {
  connections = [store()];
  for (const options of [{ secret: "someone-else" }, { domain: "other.myshopify.com" }]) {
    const { response, pushed } = await run(t, order(), options);
    assert.equal(response.status, 401);
    assert.deepEqual(upserts, []);
    assert.deepEqual(pushed, []);
  }
});

test("the same shop connected by two accounts reaches only the account whose app signed", async t => {
  connections = [store(), store({ id: "store-2", user_id: "user-2", access_token: "enc:other-secret" })];
  const { response, pushed } = await run(t, order(), { secret: "other-secret" });
  assert.equal(response.status, 200);
  assert.deepEqual(upserts.map(u => u.userId), ["user-2"]);
  assert.deepEqual(pushed.map(m => m.topic), [liveTopic("user-2")]);
});

test("payment and cancellation update the stored order; only a cancellation is announced", async t => {
  connections = [store()];
  const paid = await run(t, order(), { topic: "orders/paid" });
  assert.equal(paid.response.status, 200);
  assert.equal(upserts.length, 1);
  assert.deepEqual(paid.pushed, []);
  const cancelled = await run(t, order({ cancelled_at: "2026-11-24T20:00:00Z" }), { topic: "orders/cancelled" });
  assert.equal(upserts.length, 1);
  assert.deepEqual(cancelled.pushed.map(m => [m.event, m.payload]), [["cancel", { id: "store-1:9001" }]]);
});

test("a part-paid order is announced but left for the import, which reads its payment breakdown", async t => {
  connections = [store()];
  const { response, pushed } = await run(t, order({ financial_status: "partially_paid" }));
  assert.equal(response.status, 200);
  assert.deepEqual(upserts, []);
  assert.equal(pushed.length, 1);
});

test("a Shopify test order is stored and shown as a rehearsal, never as a sale", async t => {
  connections = [store()];
  const { pushed } = await run(t, order({ test: true }));
  assert.equal(upserts.length, 1);
  assert.equal(pushed[0].payload.test, true);
  const cancelled = await run(t, order({ test: true }), { topic: "orders/cancelled" });
  assert.deepEqual(cancelled.pushed, []);
});

test("an order that could not be stored asks Shopify to deliver again and is not announced", async t => {
  connections = [store()];
  failUpsert = true;
  t.after(() => { failUpsert = false; });
  const { response, pushed } = await run(t, order());
  assert.equal(response.status, 503);
  assert.deepEqual(pushed, []);
});

test("a revoked connection still verifies but stores nothing; refunds are left to the import", async t => {
  connections = [store({ status: "revoked" })];
  const revoked = await run(t, order());
  assert.equal(revoked.response.status, 200);
  assert.deepEqual(upserts, []);
  assert.deepEqual(revoked.pushed, []);
  connections = [store()];
  const refund = await run(t, { id: 77, order_id: 9001 }, { topic: "refunds/create" });
  assert.equal(refund.response.status, 200);
  assert.deepEqual(upserts, []);
  const gone = await run(t, {}, { topic: "app/uninstalled" });
  assert.equal(gone.response.status, 200);
  assert.deepEqual(updates, [{ values: { status: "revoked" }, ids: ["store-1"] }]);
});

test("a failed push never fails the delivery: the order is already stored", async t => {
  connections = [store()];
  upserts = [];
  t.mock.method(global, "fetch", async () => { throw new Error("realtime down"); });
  const response = await deliver(order());
  assert.equal(response.status, 200);
  assert.equal(upserts.length, 1);
});

test("a store on the shared OAuth app keeps its behaviour and is announced too", async t => {
  connections = [store({ auth_type: "oauth", client_id: null, access_token: "enc:shop-token" })];
  const created = await run(t, order(), { secret: "shared-secret" });
  assert.equal(created.response.status, 200);
  assert.deepEqual(upserts, [{ userId: "user-1", connectionId: "store-1", hasToken: true, id: 9001 }]);
  assert.deepEqual(recomputes, [["user-1", { from: "2026-11-24", to: "2026-11-24" }]]);
  assert.deepEqual(created.pushed.map(m => m.event), ["order"]);
  // A refund re-reads the order, stores it and recalculates its day; nothing new lands on the globe.
  const refund = await run(t, { id: 77, order_id: 9001 }, { topic: "refunds/create", secret: "shared-secret" });
  assert.deepEqual(refetched, ["orders/9001"]);
  assert.equal(upserts.length, 1);
  assert.equal(recomputes.length, 1);
  assert.deepEqual(refund.pushed, []);
  // The custom app's secret does not sign for it, and the other way round.
  assert.equal((await run(t, order(), { secret: "store-secret" })).response.status, 401);
});

test("an update that changes nothing a sale depends on is dropped after one read", async t => {
  connections = [store()];
  storedOrder = { total_price: 2847, total_refunded: 0, financial_status: "paid", cancelled_at: null };
  t.after(() => { storedOrder = null; });
  // A fulfilment, a tag, a note: the same order document with the same money.
  const { response, pushed } = await run(t, order({ fulfillment_status: "fulfilled", tags: "enviado" }), { topic: "orders/updated" });
  assert.equal(response.status, 200);
  assert.deepEqual(upserts, []);
  assert.deepEqual(pushed, []);
});

test("a post-purchase upsell is stored and sent again with what the order is worth now", async t => {
  connections = [store()];
  storedOrder = { total_price: 2847, total_refunded: 0, financial_status: "paid", cancelled_at: null };
  t.after(() => { storedOrder = null; });
  const grown = order({ total_price: "3630.20", line_items: [...order().line_items, { id: 3, title: "Upsell", quantity: 1, variant_id: 13 }] });
  const { response, pushed } = await run(t, grown, { topic: "orders/updated" });
  assert.equal(response.status, 200);
  assert.equal(upserts.length, 1);
  assert.deepEqual(pushed.map(m => [m.event, m.payload.id, m.payload.total, m.payload.amount, m.payload.more]), [["update", "store-1:9001", 3630.2, 145.21, 2]]);
  // A refund or a cancellation arriving as an update is stored too; a cancellation leaves the globe.
  storedOrder = { total_price: 3630.2, total_refunded: 0, financial_status: "paid", cancelled_at: null };
  const cancelled = await run(t, order({ total_price: "3630.20", cancelled_at: "2026-11-24T21:00:00Z" }), { topic: "orders/updated" });
  assert.equal(upserts.length, 1);
  assert.deepEqual(cancelled.pushed.map(m => m.event), ["cancel"]);
  // An update for an order that was never stored (its creation was missed) stores it.
  storedOrder = null;
  const missed = await run(t, order(), { topic: "orders/updated" });
  assert.equal(upserts.length, 1);
  assert.deepEqual(missed.pushed.map(m => m.event), ["update"]);
});
