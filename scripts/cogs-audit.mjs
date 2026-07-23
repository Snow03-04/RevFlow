// Read-only audit of the stored COGS, to find the value that's blowing up the
// profit. Lists manual product costs, quantity tiers and collection costs from
// the biggest down — the wrong (e.g. mis-typed) value shows at the top.
//
// Run:  node --env-file=.env.local scripts/cogs-audit.mjs
// Needs (already in .env.local): NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

import { createClient } from "@supabase/supabase-js";

const url =
  process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "✗ Falta NEXT_PUBLIC_SUPABASE_URL e/ou SUPABASE_SERVICE_ROLE_KEY no .env.local",
  );
  process.exit(1);
}
const db = createClient(url, key, { auth: { persistSession: false } });

const n = (v) => Number(v).toFixed(2).padStart(12);

async function safe(run, label) {
  try {
    const { data, error } = await run();
    if (error) {
      console.log(`  (${label}: ${error.message})`);
      return [];
    }
    return data ?? [];
  } catch (e) {
    console.log(`  (${label}: ${e.message})`);
    return [];
  }
}

// Map product id -> a readable title from the order line items (works even when
// the store has no product catalogue synced).
const { data: liTitles } = await db
  .from("order_line_items")
  .select("shopify_product_id, title")
  .not("shopify_product_id", "is", null)
  .limit(5000);
const titleOf = new Map();
for (const li of liTitles ?? [])
  if (!titleOf.has(li.shopify_product_id))
    titleOf.set(li.shopify_product_id, li.title);
const name = (pid) => (titleOf.get(pid) ?? "?").slice(0, 40);

console.log("\n=== default_product_cost_pct (fallback) por utilizador ===");
const settings = await safe(
  () => db.from("settings").select("user_id, currency, default_product_cost_pct"),
  "settings",
);
for (const s of settings)
  console.log(`  ${s.default_product_cost_pct}%   display ${s.currency}   user ${s.user_id.slice(0, 8)}`);

console.log("\n=== TOP 25 custos manuais (product_costs) — MAIOR primeiro ===");
const costs = await safe(
  () =>
    db
      .from("product_costs")
      .select("shopify_product_id, cost, currency, effective_from")
      .order("cost", { ascending: false })
      .limit(25),
  "product_costs",
);
for (const c of costs)
  console.log(
    `  ${n(c.cost)} ${c.currency ?? "base"}  desde ${c.effective_from}  ${c.shopify_product_id}  ${name(c.shopify_product_id)}`,
  );

console.log("\n=== TOP 15 tiers (product_cost_tiers) — total por quantidade ===");
const tiers = await safe(
  () =>
    db
      .from("product_cost_tiers")
      .select("shopify_product_id, min_qty, total_cost, currency")
      .order("total_cost", { ascending: false })
      .limit(15),
  "product_cost_tiers",
);
for (const t of tiers)
  console.log(
    `  ${n(t.total_cost)} ${t.currency ?? "base"}  para ${t.min_qty}un  ${name(t.shopify_product_id)}`,
  );

console.log("\n=== TOP 15 coleções (cogs_collections) — custo base/un ===");
const cols = await safe(
  () =>
    db
      .from("cogs_collections")
      .select("name, base_unit_cost, currency")
      .order("base_unit_cost", { ascending: false })
      .limit(15),
  "cogs_collections",
);
for (const c of cols)
  console.log(`  ${n(c.base_unit_cost)} ${c.currency ?? "base"}  ${c.name}`);

console.log("\nSe o valor no topo de 'product_costs' estiver absurdo (ex.: 6442),");
console.log("é esse. Corrige-o na página Custos e o lucro recalcula.\n");
