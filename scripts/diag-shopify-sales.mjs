// Compara, por campanha/produto, as compras atribuídas pela Meta vs as
// encomendas/unidades REAIS do Shopify nesse dia.
// Correr com:  node scripts/diag-shopify-sales.mjs [YYYY-MM-DD]
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
const DAY = process.argv[2] || "2026-06-26";
const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const normalize = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const tokenize = (s) => normalize(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 4);
function buildMatcher(products) {
  const items = products.map((p) => ({ id: p.id, title: p.title, tokens: new Set(tokenize(p.title ?? "")), cost: p.cost })).filter((i) => i.tokens.size);
  return (name) => {
    const camp = new Set(tokenize(name)); if (!camp.size) return null;
    let best = null, key = [0, 0, 0];
    for (const it of items) {
      let sh = 0, lg = 0;
      for (const t of it.tokens) if (camp.has(t)) { sh++; if (t.length > lg) lg = t.length; }
      if (!sh) continue;
      const k = [sh, it.cost > 0 ? 1 : 0, lg];
      if (k[0] > key[0] || (k[0] === key[0] && k[1] > key[1]) || (k[0] === key[0] && k[1] === key[1] && k[2] > key[2])) { best = it; key = k; }
    }
    return best;
  };
}
async function selectAll(table, cols, userId, extra) {
  const out = []; let from = 0;
  while (true) {
    let q = sb.from(table).select(cols).eq("user_id", userId).range(from, from + 999);
    if (extra) q = extra(q);
    const { data } = await q; out.push(...(data ?? []));
    if (!data || data.length < 1000) break; from += 1000;
  }
  return out;
}

const ymd = (iso) => new Intl.DateTimeFormat("en-CA", { timeZone: "UTC", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));

const { data: users } = await sb.from("settings").select("user_id");
for (const u of users) {
  const userId = u.user_id;
  const { data: camps } = await sb.from("campaigns").select("campaign_name, purchases, spend").eq("user_id", userId).eq("date", DAY);
  const active = (camps ?? []).filter((c) => Number(c.spend) > 0);
  if (!active.length) continue;

  // produtos (catálogo + custos manuais) para o matcher
  const prods = await selectAll("products", "shopify_product_id, title, cost", userId);
  const manual = await selectAll("product_costs", "shopify_product_id, cost", userId);
  const manualBy = new Map(manual.map((m) => [m.shopify_product_id, Number(m.cost)]));
  const byId = new Map();
  for (const p of prods) if (p.shopify_product_id && !byId.has(p.shopify_product_id)) byId.set(p.shopify_product_id, { id: p.shopify_product_id, title: p.title, cost: p.cost != null ? Number(p.cost) : 0 });
  for (const [id, c] of manualBy) { const e = byId.get(id); if (e) e.cost = c; }
  const match = buildMatcher([...byId.values()]);

  // vendas Shopify nesse dia
  const orders = await selectAll("orders", "id, processed_at, test, cancelled_at", userId);
  const valid = orders.filter((o) => !o.test && !o.cancelled_at && ymd(o.processed_at) === DAY);
  const dayOrderIds = new Set(valid.map((o) => o.id));
  const sales = new Map(); // productId -> {orders:Set, units}
  for (let i = 0; i < valid.length; i += 200) {
    const chunk = valid.slice(i, i + 200).map((o) => o.id);
    const { data: lis } = await sb.from("order_line_items").select("order_id, shopify_product_id, quantity, price, total_discount").in("order_id", chunk);
    for (const li of lis ?? []) {
      if (!li.shopify_product_id || !dayOrderIds.has(li.order_id)) continue;
      const e = sales.get(li.shopify_product_id) ?? { orders: new Set(), units: 0, rev: 0, disc: 0 };
      e.orders.add(li.order_id); e.units += Number(li.quantity);
      e.rev += Number(li.price) * Number(li.quantity);
      e.disc += Number(li.total_discount ?? 0);
      sales.set(li.shopify_product_id, e);
    }
  }

  console.log("═".repeat(78));
  console.log(`Utilizador ${userId.slice(0, 8)} · dia ${DAY} · encomendas válidas: ${valid.length}`);
  console.log("─".repeat(78));
  console.log(`${"Campanha".padEnd(34)} META_pur  →  SHOPIFY enc/unid  (produto)`);
  for (const c of active) {
    const m = match(c.campaign_name ?? "");
    const s = m ? sales.get(m.id) : null;
    const shop = s ? `${s.orders.size} enc / ${s.units} un` : (m ? "0 enc / 0 un" : "sem produto");
    const rev = s ? `gross ${s.rev.toFixed(2)} | desc ${s.disc.toFixed(2)} | líq ${(s.rev - s.disc).toFixed(2)}` : "";
    console.log(`${(c.campaign_name ?? "").slice(0, 26).padEnd(26)} ${String(c.purchases).padStart(4)} → ${shop.padEnd(15)} ${rev} ${m ? "[" + (m.title ?? "").slice(0, 16) + "]" : ""}`);
  }
}
process.exit(0);
