// Valida se os anúncios da Meta expõem URLs de produto utilizáveis (para ligar
// campanha → produto Shopify pelo handle do link, em vez de pelo nome).
// Correr com:  node scripts/diag-adlinks.mjs
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
const VER = env.META_API_VERSION ?? "v21.0";

function decrypt(payload) {
  const [iv, tag, data] = payload.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
}

// Extrai todos os links possíveis de um creative (estruturas variam por tipo de anúncio).
function linksFromCreative(c) {
  const out = [];
  if (!c) return out;
  if (c.link_url) out.push(c.link_url);
  const s = c.object_story_spec;
  if (s) {
    if (s.link_data?.link) out.push(s.link_data.link);
    if (s.video_data?.call_to_action?.value?.link) out.push(s.video_data.call_to_action.value.link);
    if (s.template_data?.link) out.push(s.template_data.link);
  }
  for (const l of c.asset_feed_spec?.link_urls ?? []) if (l.website_url) out.push(l.website_url);
  return out;
}

// /products/<handle> de um URL Shopify.
function handleFromUrl(url) {
  try {
    const u = new URL(url);
    const m = u.pathname.match(/\/products\/([^/?#]+)/i);
    return m ? decodeURIComponent(m[1]).toLowerCase() : null;
  } catch {
    return null;
  }
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: conns } = await sb.from("meta_connections").select("*").in("status", ["active", "error"]);

for (const conn of conns ?? []) {
  const token = decrypt(conn.access_token);
  const fields =
    "name,campaign_id,campaign{name}," +
    "creative{link_url,object_story_spec{link_data{link},video_data{call_to_action{value{link}}},template_data{link}},asset_feed_spec{link_urls{website_url}}}";
  let url =
    `https://graph.facebook.com/${VER}/${conn.ad_account_id}/ads?` +
    new URLSearchParams({ fields, limit: "200", access_token: token, effective_status: '["ACTIVE","PAUSED"]' });

  const byCampaign = new Map(); // campaign_name -> {handles:Set, links:Set, ads:n}
  let pages = 0;
  try {
    while (url && pages < 6) {
      const json = await fetch(url).then((r) => r.json());
      if (json.error) { console.log("Erro Meta:", json.error.message); break; }
      for (const ad of json.data ?? []) {
        const name = ad.campaign?.name ?? ad.campaign_id;
        const e = byCampaign.get(name) ?? { handles: new Set(), links: new Set(), ads: 0 };
        e.ads++;
        for (const l of linksFromCreative(ad.creative)) {
          e.links.add(l);
          const h = handleFromUrl(l);
          if (h) e.handles.add(h);
        }
        byCampaign.set(name, e);
      }
      url = json.paging?.next ?? "";
      pages++;
    }
  } catch (e) { console.log("Falha:", e.message); }

  console.log("═".repeat(74));
  console.log(`Conta ${conn.ad_account_id} (${conn.account_currency}) — ${byCampaign.size} campanhas com anúncios`);
  console.log("─".repeat(74));
  let withHandle = 0;
  for (const [name, e] of byCampaign) {
    const h = [...e.handles];
    if (h.length) withHandle++;
    const sample = [...e.links][0] ?? "—";
    console.log(`  ${(name ?? "").slice(0, 34).padEnd(34)} | handles: ${h.length ? h.join(", ").slice(0, 40) : "NENHUM"}`);
    if (!h.length) console.log(`      link exemplo: ${sample.slice(0, 70)}`);
  }
  console.log("─".repeat(74));
  console.log(`Campanhas com handle de produto extraído: ${withHandle}/${byCampaign.size}`);
}
process.exit(0);
