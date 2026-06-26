/**
 * Centralised, validated access to environment variables.
 *
 * - `clientEnv` only contains NEXT_PUBLIC_* values and is safe everywhere.
 * - `serverEnv` reads secrets and MUST only be imported from server code
 *   (route handlers, server actions, server components). Importing it into a
 *   client component will throw at build/run time because the secrets are
 *   undefined in the browser bundle.
 */

function required(name: string, value: string | undefined): string {
  if (!value || value.length === 0) {
    throw new Error(
      `Missing required environment variable: ${name}. ` +
        `Add it to your .env.local (see .env.example).`,
    );
  }
  return value;
}

export const clientEnv = {
  appUrl: process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  supabaseUrl: required(
    "NEXT_PUBLIC_SUPABASE_URL",
    process.env.NEXT_PUBLIC_SUPABASE_URL,
  ),
  supabaseAnonKey: required(
    "NEXT_PUBLIC_SUPABASE_ANON_KEY",
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
  ),
};

/**
 * Lazily-read server secrets. Accessed as functions so that simply importing
 * this module from a shared file never forces the secret to exist unless it is
 * actually used on the server.
 */
export const serverEnv = {
  get supabaseServiceRoleKey() {
    return required(
      "SUPABASE_SERVICE_ROLE_KEY",
      process.env.SUPABASE_SERVICE_ROLE_KEY,
    );
  },
  get tokenEncryptionKey() {
    return required("TOKEN_ENCRYPTION_KEY", process.env.TOKEN_ENCRYPTION_KEY);
  },
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  get geminiApiKey() {
    return required("GEMINI_API_KEY", process.env.GEMINI_API_KEY);
  },
  shopify: {
    get apiKey() {
      return required("SHOPIFY_API_KEY", process.env.SHOPIFY_API_KEY);
    },
    get apiSecret() {
      return required("SHOPIFY_API_SECRET", process.env.SHOPIFY_API_SECRET);
    },
    scopes: process.env.SHOPIFY_SCOPES ?? "read_orders,read_products",
    apiVersion: process.env.SHOPIFY_API_VERSION ?? "2025-01",
  },
  meta: {
    get appId() {
      return required("META_APP_ID", process.env.META_APP_ID);
    },
    get appSecret() {
      return required("META_APP_SECRET", process.env.META_APP_SECRET);
    },
    apiVersion: process.env.META_API_VERSION ?? "v21.0",
    scopes: process.env.META_SCOPES ?? "ads_read,business_management",
  },
};

export const appUrl = clientEnv.appUrl;
