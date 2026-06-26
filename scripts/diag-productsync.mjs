// Replica a paginação de produtos do sync da app (active/draft/archived,
// published_status=any) e conta quantos produtos/variantes traz de facto.
// Correr com:  node scripts/diag-productsync.mjs
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
const VER = env.SHOPIFY_API_VERSION ?? "2025-01";
function decrypt(p) {
  const [iv, tag, data] = p.split(":");
  const d = crypto.createDecipheriv("aes-256-gcm", Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex"), Buffer.from(iv, "hex"));
  d.setAuthTag(Buffer.from(tag, "hex"));
  return Buffer.concat([d.update(Buffer.from(data, "hex")), d.final()]).toString("utf8");
}
function nextPageInfo(link) {
  if (!link) return null;
  const part = link.split(",").find((p) => p.includes('rel="next"'));
  if (!part) return null;
  const u = part.match(/<([^>]+)>/);
  return u ? new URL(u[1]).searchParams.get("page_info") : null;
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const { data: shops } = await sb.from("shopify_connections").select("*").in("status", ["active", "error"]);

for (const shop of shops ?? []) {
  const token = decrypt(shop.access_token);
  const products = new Set();
  const variants = new Set();
  const noImage = new Set();
  console.log("═".repeat(70));
  console.log(`Loja ${shop.shop_domain}`);

  for (const status of ["active", "draft", "archived"]) {
    let pageInfo = null, first = true, pages = 0, statusCount = 0;
    while (true) {
      const params = pageInfo
        ? new URLSearchParams({ limit: "250", page_info: pageInfo })
        : new URLSearchParams({ limit: "250", published_status: "any", status });
      const url = `https://${shop.shop_domain}/admin/api/${VER}/products.json?${params}`;
      const res = await fetch(url, { headers: { "X-Shopify-Access-Token": token } });
      if (!res.ok) { console.log(`  [${status}] HTTP ${res.status}: ${(await res.text()).slice(0, 100)}`); break; }
      const json = await res.json();
      for (const p of json.products ?? []) {
        products.add(String(p.id));
        statusCount++;
        const img = p.image?.src ?? p.images?.[0]?.src ?? null;
        if (!img) noImage.add(String(p.id));
        for (const v of p.variants ?? []) variants.add(String(v.id));
      }
      pages++;
      pageInfo = nextPageInfo(res.headers.get("link"));
      if (!pageInfo || (!first && false)) { if (!pageInfo) break; }
      first = false;
      if (pages > 50) { console.log(`  [${status}] guard parou às 50 páginas`); break; }
    }
    console.log(`  status=${status.padEnd(8)} → ${statusCount} produtos (${pages} páginas)`);
  }

  console.log("─".repeat(70));
  console.log(`TOTAL distinto: ${products.size} produtos | ${variants.size} variantes | sem imagem no Shopify: ${noImage.size}`);

  const { count } = await sb.from("products").select("*", { count: "exact", head: true }).eq("user_id", shop.user_id);
  const { data: distinctRows } = await sb.from("products").select("shopify_product_id").eq("user_id", shop.user_id).limit(100000);
  console.log(`Na BD da app: ${count} linhas de variante | ${new Set((distinctRows ?? []).map((r) => r.shopify_product_id)).size} produtos distintos`);
}
process.exit(0);
