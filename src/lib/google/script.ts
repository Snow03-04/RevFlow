import "server-only";
import crypto from "node:crypto";
import { serverEnv, clientEnv } from "@/lib/env";

/**
 * Google Ads → RevFlow without the Google Ads API.
 *
 * The API needs an approved developer token, which takes days to get. Instead a
 * Google Ads Script runs inside the ad account itself (Tools → Scripts), reads
 * the account's daily cost and POSTs it to /api/google/script-costs, which books
 * it as a "Google <store> 12,34" despesa — the same entry merchants typed by hand
 * and that metrics.ts already folds into ad_spend_google.
 *
 * Each script is bound to one (user, store) pair by an HMAC token, so it can
 * only ever write that store's Google spend. Nothing new is stored: the token is
 * derived from TOKEN_ENCRYPTION_KEY on the fly.
 */

const TOKEN_CONTEXT = "google-ads-script:v1";

export function googleScriptToken(userId: string, storeId: string): string {
  return crypto
    .createHmac("sha256", serverEnv.tokenEncryptionKey)
    .update(`${TOKEN_CONTEXT}:${userId}:${storeId}`)
    .digest("base64url");
}

export function googleScriptEndpoint(): string {
  return `${clientEnv.appUrl}/api/google/script-costs`;
}

/** Source of the Google Ads Script to paste into the store's ad account. */
export function buildGoogleAdsScript(opts: {
  userId: string;
  storeId: string;
  storeName: string;
}): string {
  const token = googleScriptToken(opts.userId, opts.storeId);
  return `/**
 * RevFlow — custo diário do Google Ads (${opts.storeName})
 *
 * Envia o custo de cada dia desta conta para a RevFlow, onde entra como a
 * despesa "Google ${opts.storeName} …". Agendar para correr de hora a hora.
 * Não mexer nas constantes abaixo: estão ligadas a esta loja.
 */
var REVFLOW_URL = ${JSON.stringify(googleScriptEndpoint())};
var REVFLOW_USER = ${JSON.stringify(opts.userId)};
var REVFLOW_STORE = ${JSON.stringify(opts.storeId)};
var REVFLOW_TOKEN = ${JSON.stringify(token)};
var DAYS_BACK = 7; // hoje + os 7 dias anteriores (corrige ajustes tardios)

function main() {
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var from = shiftDay(today, -DAYS_BACK);

  // FROM customer = total da conta (todas as campanhas, incluindo removidas),
  // igual ao cartão "Custo" da Vista geral.
  var rows = AdsApp.search(
    "SELECT segments.date, metrics.cost_micros FROM customer " +
      "WHERE segments.date BETWEEN '" + from + "' AND '" + today + "'"
  );
  var cost = {};
  while (rows.hasNext()) {
    var r = rows.next();
    cost[r.segments.date] =
      (cost[r.segments.date] || 0) + Number(r.metrics.costMicros) / 1e6;
  }

  var days = [];
  for (var d = from; d <= today; d = shiftDay(d, 1)) {
    days.push({ date: d, cost: Math.round((cost[d] || 0) * 100) / 100 });
  }

  var res = UrlFetchApp.fetch(REVFLOW_URL, {
    method: "post",
    contentType: "application/json",
    muteHttpExceptions: true,
    payload: JSON.stringify({
      user: REVFLOW_USER,
      store: REVFLOW_STORE,
      token: REVFLOW_TOKEN,
      currency: account.getCurrencyCode(),
      customerId: account.getCustomerId(),
      days: days,
    }),
  });
  Logger.log(res.getResponseCode() + " " + res.getContentText());
  if (res.getResponseCode() !== 200) {
    throw new Error("RevFlow respondeu " + res.getResponseCode());
  }
}

/** yyyy-MM-dd + n dias (aritmética em UTC, sem saltos de hora de verão). */
function shiftDay(ymd, n) {
  var p = ymd.split("-");
  var t = Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000;
  return Utilities.formatDate(new Date(t), "UTC", "yyyy-MM-dd");
}
`;
}
