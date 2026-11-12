require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "./auth") return { resolveShopifyToken: async () => "test-token" };
  return load.call(this, request, ...rest);
};
const { readLiveSnapshot } = require("../src/lib/shopify/live-activity.ts");
Module._load = load;

const row = { sessions_with_cart_additions: "3", sessions_that_reached_checkout: 2, sessions_that_completed_checkout: "0" };
const table = rows => ({ data: { shopifyqlQuery: { tableData: { rows }, parseErrors: [] } } });
const connection = id => ({ id, shop_domain: "example.myshopify.com", updated_at: "2026-11-12" });

test("one report per connection counts three session stages across the same rolling ten minutes", async t => {
  const fetch = t.mock.method(global, "fetch", async (_url, init) => {
    const { report, filter } = JSON.parse(init.body).variables;
    if (filter) {
      assert.match(filter, /test:false -status:cancelled processed_at:>=/);
      return Response.json({ data: { orders: { nodes: [] } } });
    }
    assert.match(report, /SINCE -10min UNTIL now$/);
    return Response.json(table([row]));
  });
  const [first, second] = await Promise.all([readLiveSnapshot(connection("a")), readLiveSnapshot(connection("a"))]);
  assert.deepEqual(second, first);
  const { reading, activity } = first;
  assert.equal(activity, "inactive");
  assert.deepEqual([reading.status, reading.carts, reading.checkouts, reading.purchases], ["ok", 3, 2, 0]);
  assert.ok(Number.isFinite(Date.parse(reading.readAt)));
  assert.equal(fetch.mock.callCount(), 2);
  await readLiveSnapshot(connection("b"));
  assert.equal(fetch.mock.callCount(), 4);
});

test("a missing report, a denied scope and malformed counts cannot become zero sales", async t => {
  const cases = [
    [table([]), "unavailable"],
    [table([{ ...row, sessions_that_completed_checkout: null }]), "unavailable"],
    [table([{ ...row, sessions_with_cart_additions: "" }]), "unavailable"],
    [{ errors: [{ extensions: { code: "ACCESS_DENIED" } }] }, "denied"],
    [{ data: { shopifyqlQuery: { parseErrors: ["invalid"], tableData: { rows: [row] } } } }, "unavailable"],
  ];
  const fetch = t.mock.method(global, "fetch");
  for (const [i, [payload, status]] of cases.entries()) {
    fetch.mock.mockImplementation(async () => Response.json(payload));
    assert.deepEqual((await readLiveSnapshot(connection(`error-${i}`))).reading, { status });
  }
});

test("recent sales come directly from Shopify even when the funnel is unavailable or the order has not synced", async t => {
  const now = new Date("2026-11-12T09:45:00Z");
  t.mock.timers.enable({ apis: ["Date"], now });
  const cutoff = "2026-11-09T09:45:00.000Z";
  const sale = { processedAt: cutoff, test: false, cancelledAt: null };
  const cases = [
    [[sale], "active"], [[], "inactive"], [[{ ...sale, processedAt: "2026-11-09T09:44:59.999Z" }], "inactive"],
    [[{ ...sale, test: true }], "unknown"], [[{ ...sale, cancelledAt: now.toISOString() }], "unknown"], [null, "unknown"],
  ];
  const fetch = t.mock.method(global, "fetch");
  for (const [i, [nodes, expected]] of cases.entries()) {
    fetch.mock.mockImplementation(async (_url, init) => {
      const { filter } = JSON.parse(init.body).variables;
      if (!filter) return new Response(null, { status: 403 });
      assert.equal(filter, `test:false -status:cancelled processed_at:>='${cutoff}' processed_at:<='${now.toISOString()}'`);
      return Response.json({ data: { orders: { nodes } } });
    });
    assert.deepEqual(await readLiveSnapshot(connection(`order-${i}`)), { reading: { status: "denied" }, activity: expected });
  }
});
