process.env.NEXT_PUBLIC_SUPABASE_URL = "https://test.invalid";
process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-only";
require("../scripts/register-ts.cjs");
const test = require("node:test");
const assert = require("node:assert/strict");
const Module = require("node:module");
const { memoryDb } = require("./helpers/memory-db.cjs");
const { historyKey } = require("../src/lib/trackers/lifetime.ts");
const owned = "00000000-0000-4000-8000-000000000001";
const foreign = "00000000-0000-4000-8000-000000000002";
const input = { version: 1, periods: [{ id: "00000000-0000-4000-8000-000000000003", name: "Marca", from: null }] };
let currentDb;
const invalidated = [];
const load = Module._load;
Module._load = function (request, ...args) {
  if (request === "@/lib/supabase/server") return { createClient: async () => currentDb };
  if (request === "next/cache") return { revalidatePath: (path) => invalidated.push(path) };
  return load.call(this, request, ...args);
};
const { saveStoreHistory } = require("../src/lib/trackers/lifetime-actions.ts");
Module._load = load;

function setup({ user = { id: "u" }, saveError = null } = {}) {
  const writes = [];
  currentDb = memoryDb({ shopify_connections: [{ id: owned, user_id: "u" }, { id: foreign, user_id: "someone-else" }] });
  currentDb.auth = {
    getUser: async () => ({ data: { user } }),
    updateUser: async (payload) => { writes.push(payload); return { error: saveError }; },
  };
  invalidated.length = 0;
  return writes;
}

test("history saves only the owned store preference key and invalidates the lifetime page", async () => {
  const writes = setup();
  assert.equal((await saveStoreHistory(owned, input)).ok, true);
  assert.deepEqual(writes, [{ data: { [historyKey(owned)]: input } }]);
  assert.deepEqual(currentDb.writes, []);
  assert.deepEqual(invalidated, ["/finance/desde-sempre"]);
});

test("expired sessions and another user's Shopify cannot write history", async () => {
  let writes = setup({ user: null });
  assert.equal((await saveStoreHistory(owned, input)).ok, false);
  assert.deepEqual(writes, []);
  writes = setup();
  assert.equal((await saveStoreHistory(foreign, input)).ok, false);
  assert.deepEqual(writes, []);
  assert.deepEqual(invalidated, []);
});

test("invalid timelines are rejected before persistence and failed writes never claim success", async () => {
  let writes = setup();
  assert.equal((await saveStoreHistory(owned, { version: 1, periods: [] })).ok, false);
  assert.equal((await saveStoreHistory("bad-id", input)).ok, false);
  assert.deepEqual(writes, []);
  setup({ saveError: { message: "private backend error" } });
  const result = await saveStoreHistory(owned, input);
  assert.equal(result.ok, false);
  assert.doesNotMatch(result.error, /private backend/);
  assert.deepEqual(invalidated, []);
});
