import "server-only";
import type { Tables } from "@/types/database";
import { decryptToken } from "@/lib/crypto";
import { GOOGLE_DAILY_BUDGET_QUERY, googleDailyForecast } from "./daily-budget";
import { ymdInTz } from "@/lib/date";
import { searchStream } from "./client";
import { refreshAccessToken } from "./oauth";

export async function readGoogleBudget(connection: Tables<"google_connections">) {
  const signal = AbortSignal.timeout(8000);
  const token = await refreshAccessToken(decryptToken(connection.access_token), signal);
  const query = (gaql: string) => searchStream(connection.customer_id, token, gaql, connection.login_customer_id, signal);
  const [campaigns, costs, customer] = await Promise.all([query(GOOGLE_DAILY_BUDGET_QUERY),
    query("SELECT metrics.cost_micros FROM customer WHERE segments.date DURING TODAY"),
    query("SELECT customer.time_zone FROM customer LIMIT 1")]);
  const spent = costs.reduce((sum, row) => sum + Number(row.metrics?.costMicros ?? 0) / 1e6, 0);
  if (!connection.account_currency || !Number.isFinite(spent) || spent < 0) throw new Error("Gasto Google por confirmar.");
  const timeZone = customer[0]?.customer?.timeZone;
  if (!timeZone || signal.aborted) throw new Error("Orçamento Google por confirmar.");
  return { ...googleDailyForecast(campaigns, ymdInTz(new Date(), timeZone)), spent, currency: connection.account_currency };
}
