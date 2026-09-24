import "server-only";
import crypto from "node:crypto";
import { serverEnv, clientEnv } from "@/lib/env";
import { GOOGLE_BUDGET_QUERY, GOOGLE_CHANGE_QUERY, GOOGLE_CHANGE_READER } from "./change-events";
import { GOOGLE_INCENTIVE_QUERY, GOOGLE_PROMOTION_READER, type GooglePromotionReconciliation } from "./promotional-credits";

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
  // Google executes remotely: local development still needs the public receiver.
  const appUrl = process.env.GOOGLE_ADS_SCRIPT_APP_URL?.trim() || clientEnv.appUrl;
  return `${appUrl.replace(/\/+$/, "")}/api/google/script-costs`;
}

export function googleScriptLocalEndpoint(storeId: string): string {
  return process.env.GOOGLE_ADS_SCRIPT_LOCAL_STORE_ID === storeId
    ? process.env.GOOGLE_ADS_SCRIPT_LOCAL_URL?.trim() ?? ""
    : "";
}

/** Source of the Google Ads Script to paste into the store's ad account. */
export function buildGoogleAdsScript(opts: {
  userId: string;
  storeId: string;
  storeName: string;
  credits?: { valor: number; inicio: string }[];
  localEndpoint?: string;
  billingReconciliations?: GooglePromotionReconciliation[];
  localIdentity?: { user: string; store: string; token: string };
}): string {
  const token = googleScriptToken(opts.userId, opts.storeId);
  const localEndpoint = opts.localEndpoint ?? googleScriptLocalEndpoint(opts.storeId);
  const reconciliations = opts.billingReconciliations ?? JSON.parse(process.env.GOOGLE_ADS_BILLING_RECONCILIATIONS || "{}")[`${opts.userId}:${opts.storeId}`] ?? [];
  if (localEndpoint) {
    const parsed = new URL(localEndpoint);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/api/google/script-costs") {
      throw new Error("O destino local tem de ser um endereço HTTPS para /api/google/script-costs.");
    }
  }
  return `/**
 * RevFlow — custos, campanhas, coleções e alterações Google Ads (${opts.storeName.replace(/\*\//g, "")}) · v5
 *
 * Envia o custo de cada dia desta conta para a RevFlow, onde entra como a
 * despesa Google da loja. Envia também campanhas para Finance → Google.
 * Agendar para correr de hora a hora.
 * Não mexer nas constantes abaixo: estão ligadas a esta loja.
 */
var REVFLOW_URL = ${JSON.stringify(googleScriptEndpoint())};
// Opcional: endereço HTTPS temporário que encaminha para o localhost.
var REVFLOW_LOCAL_URL = ${JSON.stringify(localEndpoint)};
var REVFLOW_LOCAL_IDENTITY = ${JSON.stringify(opts.localIdentity ?? null)};
var REVFLOW_USER = ${JSON.stringify(opts.userId)};
var REVFLOW_STORE = ${JSON.stringify(opts.storeId)};
var REVFLOW_TOKEN = ${JSON.stringify(token)};
var DAYS_BACK = 31; // hoje + 31 dias; pode aumentar até 61 para importar mais histórico
// Os créditos concedidos são lidos automaticamente do Google, em cada execução.
// Configuração antiga opcional, usada só se o Google não devolver promoções concedidas.
var CREDITOS = ${JSON.stringify(opts.credits ?? [])};
// Fecho confirmado na Faturação: crédito do dia da transição e ajustes conhecidos.
// Os dias seguintes passam automaticamente a despesa, sem reutilizar o crédito.
var BILLING_RECONCILIATIONS = ${JSON.stringify(reconciliations)};

function main() {
  if (DAYS_BACK < 0 || DAYS_BACK > 61 || DAYS_BACK !== Math.floor(DAYS_BACK)) throw new Error("DAYS_BACK deve estar entre 0 e 61.");
  CREDITOS.forEach(function(c) {
    if (!isFinite(c.valor) || c.valor < 0 || !/^\\d{4}-\\d{2}-\\d{2}$/.test(c.inicio) || shiftDay(c.inicio, 0) !== c.inicio) {
      throw new Error("Crédito promocional inválido: confirma o valor e a data de início.");
    }
  });
  var account = AdsApp.currentAccount();
  var tz = account.getTimeZone();
  var today = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd");
  var from = shiftDay(today, -DAYS_BACK);
  var inicio = from;
  for (var k = 0; k < CREDITOS.length; k++) {
    if (CREDITOS[k].inicio < inicio) inicio = CREDITOS[k].inicio;
  }

  // FROM customer = total da conta (todas as campanhas, incluindo removidas),
  // igual ao cartão "Custo" da Vista geral.
  var rows = AdsApp.search(
    "SELECT segments.date, metrics.cost_micros FROM customer " +
      "WHERE segments.date BETWEEN '" + inicio + "' AND '" + today + "'"
  );
  var cost = {};
  while (rows.hasNext()) {
    var r = rows.next();
    cost[r.segments.date] =
      (cost[r.segments.date] || 0) + Number(r.metrics.costMicros) / 1e6;
  }

  var grossCost = {};
  Object.keys(cost).forEach(function(date) { grossCost[date] = cost[date]; });
  var promotionRows = [], grossOnly = false;
  try {
    var promotionIterator = AdsApp.search(${JSON.stringify(GOOGLE_INCENTIVE_QUERY)});
    while (promotionIterator.hasNext()) {
      var promotionRow = promotionIterator.next();
      var incentive = promotionRow.appliedIncentive;
      // Google returns incentive timestamps in UTC; daily costs use the account timezone.
      if (incentive) {
        if (incentive.rewardGrantDateTime) incentive.rewardGrantDateTime = promotionAccountTime(incentive.rewardGrantDateTime, tz);
        if (incentive.rewardExpirationDateTime) incentive.rewardExpirationDateTime = promotionAccountTime(incentive.rewardExpirationDateTime, tz);
      }
      promotionRows.push(promotionRow);
    }
  var promotionResult = applyGooglePromotions(cost, promotionRows, account.getCurrencyCode(), Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH:mm:ss"), BILLING_RECONCILIATIONS);
  if (promotionResult.promotions.length) {
    cost = promotionResult.paid;
    promotionResult.promotions.forEach(function(p) {
      Logger.log("Crédito Google: " + p.amount.toFixed(2) + " " + account.getCurrencyCode() + "; concedido em " + p.grantedAt + "; saldo " + p.remaining.toFixed(2) + "; validade " + p.expiresAt + ".");
    });
    Logger.log("Campanhas e ROAS usam gasto bruto. Dashboard e P&L descontam os anúncios cobertos pelo crédito.");
    BILLING_RECONCILIATIONS.forEach(function(r) { Logger.log("Crédito encerrado em " + r.exhaustedOn + ": gastos seguintes entram automaticamente na dashboard."); });
  } else {
    var credito = 0;
    for (var creditDay = inicio; creditDay <= today; creditDay = shiftDay(creditDay, 1)) {
      for (var k = 0; k < CREDITOS.length; k++) {
        if (CREDITOS[k].inicio === creditDay) credito += CREDITOS[k].valor;
      }
      var usado = Math.min(cost[creditDay] || 0, credito);
      cost[creditDay] = (cost[creditDay] || 0) - usado;
      credito -= usado;
    }
    Logger.log("Crédito manual por usar: " + credito.toFixed(2) + " " + account.getCurrencyCode());
  }
  } catch (e) {
    grossOnly = true;
    cost = {};
    Object.keys(grossCost).forEach(function(date) { cost[date] = grossCost[date]; });
    Logger.log("Créditos por reconciliar na Faturação Google. A importar apenas gastos brutos para Finance; despesas pagas permanecem inalteradas.");
  }

  var campaigns = [];
  var campaignIds = {};
  var campaignQuery = [
    "SELECT campaign.id, campaign.name, campaign.status, segments.date,",
    "metrics.cost_micros, metrics.impressions, metrics.clicks,",
    "metrics.conversions, metrics.conversions_value FROM campaign",
    "WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED')",
    "AND segments.date BETWEEN '" + from + "' AND '" + today + "'"
  ].join(" ");
  var campaignRows = AdsApp.search(campaignQuery);
  while (campaignRows.hasNext()) {
    var cr = campaignRows.next();
    campaignIds[String(cr.campaign.id)] = true;
    campaigns.push({
      id: String(cr.campaign.id), name: cr.campaign.name, status: cr.campaign.status,
      date: cr.segments.date, cost: Number(cr.metrics.costMicros || 0) / 1e6,
      grossCost: Number(cr.metrics.costMicros || 0) / 1e6,
      impressions: Number(cr.metrics.impressions || 0), clicks: Number(cr.metrics.clicks || 0),
      conversions: Number(cr.metrics.conversions || 0),
      conversionValue: Number(cr.metrics.conversionsValue || 0),
    });
  }

  // Confirma que o histórico das campanhas cobre o total da conta.
  var reportedByDay = {};
  campaigns.forEach(function(c) { reportedByDay[c.date] = (reportedByDay[c.date] || 0) + c.grossCost; });
  var uncoveredDays = Object.keys(grossCost).filter(function(date) {
    return date >= from && Math.abs(grossCost[date] - (reportedByDay[date] || 0)) > 0.05;
  });
  if (uncoveredDays.length) Logger.log("Atenção: o total das campanhas difere do total da conta em " + uncoveredDays.length + " dias. Datas: " + uncoveredDays.join(", ") + ". Confirma o histórico das campanhas no Google.");

  // Reparte o custo pago pelas campanhas e acerta os cêntimos no total diário.
  if (!grossOnly) allocatePaidCampaignCosts(campaigns, grossCost, cost);

  // Lê os destinos dos anúncios, incluindo grupos de recursos Performance Max.
  // Não altera campanhas, anúncios, orçamentos ou tracking.
  var urls = {};
  var ads = AdsApp.search("SELECT campaign.id, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED') AND ad_group_ad.status IN ('ENABLED', 'PAUSED', 'REMOVED')");
  while (ads.hasNext()) {
    var ad = ads.next();
    addUrls(urls, String(ad.campaign.id), ad.adGroupAd.ad.finalUrls || []);
  }
  var assets = AdsApp.search("SELECT campaign.id, asset_group.final_urls FROM asset_group WHERE campaign.status IN ('ENABLED', 'PAUSED', 'REMOVED') AND asset_group.status IN ('ENABLED', 'PAUSED', 'REMOVED')");
  while (assets.hasNext()) {
    var asset = assets.next();
    addUrls(urls, String(asset.campaign.id), asset.assetGroup.finalUrls || []);
  }
  var targets = Object.keys(campaignIds).map(function(id) {
    return { id: id, finalUrls: urls[id] || [] };
  });

  var days = [];
  for (var d = from; d <= today; d = shiftDay(d, 1)) {
    days.push({ date: d, cost: Math.round((cost[d] || 0) * 100) / 100 });
  }
  if (!grossOnly) Logger.log("Gasto pago " + today + ": " + (cost[today] || 0).toFixed(2) + " " + account.getCurrencyCode() + ".");

  // Historical edits are optional: failure must never interrupt cost imports.
  var changes;
  try {
    var budgets = {}, budgetRows = AdsApp.search(${JSON.stringify(GOOGLE_BUDGET_QUERY)});
    while (budgetRows.hasNext()) {
      var b = budgetRows.next().campaign;
      if (!b || !b.campaignBudget) continue;
      if (!budgets[b.campaignBudget]) budgets[b.campaignBudget] = [];
      budgets[b.campaignBudget].push(String(b.id));
    }
    var eventQuery = ${JSON.stringify(GOOGLE_CHANGE_QUERY)}.replace("DURING LAST_30_DAYS", "BETWEEN '" + shiftDay(today, -29) + " 00:00:00' AND '" + today + " 23:59:59'");
    var events = [], eventRows = AdsApp.search(eventQuery);
    while (eventRows.hasNext()) events.push(eventRows.next());
    changes = readCampaignChanges(events, budgets);
    if (events.length === 10000) Logger.log("Histórico limitado às 10.000 alterações mais recentes do Google.");
  } catch (e) {
    Logger.log("Histórico de alterações indisponível nesta execução. Os custos continuam a ser enviados.");
  }

  var payload = JSON.stringify({
      version: 5,
      user: REVFLOW_USER,
      store: REVFLOW_STORE,
      token: REVFLOW_TOKEN,
      currency: account.getCurrencyCode(),
      customerId: account.getCustomerId(),
      days: days,
      campaigns: campaigns,
      targets: targets,
      changes: changes,
  });
  var destinations = [{ name: "Online", url: REVFLOW_URL }];
  if (REVFLOW_LOCAL_URL && REVFLOW_LOCAL_URL !== REVFLOW_URL) destinations.push({ name: "Localhost", url: REVFLOW_LOCAL_URL, identity: REVFLOW_LOCAL_IDENTITY });
  if (grossOnly) destinations.forEach(function(d) { d.url = d.url.replace(/\\/script-costs$/, "/script-gross-costs"); });
  var acceptedCount = 0, completeCount = 0;
  // Envio sequencial: ambos podem usar a mesma base de dados. Reimportar corrige
  // o mesmo dia; não cria uma segunda despesa. Uma falha não impede o outro envio.
  destinations.forEach(function(destination) {
    try {
      var destinationPayload = payload;
      if (destination.identity) {
        var scopedPayload = JSON.parse(payload);
        scopedPayload.user = destination.identity.user;
        scopedPayload.store = destination.identity.store;
        scopedPayload.token = destination.identity.token;
        destinationPayload = JSON.stringify(scopedPayload);
      }
      var res = UrlFetchApp.fetch(destination.url, {
        method: "post", contentType: "application/json", muteHttpExceptions: true,
        followRedirects: false, payload: destinationPayload,
      });
      // Older receivers reject v5 before saving anything. Keep their v4 import
      // working while the local receiver gets the complete change history.
      if (res.getResponseCode() === 400 && destination.name === "Online" && !grossOnly) {
        var legacyPayload = JSON.parse(destinationPayload);
        legacyPayload.version = 4;
        delete legacyPayload.changes;
        Logger.log("Online: a tentar o formato v4 compatível, sem histórico de alterações.");
        res = UrlFetchApp.fetch(destination.url, {
          method: "post", contentType: "application/json", muteHttpExceptions: true,
          followRedirects: false, payload: JSON.stringify(legacyPayload),
        });
      }
      if (res.getResponseCode() !== 200) throw new Error("HTTP " + res.getResponseCode());
      var accepted = JSON.parse(res.getContentText());
      if (!accepted.ok) throw new Error("Importação não confirmada");
      acceptedCount++;
      if (typeof accepted.campaignRows === "number" && typeof accepted.collectionLinks === "number") {
        completeCount++;
        Logger.log(destination.name + ": custos, campanhas e coleções recebidos.");
        if (grossOnly && accepted.grossSpendImported === true) Logger.log(destination.name + ": gasto bruto atualizado; custo líquido aguarda reconciliação na Faturação.");
        else if (accepted.grossSpendImported === true) Logger.log(destination.name + ": gasto bruto e crédito promocional guardados separadamente.");
        else Logger.log(destination.name + ": falta atualizar a base de dados/app para guardar o gasto antes do crédito (migração 0035).");
        if (changes && accepted.changeHistoryImported !== true) Logger.log(destination.name + ": histórico de alterações por guardar; atualizar a app e aplicar a migração 0036.");
      } else {
        Logger.log(destination.name + ": custos recebidos; esta versão ainda não recebe campanhas e coleções.");
      }
    } catch (e) {
      Logger.log(destination.name + ": envio indisponível (" + e.message + "). Os restantes destinos continuam.");
    }
  });
  if (!acceptedCount) throw new Error("Nenhum destino RevFlow confirmou a receção. Consulta os registos acima.");
  if (!completeCount && destinations.length === 1) {
    throw new Error("O destino RevFlow ainda nao suporta colecoes v3. Publica a versao atualizada da app. Os custos podem ter sido recebidos, mas as colecoes nao foram confirmadas.");
  }
  if (!completeCount) Logger.log("Envio parcial: custos recebidos; campanhas e coleções aguardam um destino atualizado.");
}

${GOOGLE_CHANGE_READER}
${GOOGLE_PROMOTION_READER}

function addUrls(map, id, values) {
  if (!map[id]) map[id] = [];
  values.forEach(function(url) { if (map[id].indexOf(url) === -1) map[id].push(url); });
}

function promotionAccountTime(value, timeZone) {
  var match = /^(\\d{4})-(\\d{2})-(\\d{2})[ T](\\d{2}):(\\d{2}):(\\d{2})(?:\\.\\d+)?$/.exec(String(value));
  if (!match) throw new Error("Horário do crédito Google inválido.");
  var instant = new Date(Date.UTC(+match[1], +match[2] - 1, +match[3], +match[4], +match[5], +match[6]));
  if (Utilities.formatDate(instant, "UTC", "yyyy-MM-dd HH:mm:ss") !== String(value).replace("T", " ").slice(0, 19)) {
    throw new Error("Horário do crédito Google inválido.");
  }
  return Utilities.formatDate(instant, timeZone, "yyyy-MM-dd HH:mm:ss");
}

function allocatePaidCampaignCosts(campaigns, grossCost, paidCost) {
  var byDay = {};
  campaigns.forEach(function(c) { if (!byDay[c.date]) byDay[c.date] = []; byDay[c.date].push(c); });
  Object.keys(byDay).forEach(function(date) {
    var gross = grossCost[date] || 0;
    var paid = paidCost[date] || 0;
    var ratio = gross > 0 ? paid / gross : 1;
    var sum = 0, floors = 0;
    var parts = byDay[date].map(function(c) {
      var cents = c.cost * ratio * 100;
      sum += cents;
      var floor = Math.floor(cents + 1e-8);
      floors += floor;
      return { row: c, cents: floor, fraction: cents - floor };
    });
    var left = Math.round(sum) - floors;
    parts.sort(function(a, b) { return b.fraction - a.fraction || a.row.id.localeCompare(b.row.id); });
    parts.forEach(function(p, i) { p.row.cost = (p.cents + (i < left ? 1 : 0)) / 100; });
  });
}

/** yyyy-MM-dd + n dias (aritmética em UTC, sem saltos de hora de verão). */
function shiftDay(ymd, n) {
  var p = ymd.split("-");
  var t = Date.UTC(+p[0], +p[1] - 1, +p[2]) + n * 86400000;
  return Utilities.formatDate(new Date(t), "UTC", "yyyy-MM-dd");
}
`;
}
