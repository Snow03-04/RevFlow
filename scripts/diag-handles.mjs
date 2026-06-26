// Cruza os handles extraídos dos anúncios Meta com os handles reais dos produtos
// Shopify, para confirmar que o match por URL liga campanha→produto.
// Correr com:  node scripts/diag-handles.mjs
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}
const META_VER = env.META_API_VERSION ?? "v21.0";
const SHOP_VER = env.SHOPIFY_API_VERSION ?? "2025-01";

function decrypt(p) {
  const [iv, tag, data] = p.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
}
function linksFromCreative(c) {
  const out = []; if (!c) return out;
  if (c.link_url) out.push(c.link_url);
  const s = c.object_story_spec;
  if (s) { if (s.link_data?.link) out.push(s.link_data.link); if (s.video_data?.call_to_action?.value?.link) out.push(s.video_data.call_to_action.value.link); if (s.template_data?.link) out.push(s.template_data.link); }
  for (const l of c.asset_feed_spec?.link_urls ?? []) if (l.website_url) out.push(l.website_url);
  return out;
}
function handleFromUrl(u) { try { const m = new URL(u).pathname.match(/\/products\/([^/?#]+)/i); return m ? decodeURIComponent(m[1]).toLowerCase() : null; } catch { return null; } }

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: shopConns } = await sb.from("shopify_connections").select("*").in("status", ["active", "error"]);
const { data: metaConns } = await sb.from("meta_connections").select("*").in("status", ["active", "error"]);

for (const shop of shopConns ?? []) {
  const token = decrypt(shop.access_token);
  // handles de TODOS os produtos do Shopify
  const productHandles = new Map(); // handle -> title
  let url = `https://${shop.shop_domain}/admin/api/${SHOP_VER}/products.json?limit=250&fields=id,handle,title`;
  let guard = 0;
  while (url && guard < 20) {
    const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
    const json = await res.json();
    if (json.errors) { console.log(`  Shopify erro (HTTP ${res.status}):`, JSON.stringify(json.errors).slice(0, 120)); break; }
    for (const p of json.products ?? []) if (p.handle) productHandles.set(String(p.handle).toLowerCase(), p.title);
    const linkHeader = res.headers.get("link") ?? "";
    const next = linkHeader.match(/<([^>]+)>;\s*rel="next"/);
    url = next ? next[1] : "";
    guard++;
  }

  const meta = (metaConns ?? []).find((m) => m.user_id === shop.user_id);
  console.log("═".repeat(74));
  console.log(`Loja ${shop.shop_domain}  | produtos com handle: ${productHandles.size}`);
  if (!meta) { console.log("(sem ligação Meta)"); continue; }

  const mToken = decrypt(meta.access_token);
  const fields = "campaign_id,campaign{name},creative{link_url,object_story_spec{link_data{link},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}}}";
  let mUrl = `https://graph.facebook.com/${META_VER}/${meta.ad_account_id}/ads?` + new URLSearchParams({ fields, limit: "200", effective_status: '["ACTIVE","PAUSED"]', access_token: mToken });
  const byCampaign = new Map();
  let pages = 0;
  while (mUrl && pages < 6) {
    const json = await fetch(mUrl).then((r) => r.json());
    if (json.error) { console.log("Erro Meta:", json.error.message); break; }
    for (const ad of json.data ?? []) {
      const name = ad.campaign?.name ?? ad.campaign_id;
      const e = byCampaign.get(name) ?? new Set();
      for (const l of linksFromCreative(ad.creative)) { const h = handleFromUrl(l); if (h) e.add(h); }
      byCampaign.set(name, e);
    }
    mUrl = json.paging?.next ?? ""; pages++;
  }

  console.log("─".repeat(74));
  let ok = 0;
  for (const [name, handles] of byCampaign) {
    const matched = [...handles].find((h) => productHandles.has(h));
    if (matched) { ok++; console.log(`  ✓ ${(name ?? "").slice(0, 32).padEnd(32)} → [${productHandles.get(matched)?.slice(0, 30)}]  (handle: ${matched.slice(0, 28)})`); }
    else console.log(`  ✗ ${(name ?? "").slice(0, 32).padEnd(32)} → handles ${[...handles].join(",").slice(0, 30) || "—"} não batem com nenhum produto`);
  }
  console.log("─".repeat(74));
  console.log(`Match por URL: ${ok}/${byCampaign.size} campanhas`);
}
process.exit(0);
