// Read-only smoke test for the Shopify Admin API via the OAuth
// `client_credentials` grant (custom app). It exchanges CLIENT_ID + CLIENT_SECRET
// for a short-lived shpat_ token, then runs ONE GraphQL `shop` query to confirm
// the connection. It never prints the secret and only shows a masked token.
//
// Run (Node 20.6+ auto-loads the env file):
//   node --env-file=.env.local scripts/shopify-cc-test.mjs
// Or export the vars yourself and run:  node scripts/shopify-cc-test.mjs
//
// Required env:
//   SHOPIFY_SHOP=<loja>.myshopify.com
//   SHOPIFY_CLIENT_ID=<API key, 32 hex>
//   SHOPIFY_CLIENT_SECRET=shpss_...        (a API secret key = client_secret)
//   SHOPIFY_API_VERSION=2025-07            (optional; defaults below)

const shopRaw = process.env.SHOPIFY_SHOP;
const clientId = process.env.SHOPIFY_CLIENT_ID;
const clientSecret = process.env.SHOPIFY_CLIENT_SECRET;
const apiVersion = process.env.SHOPIFY_API_VERSION ?? "2025-07";

function die(msg) {
  console.error(`\n✗ ${msg}\n`);
  process.exit(1);
}

if (!shopRaw) die("SHOPIFY_SHOP em falta (ex.: minha-loja.myshopify.com)");
if (!clientId) die("SHOPIFY_CLIENT_ID em falta (a API key — 32 hex)");
if (!clientSecret) die("SHOPIFY_CLIENT_SECRET em falta (shpss_…)");
if (!/^shpss_/.test(clientSecret)) {
  console.warn(
    "⚠  SHOPIFY_CLIENT_SECRET não começa por 'shpss_'. Confirma que é a API secret key (client_secret), não a API key.",
  );
}

// Accept a full URL or a bare domain.
const host = shopRaw.replace(/^https?:\/\//, "").replace(/\/+$/, "");

/** Show only the prefix + length of a token — never the token itself. */
function mask(t) {
  return t ? `${t.slice(0, 9)}…(${t.length} chars)` : "(vazio)";
}

async function getAccessToken() {
  const res = await fetch(`https://${host}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    // The shpss_ goes in the BODY here — never in a header.
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  const text = await res.text();
  if (!res.ok) {
    const hint =
      res.status === 401
        ? "\n   → 401: o client_id/secret não batem certo, ou a app não está autorizada nesta loja. Recopia os dois do MESMO separador 'API credentials'."
        : res.status === 400
          ? "\n   → 400: client_secret em falta/inválido. Confirma que é o shpss_ (secret), não a API key."
          : "";
    die(`Token exchange falhou (${res.status}): ${text}${hint}`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    die(`Resposta do token exchange não é JSON: ${text}`);
  }
  if (!json.access_token) die(`Sem access_token na resposta: ${text}`);
  return json; // { access_token, expires_in, scope, ... }
}

async function queryShop(token) {
  const query =
    "{ shop { name myshopifyDomain currencyCode ianaTimezone url } }";
  const res = await fetch(
    `https://${host}/admin/api/${apiVersion}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
        // The exchanged shpat_ goes in the header — the shpss_ never does.
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query }),
    },
  );
  const text = await res.text();
  if (!res.ok) die(`GraphQL falhou (${res.status}): ${text}`);
  const json = JSON.parse(text);
  if (json.errors) die(`GraphQL devolveu erros: ${JSON.stringify(json.errors)}`);
  return json.data.shop;
}

console.log(`\n→ Loja: ${host}   ·   Admin API ${apiVersion}`);
const tok = await getAccessToken();
console.log(
  `✓ Token obtido via client_credentials: ${mask(tok.access_token)}  ·  expira em ~${
    tok.expires_in ?? "?"
  }s`,
);
if (tok.scope) console.log(`  scopes: ${tok.scope}`);
const shop = await queryShop(tok.access_token);
console.log("\n✓ Ligação confirmada (read-only). shop:");
console.log(JSON.stringify(shop, null, 2));
console.log("");
