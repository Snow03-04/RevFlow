# Deploying RevFlow to production (Netlify + Supabase)

RevFlow is multi-tenant: anyone can sign up and gets fully isolated data,
settings and integrations. Each user connects their own Shopify store and Meta
ad account (per-user OAuth tokens) and brings their own Gemini key for the AI
assistant. The only shared, app-level config is below.

## 1. Run the database migrations

In the **Supabase SQL editor**, run any migrations you haven't applied yet, in
order. The two most recent:

- `supabase/migrations/0012_product_localizations.sql` — product translation.
- `supabase/migrations/0013_user_secrets.sql` — per-user Gemini key column.

RLS is already enabled on every user table, so data is isolated per account.

## 2. Configure Supabase Auth

Supabase → **Authentication → URL Configuration**:

- **Site URL** = your production URL (e.g. `https://your-app.netlify.app`).
- **Redirect URLs** — add `https://your-app.netlify.app/auth/callback`.
- Turn **"Confirm email" ON** so public signups verify their address.
- (Optional) To keep Google sign-in, enable the **Google** provider and add the
  same callback to the Google OAuth client.

## 3. Set environment variables in Netlify

Netlify → **Site settings → Environment variables**. All are app-level
(never per-user, never committed):

| Variable | Notes |
|---|---|
| `NEXT_PUBLIC_APP_URL` | Your production URL, no trailing slash |
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key |
| `SUPABASE_SERVICE_ROLE_KEY` | Server-only; used by cron/webhooks |
| `TOKEN_ENCRYPTION_KEY` | `openssl rand -hex 32`. **Don't change after launch** |
| `CRON_SECRET` | `openssl rand -hex 32`. **Generate a strong one** (the dev placeholder is not safe) |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | Your Shopify app (global identity) |
| `SHOPIFY_SCOPES` / `SHOPIFY_API_VERSION` | Optional overrides |
| `META_APP_ID` / `META_APP_SECRET` | Your Meta app (global identity) |
| `META_API_VERSION` / `META_SCOPES` | Optional overrides |

`GEMINI_API_KEY` is **not** needed — the assistant uses each user's own key,
saved (encrypted) in Settings.

## 4. Configure the Shopify & Meta apps

These are single, shared apps that every user OAuths into — not per-user keys.

- **Shopify Partners** → your app → add redirect `https://your-app.netlify.app/api/shopify/callback`. For public use, distribute it as a public/custom app. Webhooks auto-register against `NEXT_PUBLIC_APP_URL`.
- **Meta for Developers** → your app → **Valid OAuth Redirect URIs** add `https://your-app.netlify.app/api/meta/callback`. `ads_read` + `business_management` require **App Review** to use the app in Live mode (or keep it in Dev mode with explicit testers).

## 5. Deploy

The repo already ships `netlify.toml` (build command, the official
`@netlify/plugin-nextjs` runtime, and security headers). Connect the repo in
Netlify and deploy — no extra build config needed.

## 6. Scheduled sync (cron)

Vercel Cron does not run on Netlify. `netlify/functions/scheduled-sync.mts` is a
**Netlify Scheduled Function** that runs every 15 min and calls
`/api/cron/sync` (authenticated with `CRON_SECRET`), which re-syncs every user's
Shopify + Meta data. Netlify enables it automatically from the exported
`config.schedule`. Verify it in **Logs → Functions** after the first deploy.

> Scale note: `/api/cron/sync` iterates all users in one request. Fine at launch;
> for many users, split the work per connection (background function / pg_cron).

## 7. Smoke test after deploy

1. **Sign up** a fresh account → you land on the dashboard with empty states (a
   trigger auto-creates the profile + default settings).
2. **Settings → AI assistant** → paste a Gemini key → the ⌘K assistant works.
   Without a key it shows "add your key in Settings" and never crashes.
3. **Connections** → connect Shopify and Meta → data appears, isolated to your
   account (RLS).
4. Trigger a sync manually: `curl -H "Authorization: Bearer <CRON_SECRET>" https://your-app.netlify.app/api/cron/sync` → `200`.
