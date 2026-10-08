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
If promotions cannot be read, the script sends a separate gross-only report.
When the promotion data is valid but only some days need billing reconciliation,
it sends confirmed paid days independently and excludes uncertain days from the
paid payload. One uncertain day must not block other confirmed dates.
The dashboard includes received gross-only costs as explicitly labelled estimates
when no paid account expense, paid script snapshot, or mapped OAuth import exists
for that store/date. It adjusts profit, margins and charts without writing these
estimates into paid expenses or the main P&L. Confirmed paid imports replace the
estimates, including verified zero expenses covered by credit.
`CREDITOS` remains a legacy manual fallback only when no granted promotions are
returned. The incentives API can require account access; verify the query in the
account before enabling the updated hourly script.

The script does not automatically import final billing adjustments such as
overdelivery or invalid-click credits. A confirmed promotional balance is not
confirmation of every billing adjustment. Reconcile these against Google Billing;
do not describe script costs as a guaranteed final billed amount. A standalone
localhost installation must configure its own database, credentials and public
HTTPS receiver; see `LOCALHOST.md`.

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

### Supplier quotes and automatic cost updates

Saving a supplier sheet with an explicitly selected store applies its costs and
binds that tab to the store. Each Shopify refresh (including scheduled sync)
imports supplier prices before computing profit. Legacy unbound links require
one explicit Save or Apply. Never infer the store from order numbers.

No schema migration is required. The saved Google URL retains its spreadsheet
ID and `gid`; app-only fragment fields `revflow_store` and `revflow_pending`
record the owned store and an unfinished recalculation. The UI shows the clean
Google URL. Older code can still parse the spreadsheet and tab. A pending
recalculation is retried even if a prior attempt already saved the costs.

Confirmed order costs override estimates, whether the supplier is paid or not.
Unit quotes are learned only from settled, unedited, unrefunded single-unit
orders and take effect on that order's date. Subsequent unpriced orders reuse
the dated quote. Multi-unit orders learn separate totals by product and quantity
(summing variants), as well as exact mixed-basket compositions. A matching basket
takes priority, then the largest known quantity for each product; extra units
use the existing unit estimate. Bulk totals are never divided into a single-unit
price, and no universal discount is inferred for new products or unobserved mixes.
History is loaded store-scoped and paginated from saved invoices, not manual tier
tables. Corrected invoices therefore update these estimates on the next refresh.
Dates prevent a later order's quote from repricing an earlier day. For bundle
estimates, increases apply immediately; a decrease requires two successive matching
quotes to avoid propagating an isolated undercharge. The exact order cost always
applies immediately. Audit lines show the reference order and pending decreases.
All unquoted orders remain estimates until their own invoice arrives.
Manual entries are preserved. Blank or removed sheet rows retain previously
confirmed costs; invalid or empty imports fail without clearing them.

Supplier payment subtotals are never additional order costs. Blank-number and
labelled totals are ignored. In a sheet with a previously reconciled batch total,
an accidentally numbered total is also recognised when it exactly equals the
preceding batch of at least five orders and exceeds three times every component.
This rule uses cents and distinct order numbers, not a blanket amount threshold.
The supplier screen reports ignored totals. Sync removes a previously imported
subtotal only when its amount matches the current total or the corresponding
saved batch sum, preserving an unrelated genuine prior quote. Derived prices and
dependent reports are recomputed; an unquoted order returns to normal estimation.

Supplier changes recalculate the selected store's history and refresh dependent
P&L/ROAS costs. The cost audit distinguishes supplier estimates from exact costs.
The app must be running, or this version must be deployed with its scheduled
function enabled, for background imports to continue.

Validation: `npm run test:financial` includes quote chronology, store isolation,
unpaid invoices, manual overrides, missing prices, quantity discounts, mixed baskets,
conservative handling of conflicting quotes and interrupted-recompute retries.

### Shopify Payments and money awaiting transfer (migration 0037)

Apply `0037_shopify_payments.sql` before deploying. It stores each owned store's
complete payment ledger, payouts, balance and order-transaction coverage, plus
the resulting fees and settlement adjustments in daily metrics and P&L. Existing
bookkeeping currencies are pinned so a store currency change cannot reinterpret
historical values. A manual exchange-rate override applies only to its named
source currency (`settings.fx_override_currency`).

The existing Shopify connection needs `read_shopify_payments_payouts` and order
access for the imported history. If a separate installed client-credentials app
provides these permissions, a server-side setup can save its client ID and secret
encrypted with the existing `TOKEN_ENCRYPTION_KEY` in `shopify_payment_accounts`.
This optional credential is used only for reading payments; it does not replace
the store's original integration. Never store plaintext secrets in SQL or Git.

Every store sync, including the existing scheduled job, refreshes payments. All
pages must succeed before replacing a snapshot. Errors retain the last good
data and appear in Recebimentos. New financial movements trigger historical
recalculation; changes only to transfer status refresh cash without rebuilding
profit. An interrupted recalculation leaves `refresh_pending` for the next run.
Deploy this version to the running scheduled host for unattended refreshes.

The dashboard's “Por chegar à conta” card shows current net pending transfers
independently of the selected sales period, with EUR and USD kept separate.
Negative amounts are expected debits. Recebimentos shows each store's native
cash, transfer reconciliation, update timestamp and verified/estimated coverage.
“Paid” is Shopify's payout status, not bank-statement verification.

Verified captures and refunds replace estimated processing fees and reconcile
booked sales to actual settlement amounts. Disputes and permanent adjustments
affect profit on their posting day; transfers and reserves do not become
operating expenses. Incomplete or mixed-gateway orders retain labelled estimates.
Reporting conversion of USD holdings does not imply a bank conversion or add
a second FX fee. Shopify plan/app charges, external gateways and bank charges
still require their own expense records. Validate with `npm run test:financial`.

References: [Shopify Payments balance transactions](https://shopify.dev/docs/api/admin-rest/latest/resources/transactions),
[payouts](https://shopify.dev/docs/api/admin-rest/latest/resources/payouts) and
[order transactions](https://shopify.dev/docs/api/admin-graphql/2026-07/objects/OrderTransaction).

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
