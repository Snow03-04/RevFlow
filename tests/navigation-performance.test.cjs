process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { getStoreFxRates, getShopifyConnections, getSettings } = require("../src/lib/queries.ts");
const { getPnlYearOverrides, getPnlYear } = require("../src/lib/trackers/queries.ts");

test("currency reads run concurrently, preserve store order and never mix other users", async () => {
  const base = memoryDb({
    shopify_connections: [
      { id: "a", user_id: "u", created_at: "2020-01-01" },
      { id: "b", user_id: "u", created_at: "2020-02-01" },
      { id: "c", user_id: "u", created_at: "2020-03-01" },
      { id: "private", user_id: "other", created_at: "2020-04-01" },
    ],
    orders: [
      { user_id: "u", shopify_connection_id: "a", currency: "EUR", processed_at: "2026-01-01" },
      { user_id: "u", shopify_connection_id: "b", currency: "HUF", processed_at: "2026-01-01" },
      { user_id: "u", shopify_connection_id: "c", currency: "HUF", processed_at: "2026-01-01" },
      { user_id: "other", shopify_connection_id: "a", currency: "BAD", processed_at: "2027-01-01" },
    ],
  });
  const release = [];
  let allStarted;
  const started = new Promise((resolve) => { allStarted = resolve; });
  const db = { from(table) {
    const q = base.from(table);
    if (table !== "orders") return q;
    const resolveQuery = q.then.bind(q);
    q.then = (resolve, reject) => new Promise((ready) => {
      release.push(ready);
      if (release.length === 3) allStarted();
    }).then(() => resolveQuery(resolve, reject));
    return q;
  } };
  const pending = getStoreFxRates(db, "u", "EUR", 400, true);
  let timeout;
  try {
    await Promise.race([started, new Promise((_, reject) => { timeout = setTimeout(() => reject(new Error("currency reads were serial")), 1000); })]);
    release.reverse().forEach((ready) => ready());
    assert.deepEqual([...await pending], [["a", 1], ["b", 0.0025], ["c", 0.0025]]);
  } finally { clearTimeout(timeout); release.forEach((ready) => ready()); }
  assert.deepEqual(base.writes, []);
});

test("shared lookup helpers stay scoped to the user and fresh across calls outside an RSC render", async () => {
  const db = memoryDb({ settings: [{ user_id: "u", currency: "EUR" }, { user_id: "other", currency: "USD" }],
    shopify_connections: [{ id: "a", user_id: "u" }, { id: "b", user_id: "other" }] });
  assert.equal((await getSettings(db, "u")).currency, "EUR");
  assert.deepEqual((await getShopifyConnections(db, "other")).map((s) => s.id), ["b"]);
  db.tables.settings[0].currency = "GBP";
  assert.equal((await getSettings(db, "u")).currency, "GBP");
});

test("platform fees skip consolidated day reads while full P&L still includes them", async () => {
  const db = memoryDb({
    pnl_month_overrides: [{ id: "m", user_id: "u", year: 2026, month: 9, agency_fee_fb: 0 },
      { id: "old", user_id: "u", year: 2025, month: 9 }, { id: "other", user_id: "other", year: 2026, month: 9 }],
    pnl_days: [{ id: "d", user_id: "u", year: 2026, month: 9, day: 1, gross_revenue: 500 }],
  });
  const reads = [];
  const from = db.from.bind(db);
  db.from = (table) => { reads.push(table); return from(table); };
  assert.deepEqual((await getPnlYearOverrides(db, "u", 2026)).map((m) => m.id), ["m"]);
  assert.deepEqual(reads, ["pnl_month_overrides"]);
  const complete = await getPnlYear(db, "u", 2026);
  assert.equal(complete.days[0].gross_revenue, 500);
  assert.equal(complete.overrides[0].agency_fee_fb, 0);
  assert.deepEqual(db.writes, []);
});

test("a failed fee query stays an error instead of showing incorrect zero fees", async () => {
  const error = new Error("database unavailable");
  const db = { from: () => {
    const q = { select: () => q, eq: () => q, then: (resolve) => Promise.resolve({ data: null, error }).then(resolve) };
    return q;
  } };
  await assert.rejects(() => getPnlYearOverrides(db, "u", 2026), /database unavailable/);
});
