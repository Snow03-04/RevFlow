require("../scripts/register-ts.cjs");
const { test } = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const load = Module._load;
Module._load = function (request, ...rest) {
  if (request === "./auth") return { resolveShopifyToken: async () => "test-token" };
  return load.call(this, request, ...rest);
};
const { readLiveActivity } = require("../src/lib/shopify/live-activity.ts");
Module._load = load;

const row = { sessions_with_cart_additions: "3", sessions_that_reached_checkout: 2, sessions_that_completed_checkout: "0" };
const table = rows => ({ data: { shopifyqlQuery: { tableData: { rows }, parseErrors: [] } } });
const connection = id => ({ id, shop_domain: "example.myshopify.com", updated_at: "2026-11-12" });

test("one report per connection counts three session stages across the same rolling ten minutes", async t => {
  const fetch = t.mock.method(global, "fetch", async (_url, init) => {
    const { report } = JSON.parse(init.body).variables;
    assert.match(report, /SINCE -10min UNTIL now$/);
    return Response.json(table([row]));
  });
  const [first, second] = await Promise.all([readLiveActivity(connection("a")), readLiveActivity(connection("a"))]);
  assert.deepEqual(second, first);
  assert.deepEqual([first.status, first.carts, first.checkouts, first.purchases], ["ok", 3, 2, 0]);
  assert.ok(Number.isFinite(Date.parse(first.readAt)));
  assert.equal(fetch.mock.callCount(), 1);
  await readLiveActivity(connection("b"));
  assert.equal(fetch.mock.callCount(), 2);
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
    assert.deepEqual(await readLiveActivity(connection(`error-${i}`)), { status });
  }
});
