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

### Google campaign signals (migration 0036)

Apply `0036_google_campaign_changes.sql` after `0035_google_gross_spend.sql`
before enabling change-history imports. It stores actual Google edits separately
from daily metrics, with per-user read access and server-only writes. Existing
metrics remain available if this table has not been created yet.

After deploying, replace each store's existing Google Ads Script with v5 from
Connections, then run it once and retain the hourly schedule.
The script imports recent budget, status and bidding edits; retries preserve
original timestamps. The Google API limits this historical lookback to 30 days,
and may not expose every edit visible in its web interface. OAuth connections
also import the same history on sync. No budgets or campaigns are changed.

The script now reads `applied_incentive` on every run. An available granted balance
confirms that eligible advertising is funded, so its net expense is zero while
gross campaign metrics remain intact. Use the grant timestamp, not the redemption
date. Never consume the promotional balance against served cost: Google billing
can also apply overdelivery and invalid-click adjustments. The gross-to-paid reduction
is therefore credits/adjustments, not a claim about the exact promotional usage.
If promotions cannot be read, a balance has run out, or a cost day straddles the
grant/expiry time, the script stops before posting and requests billing
reconciliation; it must not silently replace net expenses with gross amounts.
`CREDITOS` remains a legacy manual fallback only when no granted promotions are
returned. The incentives API can require account access; verify the query in the
account before enabling the updated hourly script.

Finance → Google uses gross advertising cost for campaign/collection expenses,
profit, margins, cumulative profit and performance metrics. Campaign agency fees
also use that gross basis. Dashboard and the main P&L retain the net paid expense
after credit. Paid campaign inputs remain available for account reconciliation;
gross and net totals must never be reconciled against one another. Missing gross
coverage leaves analysis profit unknown, rather than substituting the paid cost.
Observed gross spend and CPC/CPM/CPA remain visible with a partial label when
another day is missing. Those rates use activity from the same covered days;
the missing dates are shown explicitly. Partial advertising totals never replace
complete expenses in profit, margins or period ROAS calculations.

Campaign ROAS and scale badges accumulate all complete days after each campaign's
latest imported edit through yesterday (merchant timezone), independently of the
selected P&L period. The edit day and today are excluded because imports are daily.
A new edit resets both ROAS calculations and the minimum five-day wait for badges.
Missing edit history or gaps in daily coverage leave ROAS unavailable instead of
falling back to lifetime totals. Both Google conversion-value ROAS and full Shopify
product-scope ROAS use gross advertising spend from that same interval. Summary
Google ROAS weights each campaign by its own since-edit spend; historical daily and
monthly P&L rows retain explicitly labelled period ROAS. Shopify scope includes all channels,
with current explicit product/collection membership (`read_products`), matched item
COGS, proportional refunds/shipping and the same payment/agency fees as Finance.
Shared product revenue is labelled and is never added to the attributed P&L totals.
Incomplete spend coverage, unknown product scope, inactive campaigns and an unknown
or unmet break-even do not generate scale badges.

### Partially paid post-purchase additions

Order sync now reads captured shop-currency totals and sales agreements for
partially paid orders. A complete original basket that reconciles exactly to
captured money remains in dashboard, product and campaign metrics when a later
extra fails payment. Unpaid lines contribute no units, revenue or estimated cost.
The Shopify financial status remains unchanged; `orders.raw.revflow_paid_portion`
retains the original total, outstanding amount and paid-line evidence. Existing
accounting columns contain the recognized portion, so no schema migration is needed.
A later settled import restores the full basket on the same order and clears the
partial-payment evidence. API failures abort the import before replacing that page.

Deposits that do not cover a complete basket, partial payments involving edits or
refunds, and unsupported/incomplete sales histories remain excluded until their
paid items can be established. Existing settled/refunded-order accounting is unchanged.
After deploying, sync affected stores and recompute their order dates to repair
previously excluded orders. The Shopify queries use the existing `read_orders` scope.
References: [sales agreements](https://shopify.dev/docs/api/admin-graphql/latest/interfaces/SalesAgreement)
and [product sales](https://shopify.dev/docs/api/admin-graphql/latest/objects/ProductSale).

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

Vercel Cron does not run on Netlify. `netlify/functions/scheduled-sync.mjs` is a
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
