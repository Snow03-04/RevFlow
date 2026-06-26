// Diagnóstico do Ad Spend de hoje. Lê dados reais e compara:
//  - o que a Meta devolve agora (nível conta + nível campanha)
//  - o que está na tabela `campaigns` / `daily_metrics`
//  - as taxas de câmbio aplicadas
// Correr com:  node scripts/diag-adspend.mjs
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import { createClient } from "@supabase/supabase-js";

/* ---- carregar .env.local ---- */
const env = {};
for (const line of readFileSync(new URL("../.env.local", import.meta.url), "utf8").split("\n")) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
  if (!m) continue;
  let v = m[2].trim();
  if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
  env[m[1]] = v;
}

const META_API_VERSION = env.META_API_VERSION ?? "v21.0";

/* ---- decrypt AES-256-GCM (igual ao crypto.ts) ---- */
function decryptToken(payload) {
  const [ivHex, tagHex, dataHex] = payload.split(":");
  const key = Buffer.from(env.TOKEN_ENCRYPTION_KEY, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([decipher.update(Buffer.from(dataHex, "hex")), decipher.final()]).toString("utf8");
}

function ymdInTz(date, tz) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

async function fxRate(base, quote) {
  if (!base || !quote || base.toUpperCase() === quote.toUpperCase()) return 1;
  const res = await fetch(`https://api.frankfurter.app/latest?from=${base.toUpperCase()}&to=${quote.toUpperCase()}`);
  const json = await res.json();
  const r = json?.rates?.[quote.toUpperCase()];
  return typeof r === "number" && r > 0 ? r : 1;
}

async function metaInsights(act, token, params) {
  const url = `https://graph.facebook.com/${META_API_VERSION}/${act}/insights?` +
    new URLSearchParams({ ...params, access_token: token });
  const res = await fetch(url);
  const json = await res.json();
  if (json.error) throw new Error(`Meta ${json.error.code}: ${json.error.message}`);
  return json.data ?? [];
}

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const line = "─".repeat(60);
console.log(line);

// Quantos utilizadores / ligações existem (descartar confusão multi-conta)?
const { data: allUsers } = await sb.from("settings").select("user_id, currency, timezone");
const { data: allMeta } = await sb.from("meta_connections").select("user_id, ad_account_id, account_currency, status");
const { data: allShop } = await sb.from("shopify_connections").select("user_id, shop_domain, status");
console.log(`Utilizadores (settings): ${allUsers?.length ?? 0}`);
for (const u of allUsers ?? []) console.log(`  • ${u.user_id}  display=${u.currency}  tz=${u.timezone}`);
console.log(`Ligações Meta: ${allMeta?.length ?? 0}`);
for (const m of allMeta ?? []) console.log(`  • ${m.user_id}  ${m.ad_account_id}  ${m.account_currency}  [${m.status}]`);
console.log(`Ligações Shopify: ${allShop?.length ?? 0}`);
for (const s of allShop ?? []) console.log(`  • ${s.user_id}  ${s.shop_domain}  [${s.status}]`);
console.log(line);

const { data: conns } = await sb.from("meta_connections").select("*");
if (!conns || conns.length === 0) {
  console.log("Sem ligações Meta."); process.exit(0);
}

for (const conn of conns) {
  const userId = conn.user_id;
  const { data: settings } = await sb.from("settings").select("currency, timezone").eq("user_id", userId).maybeSingle();
  const displayCur = settings?.currency ?? "USD";
  const tz = settings?.timezone ?? "UTC";

  const { data: storeRow } = await sb.from("orders").select("currency").eq("user_id", userId)
    .not("currency", "is", null).order("processed_at", { ascending: false }).limit(1).maybeSingle();
  const storeCur = storeRow?.currency ?? null;
  const adCur = conn.account_currency;

  const today = ymdInTz(new Date(), tz);
  const token = decryptToken(conn.access_token);

  console.log(`Conta:        ${conn.ad_account_id}`);
  console.log(`Moedas:       loja=${storeCur}  display=${displayCur}  conta_ads=${adCur}`);
  console.log(`Timezone:     ${tz}   |  Hoje (loja) = ${today}`);
  console.log(`Último sync:  ${conn.last_synced_at}   erro: ${conn.last_sync_error ?? "—"}`);
  console.log(line);

  // 1) Meta AO VIVO — nível conta, date_preset=today (o mais próximo do Ads Manager)
  let metaTodayAccount = 0;
  try {
    const d = await metaInsights(conn.ad_account_id, token, { fields: "spend", date_preset: "today" });
    metaTodayAccount = d.reduce((s, r) => s + Number(r.spend ?? 0), 0);
  } catch (e) { console.log("Erro Meta (account/today):", e.message); }

  // 2) Meta AO VIVO — nível campanha, time_increment=1 hoje (o que o nosso sync usa)
  let metaTodayCampaign = 0; let nCamp = 0;
  try {
    const d = await metaInsights(conn.ad_account_id, token, {
      level: "campaign", time_increment: "1",
      time_range: JSON.stringify({ since: today, until: today }),
      fields: "campaign_name,spend", limit: "500",
    });
    nCamp = d.length;
    metaTodayCampaign = d.reduce((s, r) => s + Number(r.spend ?? 0), 0);
  } catch (e) { console.log("Erro Meta (campaign/today):", e.message); }

  // 3) O que está GUARDADO na tabela campaigns para hoje (moeda da loja)
  const { data: camps } = await sb.from("campaigns").select("campaign_name, spend, date")
    .eq("user_id", userId).eq("date", today);
  const dbCampSpend = (camps ?? []).reduce((s, r) => s + Number(r.spend ?? 0), 0);

  // 4) O que está em daily_metrics para hoje (moeda da loja)
  const { data: dm } = await sb.from("daily_metrics").select("ad_spend").eq("user_id", userId).eq("date", today).maybeSingle();
  const dmSpend = Number(dm?.ad_spend ?? 0);

  // 4b) Últimos 7 dias de daily_metrics (loja) + equivalente em display
  const { data: dmDays } = await sb.from("daily_metrics")
    .select("date, ad_spend, revenue").eq("user_id", userId)
    .order("date", { ascending: false }).limit(7);
  const fxSD = await fxRate(storeCur, displayCur);
  console.log("daily_metrics (últimos 7 dias):");
  for (const r of dmDays ?? []) {
    console.log(`  ${r.date}  ad_spend=${Number(r.ad_spend).toFixed(0)} ${storeCur}  →  ${(Number(r.ad_spend) * fxSD).toFixed(2)} ${displayCur}   (rev ${(Number(r.revenue) * fxSD).toFixed(2)} ${displayCur})`);
  }
  console.log(line);

  // 5) Câmbios
  const fxAdToStore = await fxRate(adCur, storeCur);
  const fxStoreToDisplay = await fxRate(storeCur, displayCur);
  const displayed = dmSpend * fxStoreToDisplay;

  console.log(`META ao vivo  (conta, date_preset=today):   ${metaTodayAccount.toFixed(2)} ${adCur}`);
  console.log(`META ao vivo  (campanha, time_increment):   ${metaTodayCampaign.toFixed(2)} ${adCur}   (${nCamp} campanhas)`);
  console.log(line);
  console.log(`Tabela campaigns (hoje):                    ${dbCampSpend.toFixed(2)} ${storeCur}   (${(camps ?? []).length} linhas)`);
  console.log(`Tabela daily_metrics.ad_spend (hoje):       ${dmSpend.toFixed(2)} ${storeCur}`);
  console.log(line);
  console.log(`Câmbio conta→loja  (${adCur}→${storeCur}):   ${fxAdToStore}`);
  console.log(`Câmbio loja→display(${storeCur}→${displayCur}):   ${fxStoreToDisplay}`);
  console.log(`→ Valor MOSTRADO no dashboard (calc):        ${displayed.toFixed(2)} ${displayCur}`);
  console.log(line);

  // Diagnóstico
  const liveDisplay = metaTodayCampaign * fxAdToStore * fxStoreToDisplay;
  console.log(`Se o sync corresse AGORA, o dashboard daria: ${liveDisplay.toFixed(2)} ${displayCur}`);
  if (Math.abs(metaTodayAccount - metaTodayCampaign) > 0.5) {
    console.log(`⚠️  A API por-campanha (${metaTodayCampaign.toFixed(2)}) difere do total da conta (${metaTodayAccount.toFixed(2)}): atraso/atribuição da Meta no dia atual.`);
  }
  console.log(line);
}
process.exit(0);
