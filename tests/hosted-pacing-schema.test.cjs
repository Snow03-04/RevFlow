const test = require("node:test"), assert = require("node:assert/strict"), vm = require("node:vm");
const { z } = require("zod");
const { patchHostedPacing } = require("../scripts/patch-hosted-pacing.cjs");
const original = `// unrelated collector stays intact
var ScriptBudget = external_exports.object({
  date: external_exports.string().date(),
  observedAt: external_exports.string().datetime(),
  timeZone: external_exports.string().min(1).max(100),
  budget: external_exports.number().finite().nonnegative().nullable(),
  spent: external_exports.number().finite().nonnegative()
});
// unrelated worker stays intact`;
test("hosted collector preserves first-day fields without dropping legacy reports", () => {
  const code = patchHostedPacing(original);
  const schema = vm.runInNewContext(code + "\n;ScriptBudget", { external_exports: z });
  const legacy = { date: "2026-11-25", observedAt: "2026-11-25T12:00:00Z", timeZone: "Europe/Lisbon", budget: 100, spent: 45 };
  assert.deepEqual(schema.parse(legacy), legacy);
  const enriched = { ...legacy, forecast: 200, firstDayExtra: 100 };
  assert.deepEqual(schema.parse(enriched), enriched);
  assert.equal(schema.safeParse({ ...enriched, forecast: -1 }).success, false);
  assert.equal(schema.safeParse({ ...enriched, firstDayExtra: "100" }).success, false);
  assert.equal(schema.parse({ ...legacy, forecast: null }).forecast, null);
  assert.equal(patchHostedPacing(code), code);
  assert.ok(code.startsWith("// unrelated collector stays intact"));
  assert.ok(code.endsWith("// unrelated worker stays intact"));
  assert.throws(() => patchHostedPacing("unknown deployment"));
});
