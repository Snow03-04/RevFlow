// Narrow local bridge for a temporary HTTPS tunnel. It exposes only the Google
// import route, for one preselected user/store, protected by the existing HMAC.
const http = require("node:http");
const crypto = require("node:crypto");

function createGoogleRelay({ userId, storeId, token, target = "http://127.0.0.1:3000/api/google/script-costs", fetchImpl = fetch }) {
  const upstream = new URL(target);
  if (!["127.0.0.1", "localhost"].includes(upstream.hostname) || upstream.protocol !== "http:" || upstream.pathname !== "/api/google/script-costs" || upstream.username || upstream.password || upstream.search || upstream.hash) throw Error("Invalid local import target");
  if (!userId || !storeId || !token) throw Error("A user, store and scoped token are required");
  let active = 0;
  const server = http.createServer(async (req, res) => {
    const respond = (status, value) => {
      if (!res.writableEnded) { res.writeHead(status, { "Content-Type": "application/json", "Cache-Control": "no-store" }); res.end(JSON.stringify(value)); }
    };
    if (req.method !== "POST" || !["/api/google/script-costs", "/api/google/script-gross-costs"].includes(req.url)) return respond(404, { ok: false });
    if (active >= 2) return respond(429, { ok: false });
    active++;
    try {
      let size = 0;
      const parts = [];
      for await (const part of req) {
        size += part.length;
        if (size > 10 * 1024 * 1024) return respond(413, { ok: false });
        parts.push(part);
      }
      const body = Buffer.concat(parts).toString("utf8");
      let data;
      try { data = JSON.parse(body); } catch { return respond(400, { ok: false }); }
      const supplied = Buffer.from(typeof data?.token === "string" ? data.token : "");
      const expected = Buffer.from(token);
      if (data?.user !== userId || data?.store !== storeId || supplied.length !== expected.length || !crypto.timingSafeEqual(supplied, expected)) return respond(401, { ok: false });
      const routeTarget = req.url === "/api/google/script-gross-costs" ? target.replace(/\/script-costs$/, "/script-gross-costs") : target;
      const response = await fetchImpl(routeTarget, {
        method: "POST", headers: { "Content-Type": "application/json" }, body,
        redirect: "error", signal: AbortSignal.timeout(70000),
      });
      if (!response.headers.get("content-type")?.includes("application/json")) return respond(502, { ok: false });
      const result = await response.json();
      // Only return import acknowledgements, never arbitrary local server data.
      const allowed = ["ok", "inserted", "updated", "removed", "unchanged", "campaignRows", "collectionLinks", "grossSpendImported", "netSpendImported", "changeHistoryImported"];
      const acknowledgement = Object.fromEntries(allowed.filter((key) => typeof result[key] === "number" || typeof result[key] === "boolean").map((key) => [key, result[key]]));
      respond(response.status, acknowledgement);
    } catch { respond(502, { ok: false }); }
    finally { active--; }
  });
  server.requestTimeout = 20000;
  server.headersTimeout = 10000;
  return server;
}

module.exports = { createGoogleRelay };

if (require.main === module) {
  require("@next/env").loadEnvConfig(require("node:path").resolve(__dirname, ".."));
  const [userId, storeId] = process.argv.slice(2);
  const secret = process.env.TOKEN_ENCRYPTION_KEY;
  if (!secret || !/^[a-f\d-]{36}$/i.test(userId ?? "") || !/^[a-f\d-]{36}$/i.test(storeId ?? "")) throw Error("Indica os IDs da conta e da loja para esta sessão local.");
  const token = crypto.createHmac("sha256", secret).update(`google-ads-script:v1:${userId}:${storeId}`).digest("base64url");
  createGoogleRelay({ userId, storeId, token }).listen(3102, "127.0.0.1", () => {
    console.log("Recetor local pronto em 127.0.0.1:3102. Só aceita a importação Google da loja escolhida.");
  });
}
