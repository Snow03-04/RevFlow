// Repõe ligações Meta/Shopify presas em `error` para `active` e limpa o erro,
// para voltarem a ser elegíveis para sync imediatamente.
// Correr com:  node scripts/reset-connections.mjs
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

const sb = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

for (const table of ["meta_connections", "shopify_connections"]) {
  const { data, error } = await sb
    .from(table)
    .update({ status: "active", last_sync_error: null })
    .eq("status", "error")
    .select("id, user_id");
  if (error) { console.log(`${table}: ERRO ${error.message}`); continue; }
  console.log(`${table}: ${data?.length ?? 0} ligação(ões) reposta(s) para active`);
}
process.exit(0);
