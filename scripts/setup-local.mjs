import { randomBytes } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

const destination = new URL("../.env.local", import.meta.url);
const template = readFileSync(new URL("../.env.example", import.meta.url), "utf8");
const content = template
  .replace(/^TOKEN_ENCRYPTION_KEY=.*$/m, `TOKEN_ENCRYPTION_KEY=${randomBytes(32).toString("hex")}`)
  .replace(/^CRON_SECRET=.*$/m, `CRON_SECRET=${randomBytes(32).toString("hex")}`);

try {
  // Never replace existing credentials or invalidate stored encrypted tokens.
  writeFileSync(destination, content, { encoding: "utf8", flag: "wx", mode: 0o600 });
  console.log("Criado .env.local com novas chaves privadas para esta instalação.");
  console.log("Preenche as credenciais do teu Supabase antes de executar npm run dev:local.");
} catch (error) {
  if (error.code !== "EEXIST") throw error;
  console.log("O .env.local já existe e foi mantido sem alterações.");
}
