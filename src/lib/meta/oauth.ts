import "server-only";
import { serverEnv, clientEnv } from "@/lib/env";

const GRAPH = (path: string) =>
  `https://graph.facebook.com/${serverEnv.meta.apiVersion}/${path}`;

export function buildMetaAuthUrl(state: string): string {
  const redirectUri = `${clientEnv.appUrl}/api/meta/callback`;
  const params = new URLSearchParams({
    client_id: serverEnv.meta.appId,
    redirect_uri: redirectUri,
    state,
    response_type: "code",
    scope: serverEnv.meta.scopes,
  });
  return `https://www.facebook.com/${serverEnv.meta.apiVersion}/dialog/oauth?${params}`;
}

interface TokenResp {
  access_token: string;
  token_type?: string;
  expires_in?: number;
}

/** Exchange the OAuth `code` for a short-lived user access token. */
export async function exchangeCodeForToken(code: string): Promise<TokenResp> {
  const redirectUri = `${clientEnv.appUrl}/api/meta/callback`;
  const params = new URLSearchParams({
    client_id: serverEnv.meta.appId,
    client_secret: serverEnv.meta.appSecret,
    redirect_uri: redirectUri,
    code,
  });
  const res = await fetch(`${GRAPH("oauth/access_token")}?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meta token exchange failed: ${res.status}`);
  return (await res.json()) as TokenResp;
}

/** Upgrade a short-lived token to a long-lived (~60 day) token. */
export async function exchangeForLongLivedToken(
  shortToken: string,
): Promise<TokenResp> {
  const params = new URLSearchParams({
    grant_type: "fb_exchange_token",
    client_id: serverEnv.meta.appId,
    client_secret: serverEnv.meta.appSecret,
    fb_exchange_token: shortToken,
  });
  const res = await fetch(`${GRAPH("oauth/access_token")}?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meta long-lived exchange failed: ${res.status}`);
  return (await res.json()) as TokenResp;
}

export interface MetaAdAccount {
  id: string; // act_XXXX
  account_id: string; // XXXX
  name: string;
  currency: string;
  business?: { id: string; name: string };
}

/** List the ad accounts the user granted access to. */
export async function fetchAdAccounts(
  token: string,
): Promise<MetaAdAccount[]> {
  const params = new URLSearchParams({
    fields: "id,account_id,name,currency,business",
    access_token: token,
    limit: "100",
  });
  const res = await fetch(`${GRAPH("me/adaccounts")}?${params}`, {
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Meta adaccounts fetch failed: ${res.status}`);
  const json = (await res.json()) as { data: MetaAdAccount[] };
  return json.data ?? [];
}
