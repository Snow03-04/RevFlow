import "server-only";
import { serverEnv, isGoogleConfigured } from "@/lib/env";

/** Re-exported so other modules can gate on real vs mock without importing env. */
export { isGoogleConfigured };

function apiBase(): string {
  return `https://googleads.googleapis.com/${serverEnv.google.apiVersion}`;
}

/** Customer ids are digits only (no dashes) in API headers/paths. */
function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/\D/g, "");
}

function headers(
  accessToken: string,
  loginCustomerId?: string | null,
): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${accessToken}`,
    "developer-token": serverEnv.google.developerToken,
    "Content-Type": "application/json",
  };
  const lci = digits(loginCustomerId);
  if (lci) h["login-customer-id"] = lci;
  return h;
}

/** Customer ids (digits) the authenticated user can access directly. */
export async function listAccessibleCustomers(
  accessToken: string,
): Promise<string[]> {
  const res = await fetch(`${apiBase()}/customers:listAccessibleCustomers`, {
    headers: headers(accessToken),
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google listAccessibleCustomers failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as { resourceNames?: string[] };
  return (json.resourceNames ?? []).map((r) => r.replace("customers/", ""));
}

/**
 * Run a GAQL query against one customer via searchStream. `loginCustomerId` is
 * the manager account when the customer is accessed through an MCC; for direct
 * accounts it falls back to the customer itself. Returns the flat result rows.
 */
export async function searchStream(
  customerId: string,
  accessToken: string,
  query: string,
  loginCustomerId?: string | null,
): Promise<any[]> {
  const res = await fetch(
    `${apiBase()}/customers/${digits(customerId)}/googleAds:searchStream`,
    {
      method: "POST",
      headers: headers(accessToken, loginCustomerId ?? customerId),
      body: JSON.stringify({ query }),
      cache: "no-store",
    },
  );
  if (!res.ok) {
    throw new Error(`Google searchStream failed: ${res.status} ${await res.text()}`);
  }
  const batches = (await res.json()) as Array<{ results?: any[] }>;
  return batches.flatMap((b) => b.results ?? []);
}

export interface GoogleCustomerInfo {
  name: string | null;
  currency: string | null;
  isManager: boolean;
}

/** Fetch a customer's name/currency and whether it's a manager (MCC) account. */
export async function getCustomerInfo(
  customerId: string,
  accessToken: string,
): Promise<GoogleCustomerInfo> {
  try {
    const rows = await searchStream(
      customerId,
      accessToken,
      "SELECT customer.descriptive_name, customer.currency_code, customer.manager FROM customer LIMIT 1",
      customerId,
    );
    const c = rows[0]?.customer;
    return {
      name: c?.descriptiveName ?? null,
      currency: c?.currencyCode ?? null,
      isManager: Boolean(c?.manager),
    };
  } catch {
    return { name: null, currency: null, isManager: false };
  }
}

export interface GoogleClientAccount {
  id: string;
  name: string | null;
  currency: string | null;
}

/** List the non-manager, enabled client accounts under a manager (MCC). */
export async function listClientAccounts(
  managerId: string,
  accessToken: string,
): Promise<GoogleClientAccount[]> {
  try {
    const rows = await searchStream(
      managerId,
      accessToken,
      `SELECT customer_client.id, customer_client.descriptive_name,
              customer_client.currency_code, customer_client.manager,
              customer_client.status
       FROM customer_client
       WHERE customer_client.manager = false`,
      managerId,
    );
    return rows
      .map((r) => r.customerClient)
      .filter((cc) => cc && cc.status === "ENABLED")
      .map((cc) => ({
        id: String(cc.id),
        name: cc.descriptiveName ?? null,
        currency: cc.currencyCode ?? null,
      }));
  } catch {
    return [];
  }
}
