import "server-only";
import { serverEnv, clientEnv } from "@/lib/env";

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";

function redirectUri(): string {
  return `${clientEnv.appUrl}/api/google/callback`;
}

/** Build the Google consent URL. `access_type=offline` + `prompt=consent` so a
 *  refresh token is always returned (needed to sync without re-auth). */
export function buildGoogleAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: serverEnv.google.clientId,
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: serverEnv.google.scopes,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  });
  return `${AUTH_ENDPOINT}?${params}`;
}

export interface GoogleTokens {
  access_token: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
}

/** Exchange the OAuth `code` for access + refresh tokens. */
export async function exchangeCodeForTokens(code: string): Promise<GoogleTokens> {
  const body = new URLSearchParams({
    code,
    client_id: serverEnv.google.clientId,
    client_secret: serverEnv.google.clientSecret,
    redirect_uri: redirectUri(),
    grant_type: "authorization_code",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google token exchange failed: ${res.status} ${await res.text()}`);
  }
  return (await res.json()) as GoogleTokens;
}

/** Mint a fresh access token from a stored refresh token (tokens are short-lived). */
export async function refreshAccessToken(refreshToken: string): Promise<string> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: serverEnv.google.clientId,
    client_secret: serverEnv.google.clientSecret,
    grant_type: "refresh_token",
  });
  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Google token refresh failed: ${res.status} ${await res.text()}`);
  }
  const json = (await res.json()) as GoogleTokens;
  return json.access_token;
}
