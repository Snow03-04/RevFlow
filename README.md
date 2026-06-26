# RevFlow

**Profit analytics & tracking for Shopify stores running Meta Ads.**

RevFlow connects a merchant's Shopify store and Meta (Facebook) Ads account, syncs
orders, products, costs, refunds and campaign spend, and computes **true profit** in
real time — Revenue − COGS − Shipping − Payment Fees − Refunds − Ad Spend.

Built as a multi-tenant SaaS: every user has an isolated account protected by
Supabase **Row Level Security**, OAuth tokens are **encrypted at rest**, and data
refreshes automatically via a 15-minute cron + Shopify webhooks.

---

## ✨ Features

- **Auth** — email/password + Google OAuth, full multi-tenant isolation.
- **Shopify integration** — OAuth install, sync of orders, line items, products
  (with COGS from inventory items) and refunds; live webhooks.
- **Meta Ads integration** — OAuth, long-lived tokens, daily campaign insights
  (spend, impressions, clicks, CPM/CPC/CTR, purchases, ROAS).
- **Premium dashboard** — KPIs for Today / This week / This month with
  period-over-period comparison, plus Revenue / Spend / Profit / ROAS charts.
- **Profit engine** — configurable COGS, shipping and payment-fee assumptions.
- **Products page** — units, revenue, cost, profit and margin per product, sortable.
- **Ads page** — spend, revenue, contribution, CPA, ROAS, CTR, CPM per campaign,
  filterable by date and campaign.
- **Automatic sync** — Vercel Cron every 15 min + Shopify webhooks for instant
  order/refund updates.
- **Security** — encrypted tokens, RLS, server-only secrets, HMAC-verified
  webhooks and OAuth callbacks, CSRF state on every OAuth flow.

---

## 🧱 Tech stack

| Layer       | Tech                                                            |
| ----------- | -------------------------------------------------------------- |
| Frontend    | Next.js 15 (App Router), TypeScript, Tailwind CSS, shadcn/ui, Recharts |
| Backend     | Next.js Route Handlers + Server Actions                        |
| Database    | Supabase (PostgreSQL) with Row Level Security                  |
| Auth        | Supabase Auth (email/password + Google)                        |
| Integrations| Shopify Admin API, Meta Marketing API                          |
| Hosting     | Vercel (cron jobs) + Supabase                                  |

---

## 📂 Project structure

```
revflow/
├── supabase/migrations/        # SQL schema, indexes, RLS, triggers (0001–0006)
├── src/
│   ├── app/
│   │   ├── (auth)/             # login / signup
│   │   ├── (dashboard)/        # dashboard, products, ads, connections, settings
│   │   ├── api/
│   │   │   ├── shopify/        # connect, callback, webhooks
│   │   │   ├── meta/           # connect, callback
│   │   │   └── cron/sync/      # scheduled sync (every 15 min)
│   │   ├── auth/callback/      # OAuth / email-confirm code exchange
│   │   ├── layout.tsx          # root layout + theme
│   │   └── page.tsx            # marketing landing
│   ├── components/             # ui/ (shadcn), charts/, dashboard/, ...
│   ├── lib/
│   │   ├── supabase/           # browser / server / admin / middleware clients
│   │   ├── shopify/            # client, oauth, sync, webhooks
│   │   ├── meta/               # client, oauth, sync
│   │   ├── profit.ts           # profit model
│   │   ├── metrics.ts          # daily rollup + summaries
│   │   ├── queries.ts          # dashboard data access
│   │   ├── jobs.ts             # sync orchestration (cron + callbacks)
│   │   ├── crypto.ts           # AES-256-GCM token encryption
│   │   └── env.ts              # validated env access
│   ├── types/                  # Database + domain types
│   └── middleware.ts           # session refresh + route guards
├── .env.example
└── vercel.json                 # cron schedule
```

---

## 🚀 Getting started

### 0. Prerequisites

- Node.js 18.18+ (Node 20/22 recommended)
- A free [Supabase](https://supabase.com) project
- A [Shopify Partners](https://partners.shopify.com) app (for Shopify OAuth)
- A [Meta for Developers](https://developers.facebook.com) app with the Marketing API

### 1. Install

```bash
npm install
cp .env.example .env.local   # then fill in the values (see below)
```

### 2. Set up Supabase

1. Create a project at https://app.supabase.com.
2. **Run the migrations.** Either:
   - **SQL editor (quickest):** open each file in `supabase/migrations/` in order
     (`0001` → `0006`) and run it, **or**
   - **Supabase CLI:**
     ```bash
     npm i -g supabase
     supabase link --project-ref <your-project-ref>
     supabase db push
     ```
3. **Auth providers:** In *Authentication → Providers*, enable **Email** and
   **Google** (paste your Google OAuth client id/secret).
4. **Redirect URLs:** In *Authentication → URL Configuration* add:
   - `http://localhost:3000/auth/callback`
   - `https://YOUR-DOMAIN/auth/callback`
5. Copy your keys from *Project Settings → API* into `.env.local`:
   - `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
     `SUPABASE_SERVICE_ROLE_KEY`.

> A trigger (`handle_new_user`) automatically creates a `profiles` row and a
> default `settings` row for every new user. The canonical user table is
> Supabase's `auth.users`; `profiles` extends it.

### 3. Set up Shopify

1. In your Shopify Partners app, set the **App URL** to your domain and add the
   **Allowed redirection URL**: `https://YOUR-DOMAIN/api/shopify/callback`
   (and `http://localhost:3000/api/shopify/callback` for dev).
2. Request scopes: `read_orders,read_products,read_inventory,read_fulfillments`.
3. Copy the **Client ID / Client secret** into `SHOPIFY_API_KEY` /
   `SHOPIFY_API_SECRET`.

### 4. Set up Meta

1. In your Meta app add the **Facebook Login** product.
2. Add the OAuth redirect URI: `https://YOUR-DOMAIN/api/meta/callback`
   (and the localhost variant for dev).
3. Request permissions `ads_read` and `business_management` (these require
   **App Review** before you can serve external merchants; they work for users
   with a role on the app while in development mode).
4. Copy **App ID / App secret** into `META_APP_ID` / `META_APP_SECRET`.

### 5. Generate secrets

```bash
# 32-byte hex key for encrypting OAuth tokens at rest
openssl rand -hex 32      # -> TOKEN_ENCRYPTION_KEY

# random secret to protect the cron endpoint
openssl rand -hex 32      # -> CRON_SECRET
```

### 6. Run

```bash
npm run dev
```

Open http://localhost:3000, create an account, then go to **Connections** to link
Shopify and Meta. The initial historical import (≈60 days) runs on connect; after
that, data refreshes automatically.

---

## 🔑 Environment variables

See [`.env.example`](./.env.example) for the full annotated list. Summary:

| Variable | Exposed to browser? | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | yes | Base URL used to build OAuth redirect URIs |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Public anon key (RLS-constrained) |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | Bypasses RLS — cron + webhooks only |
| `TOKEN_ENCRYPTION_KEY` | **no** | AES-256-GCM key for OAuth tokens |
| `SHOPIFY_API_KEY` / `SHOPIFY_API_SECRET` | **no** | Shopify app credentials |
| `SHOPIFY_SCOPES` / `SHOPIFY_API_VERSION` | **no** | Admin API config |
| `META_APP_ID` / `META_APP_SECRET` | **no** | Meta app credentials |
| `META_API_VERSION` / `META_SCOPES` | **no** | Marketing API config |
| `CRON_SECRET` | **no** | Bearer token guarding `/api/cron/sync` |

Only `NEXT_PUBLIC_*` variables are ever sent to the browser. Everything else is
read exclusively in server code.

---

## 📊 The profit model

```
Profit = Revenue
       − Product Cost (COGS)
       − Shipping Cost
       − Payment Fees
       − Refunds
       − Advertising Spend
```

- **Revenue** = Shopify order subtotals (after line discounts).
- **COGS** = per-unit cost from Shopify inventory items, captured as a snapshot on
  each order line. If a product has no cost, the **default cost %** from Settings
  is used.
- **Shipping cost** = flat per-order cost from Settings.
- **Payment fees** = `payment_fee_pct % × order total + fixed fee per order`.
- **Refunds** = computed from Shopify refund transactions / line items.
- **Ad spend** = Meta campaign spend.

Derived metrics: **ROAS** (Meta purchase value ÷ spend), **MER** (total revenue ÷
total ad spend), **AOV**, **CAC**, **conversion rate** (orders ÷ ad clicks).

All cost assumptions live in **Settings** and are editable per user; saving
recalculates the trailing 90 days.

---

## 🔄 How sync works

- **On connect** — an initial ~60-day import of products, orders and campaigns.
- **Every 15 minutes** — `vercel.json` triggers `GET /api/cron/sync`, which
  re-syncs every active connection and recomputes daily metrics. The endpoint is
  protected by `CRON_SECRET` (Vercel Cron sends it automatically).
- **Shopify webhooks** — `orders/create`, `orders/updated`, `orders/cancelled`,
  `refunds/create` and `app/uninstalled` keep orders and profit live between cron
  runs. Each request's HMAC is verified against the raw body.
- **Manual** — the **Sync now** button (top bar) re-syncs on demand.

---

## ☁️ Deploying to Vercel

1. Push this repo to GitHub and import it into Vercel.
2. Add **all** environment variables from `.env.local` to the Vercel project
   (Production + Preview). Set `NEXT_PUBLIC_APP_URL` to your production URL.
3. The cron schedule in `vercel.json` (`*/15 * * * *`) is picked up automatically.
   Setting `CRON_SECRET` makes Vercel send it as a Bearer token to the cron route.
   > The 15-minute schedule and the 300s `maxDuration` on the cron route require a
   > **Vercel Pro** plan. On Hobby, change the schedule to daily and lower
   > `maxDuration` to 60, or run the cron elsewhere (e.g. Supabase pg_cron / GitHub
   > Actions hitting `/api/cron/sync` with the Bearer token).
4. Update the OAuth redirect URLs in **Supabase**, **Shopify** and **Meta** to use
   your production domain.
5. Deploy. 🎉

### Alternative cron (without Vercel Pro)

Any scheduler can drive the sync:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://YOUR-DOMAIN/api/cron/sync
```

---

## 🔐 Security notes

- **No secrets in the client.** API keys/secrets are only read in server modules
  (`server-only` guarded). The browser only ever sees `NEXT_PUBLIC_*` values.
- **Encrypted tokens.** Shopify/Meta access tokens are encrypted with AES-256-GCM
  (`TOKEN_ENCRYPTION_KEY`) before being stored.
- **Row Level Security.** Every table is owner-scoped (`auth.uid() = user_id`).
  The service-role key is used only by cron + verified webhooks.
- **Verified callbacks.** OAuth callbacks check a CSRF `state` cookie and (Shopify)
  HMAC; webhooks verify the HMAC signature against the raw body.
- **Validation.** User input is validated with Zod in server actions.

---

## 🧪 Scripts

```bash
npm run dev        # start dev server
npm run build      # production build
npm run start      # run the production build
npm run lint       # eslint
npm run typecheck  # tsc --noEmit
```

---

## 📝 Notes & limitations

- **Conversion rate** is computed as orders ÷ Meta ad clicks (a blended proxy);
  true session-based CR would require Shopify storefront analytics or a pixel.
- **Multi-currency:** metrics assume a single reporting currency (from Settings).
  Stores/ad accounts in mixed currencies should be normalised before relying on
  blended totals.
- **Ad country filter:** the Ads page filters by date and campaign. Per-country ad
  breakdowns require syncing Meta insights with `breakdowns=country` (a
  straightforward extension of `src/lib/meta/sync.ts`).
- The Shopify integration uses the REST Admin API; migrate to GraphQL if/when you
  need newer-only fields.

---

Built with Next.js, Supabase, Shopify & Meta.
