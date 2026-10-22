# Supabase bandwidth

## Catalogue and sync reads — 22 October 2026

Migration `0042_compact_matcher_catalogue.sql` collapses product variants and
sold order lines inside PostgreSQL before sending them to finance/ROAS reports.
It preserves the existing id-ordered first price, first usable title/handle/cost,
sold-only products, manual costs and store currency conversion. It is a live,
`SECURITY INVOKER` read with existing RLS; anonymous execution is denied. Missing
migrations retain the complete legacy reader; other failures are not hidden.

Order imports and webhooks read costs only for the variants in their current
orders. Catalogue imports read only manual overrides for imported variants.
Repeated interactive failures retry after 30, 60, 120 and 240 seconds, then every
five minutes; a successful refresh resets that delay and manual refresh stays
immediate. Normal automatic refresh and scheduled sync retain their cadence.

A read-only comparison across all nine stored accounts returned identical
matcher results: 6,909,506 decoded response bytes before versus 1,219,711 after
(82.35% fewer). The largest catalogue went from 5,604,586 to 768,237 bytes.
This is one catalogue read per account, not a monthly billing projection.
The migration and matching application build must both be published.

Validation: `tests/compact-catalogue.test.cjs` executes PostgreSQL with PGlite,
including more than 1,000 products, fallback titles, zero/manual costs, store FX,
anonymous rejection and cross-user isolation. The full local suite passed
345 tests on 22 October, including financial and refresh regressions.

The organization dashboard showed 12.75 GB against 5 GB, for the cycle
25 September–25 October 2026, with the grace deadline also on 25 October.
Optimization cannot remove already billed traffic or guarantee no interruption.
[Quota reset and restriction rules](https://supabase.com/docs/guides/platform/billing-faq).

If continuity requires additional quota, Supabase Pro is the least disruptive
option (starts at $25/month; verify the account checkout and taxes). A separate
server running self-hosted Supabase preserves more of RevFlow's existing Auth,
PostgREST and RLS integration than moving to a PostgreSQL-only service. That
alternative needs a server, backups, TLS, mail/Auth setup and a verified migration;
it has not been provisioned or substituted for production.
[Self-hosted migration](https://supabase.com/docs/guides/self-hosting/restore-from-platform).

## Earlier financial read optimizations

Financial reads use migration `0039_financial_read_windows.sql`:

- `financial_payment_snapshots` returns charge/refund evidence for orders in the
  requested accounting window, including transactions posted outside that window.
  Disputes and other profit adjustments use their posting date. Payouts remain in
  the full stored ledger and are not read for profit calculations.
- `cogs_quantity_history` returns only paid, unedited, non-refunded baskets with
  supplier invoices and at least two units. It retains all dated examples used by
  quantity pricing; the client still validates products, quantities and prices.
- Both functions are `SECURITY INVOKER`, obey table RLS and disallow anonymous
  execution. A missing migration falls back to the existing complete readers;
  other errors propagate rather than replacing evidence with zero.

Single-store calculations scope payment and supplier reads to that store. Order
reads select capture proof and source timestamp rather than the full raw JSON.
The scheduled sync still runs every 15 minutes, but calculates recent account
totals once after all sources finish. Historical corrections and failed rollup
retries remain enabled. Open, visible tabs refresh every five minutes; manual
refresh remains immediate and failures retry after 30 seconds.

Validation on 16 October 2026, read-only Anna rollup for four Lisbon days:
1,735,242 response bytes with the previous full-history readers versus 563,281
with the scoped readers (67.5% fewer). The generated daily metric rows had the
same SHA-256 digest. This measures decoded database responses for one operation,
not the billing meter or a guarantee about total monthly usage.

Apply the migration and publish the matching app build. Push alone is insufficient
when Netlify production is locked. Already consumed bandwidth is not refunded.
Check the organization usage page after publication; its meter updates hourly.

Regression coverage: `node --test tests/egress.test.cjs`, `npm run test:financial`,
`npm run test:refresh`. No financial records are deleted to reduce bandwidth.
