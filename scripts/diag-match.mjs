// Testa o matching campanha→produto e o COG que iria para a tabela ROAS.
// Correr com:  node scripts/diag-match.mjs
import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4);

function buildMatcher(products) {
  const items = products.map((p) => ({
    tokens: new Set(tokenize(p.title ?? "")), price: Number(p.price), cog: p.cost != null ? Number(p.cost) : 0,
    title: p.title,
  })).filter((it) => it.tokens.size > 0);
  return (name) => {
    const camp = new Set(tokenize(name));
    if (camp.size === 0) return null;
    let best = null, bestKey = [0, 0, 0];
    for (const it of items) {
      let shared = 0, longest = 0;
      for (const t of it.tokens) if (camp.has(t)) { shared++; if (t.length > longest) longest = t.length; }
      if (shared === 0) continue;
      const key = [shared, it.cog > 0 ? 1 : 0, longest];
      if (key[0] > bestKey[0] || (key[0] === bestKey[0] && key[1] > bestKey[1]) ||
          (key[0] === bestKey[0] && key[1] === bestKey[1] && key[2] > bestKey[2])) { best = it; bestKey = key; }
    }
    return best;
  };
}

async function fx(base, quote) {
  if (!base || !quote || base === quote) return 1;
  const r = await fetch(`https://api.frankfurter.app/latest?from=${base}&to=${quote}`).then((x) => x.json());
  return r?.rates?.[quote] ?? 1;
}

const { data: users } = await sb.from("settings").select("user_id, currency");
for (const u of users ?? []) {
  const userId = u.user_id;
  const { data: roas } = await sb.from("roas_entries").select("campaign_name, cog, day").eq("user_id", userId);
  if (!roas || roas.length === 0) continue;

  const [{ data: products }, { data: li }, { data: manual }, { data: store }] = await Promise.all([
    sb.from("products").select("shopify_product_id, title, price, cost").eq("user_id", userId),
    sb.from("order_line_items").select("shopify_product_id, title, price").eq("user_id", userId),
    sb.from("product_costs").select("shopify_product_id, cost").eq("user_id", userId),
    sb.from("orders").select("currency").eq("user_id", userId).not("currency", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle(),
  ]);
  const storeCur = store?.currency ?? "EUR";
  const fxStoreToEur = await fx(storeCur, "EUR");

  const byProduct = new Map();
  for (const p of products ?? []) if (p.shopify_product_id) byProduct.set(p.shopify_product_id, { title: p.title, price: Number(p.price), cost: p.cost != null ? Number(p.cost) : null });
  for (const x of li ?? []) { if (!x.shopify_product_id) continue; const ex = byProduct.get(x.shopify_product_id); if (!ex) byProduct.set(x.shopify_product_id, { title: x.title, price: Number(x.price), cost: null }); else if (!ex.title && x.title) ex.title = x.title; }
  for (const m of manual ?? []) { const ex = byProduct.get(m.shopify_product_id); if (ex) ex.cost = Number(m.cost); else byProduct.set(m.shopify_product_id, { title: null, price: 0, cost: Number(m.cost) }); }

  const match = buildMatcher([...byProduct.values()]);

  console.log("═".repeat(70));
  console.log(`Utilizador ${userId}  | loja=${storeCur}  | custos manuais definidos: ${(manual ?? []).length}`);
  console.log(`Produtos para matching (catálogo+vendidos): ${byProduct.size}`);
  console.log("─".repeat(70));
  const seen = new Set();
  for (const r of roas) {
    if (seen.has(r.campaign_name)) continue; seen.add(r.campaign_name);
    const m = match(r.campaign_name);
    const cogEur = m && m.cog > 0 ? (m.cog * fxStoreToEur).toFixed(2) : "—";
    console.log(`  "${(r.campaign_name ?? "").slice(0, 38).padEnd(38)}" → ${m ? `[${(m.title ?? "?").slice(0, 28)}]  COG=${cogEur}€` : "SEM MATCH"}   (atual na tabela: ${r.cog})`);
  }
}
process.exit(0);
